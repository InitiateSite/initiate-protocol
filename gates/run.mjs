// npm run gates
// 30 gates at most. Static ones read the source and dist; behavioural ones drive Edge against a
// synthetic network (gates/fixtures.mjs) on a fake clock. Exit code 0 only if every gate passes.
import { readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync, inflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';
import { installNetwork, FIXTURE } from './fixtures.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const R = (...p) => join(ROOT, ...p);
const { chromium } = createRequire(R('package.json'))('playwright-core');
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/microsoft-edge', '/usr/bin/google-chrome'].find(existsSync);

const gates = [];
const gate = (name, fn) => gates.push({ name, fn });
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

// ---------- helpers ----------
const walk = (dir, out = []) => {
  for (const f of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git'].includes(f) || f.startsWith('.gate-')) continue;
    const p = join(dir, f);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const src = (ext) => walk(R('src')).filter((f) => ext.includes(extname(f)));
const text = (f) => readFileSync(f, 'utf8');
const rel = (f) => relative(ROOT, f).replace(/\\/g, '/');
const tokensCss = text(R('src/tokens.css'));
const tok = (name) => tokensCss.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// PNG decode (8-bit, non-interlaced), enough to audit our own icons
function decodePng(buf) {
  ok(buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'not a PNG');
  let off = 8, w, h, ct, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  ok(bpp, `unsupported colour type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      px[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  return { w, h, ct, px, bpp };
}

// ---------- shared browser state ----------
let browser, prod, stated;
const open = new Set();
const BREAKPOINTS = [[360, 780], [390, 844], [430, 932], [1366, 768], [1440, 900]];

async function page(site, { width = 1440, height = 900, reduced = false, clock = true, hold = false, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference', permissions: ['clipboard-read', 'clipboard-write'], serviceWorkers: 'block' });
  const network = installNetwork(ctx);
  if (hold) network.hold();
  open.add(ctx);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`console ${m.text()}`); });
  if (init) await p.addInitScript(init);
  if (clock) await p.clock.install({ time: new Date('2026-06-01T12:00:00Z') });
  await p.goto(site.url, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-ca] .ca-in');
  return { p, ctx, network, errors, close: () => ctx.close() };
}
const tick = (p, ms) => p.clock.runFor(ms);
const settle = (p, ms = 250) => p.waitForTimeout(ms);

// =====================================================================================
// STATIC GATES
// =====================================================================================

gate('01 build output exists and is self-contained', () => {
  for (const f of ['dist/index.html', 'dist/manifest.webmanifest', 'dist/share.png', 'dist/favicon.ico', 'dist/coin.webp']) ok(existsSync(R(f)), `${f} missing; run npm run build`);
  const html = text(R('dist/index.html'));
  ok(!/https?:\/\/(fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr|unpkg|cdnjs)/.test(html), 'dist references a third-party asset host');
  ok(/<script type="module"[^>]+src="\/assets\/[^"]+\.js"/.test(html), 'module script missing');
});

gate('02 palette: no colour literal outside src/tokens.css', () => {
  const named = /(?<![\w#-])(black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|gold|navy|teal|cyan|magenta|lime|maroon|olive|aqua|fuchsia)(?![\w-])/;
  const bad = [];
  for (const f of [...src(['.css', '.js']), R('index.html'), R('vite.config.js')]) {
    if (rel(f) === 'src/tokens.css') continue;
    const s = text(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const cssLike = extname(f) === '.css';
    if (/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b(?![-\w])/.test(s.replace(/href="#[\w-]+"|href=#[\w-]+|url\(#[\w-]+\)|'#[\w-]+'|`#[\w${}-]+`/g, ''))) bad.push(`${rel(f)}: hex`);
    if (/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/.test(s)) bad.push(`${rel(f)}: colour function`);
    if (cssLike && named.test(s.replace(/var\([^)]*\)/g, ''))) bad.push(`${rel(f)}: named colour`);
  }
  for (const f of readdirSync(R('public'))) if (/\.(svg|css)$/.test(f)) bad.push(`public/${f}: should not hold colours`);
  eq(bad, [], 'literals found');
});

gate('03 palette: every token carries provenance and is snapped to a real pixel coordinate', () => {
  const lines = tokensCss.split('\n').filter((l) => /^\s*--[\w-]+:\s*#[0-9a-fA-F]{6};/.test(l));
  ok(lines.length >= 12, `expected 12+ sampled colours, found ${lines.length}`);
  for (const l of lines) ok(/\/\*\s*(k-means [\d.]+%|direct)\s+·\s+[^*]*\(\d+,\d+\)/.test(l), `no source/pixel provenance: ${l.trim()}`);
  ok(/k-means/.test(tokensCss.split(':root')[0]) && /nearest[\s*]+REAL pixel/.test(tokensCss.split(':root')[0]), 'method comment missing');
  ok(/premultiplied/i.test(tokensCss), 'premultiplied-alpha note missing');
  ok(/colourtype 6/.test(tokensCss), 'IHDR colourtype note missing');
});

gate('04 units: no ch units anywhere', () => {
  const bad = [...src(['.css', '.js']), R('index.html')].filter((f) => /[\d.]ch(?![a-zA-Z0-9_-])/.test(text(f).replace(/\/\*[\s\S]*?\*\//g, '')));
  eq(bad.map(rel), [], 'files using ch');
});

gate('05 repo hygiene: no agent files, no attribution strings', () => {
  const all = walk(ROOT).filter((f) => !/\.(png|jpe?g|webp|ico|woff2?)$/.test(f));
  const names = readdirSync(ROOT);
  ok(!names.some((n) => n.toLowerCase() === ['clau', 'de.md'].join('')), 'agent instruction file present');
  ok(!names.includes(['.clau', 'de'].join('')), 'agent config folder present');
  const words = ['clau' + 'de', 'anthro' + 'pic', 'co-authored-by', 'generated with', 'chat' + 'gpt', 'open' + 'ai', 'copi' + 'lot', 'as an ai'];
  const re = new RegExp(words.join('|'), 'i');
  const hits = [...all.filter((f) => !f.includes('package-lock') && rel(f) !== 'gates/run.mjs'), ...(existsSync(R('dist')) ? walk(R('dist')) : [])].filter((f) => re.test(text(f)));
  eq(hits.map(rel), [], 'attribution strings');
  const pkg = JSON.parse(text(R('package.json')));
  ok(!pkg.author && !pkg.contributors, 'package.json names an author');
});

gate('06 register: every record has a legal state; nothing else hard-codes an external fact', async () => {
  const { records, STATE } = await import(pathToFileURL(R('src/records.js')).href);
  for (const [k, r] of Object.entries(records)) ok(Object.values(STATE).includes(r.state), `${k}: bad state ${r.state}`);
  for (const k of ['x', 'github', 'launcher']) eq(records[k].state, 'absent', `${k} must stay absent until stated`);
  // the contract address may be absent or stated; if stated it must be a well-formed address
  const { parseAddress } = await import(pathToFileURL(R('src/records.js')).href);
  ok(records.ca.state === 'absent' ? records.ca.value === null : records.ca.state === 'stated' && parseAddress(records.ca.value), `ca must be absent with no value, or stated with a valid address (got ${records.ca.state})`);
  const leaks = [];
  for (const f of [...src(['.js', '.css']), R('index.html')]) {
    if (['src/records.js', 'src/tokens.css'].includes(rel(f))) continue;
    const s = text(f);
    if (/0x[0-9a-fA-F]{40}\b/.test(s)) leaks.push(`${rel(f)}: full address`);
    if (/x\.com\/|twitter\.com\/|github\.com\/|Initiate_Site|rpc\.mainnet|\b4663\b|initiate\.site/.test(s.replace(/%SITE%/g, ''))) leaks.push(`${rel(f)}: external fact outside the register`);
  }
  eq(leaks, [], 'leaks');
});

gate('07 register: addresses are never blanket-rejected; links only for stated https records', async () => {
  const { parseAddress, hrefOf, handleOf, caView, safeUrl } = await import(pathToFileURL(R('src/records.js')).href);
  const good = ['0x' + 'a'.repeat(40), '0x' + 'A'.repeat(40), '0x' + '0'.repeat(40), '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01', '  0x' + '1f'.repeat(20) + '  '];
  for (const g of good) ok(parseAddress(g), `valid address refused: ${g}`);
  for (const b of ['0x' + 'a'.repeat(39), '0x' + 'a'.repeat(41), 'a'.repeat(40), '0x' + 'g'.repeat(40), '', null, undefined, 12]) ok(parseAddress(b) === null, `malformed address accepted: ${b}`);
  const stated = (value) => ({ state: 'stated', value });
  eq(hrefOf({ state: 'absent', value: 'https://x.com/Initiate_Site' }), null, 'absent record with a stored URL must not link');
  eq(hrefOf({ state: 'unconfirmed', value: 'https://x.com/a' }), null, 'unconfirmed must not link');
  ok(hrefOf(stated('https://x.com/acme')), 'stated https record must link');
  for (const b of ['http://x.com/a', 'javascript:alert(1)', 'https://u:p@x.com/a', 'https://x.com:8443/a', 'not a url']) eq(safeUrl(b), null, `unsafe URL accepted: ${b}`);
  eq(handleOf(stated('https://x.com/acme_fixture/')), 'acme_fixture', 'handle derived from URL');
  eq(handleOf(stated('https://x.com/@acme')), 'acme', 'leading @ stripped');
  eq(handleOf({ state: 'absent', value: 'https://x.com/acme' }), null, 'no handle for unstated');
  eq(caView({ state: 'absent', value: null }).kind, 'absent', 'absent CA');
  eq(caView(stated('0x' + 'b'.repeat(40))).kind, 'ready', 'stated CA');
  eq(caView(stated('0x1234')).kind, 'unconfirmed', 'malformed stated CA is shown inert');
});

gate('08 copy: zero shared 2-grams with the reference (stop-word pairs exempt)', () => {
  const ref = new Set(JSON.parse(text(R('gates/fixtures/reference-bigrams.json'))));
  const STOP = new Set('a an the and or but of to in on at by for with from as is are was be it its this that these those you your we our i me my they them their he she his her not no so if then than too very can will just do does did has have had into over out up down about also more most some any all each other such only own same'.split(' '));
  const words = (s) => s.toLowerCase().replace(/[’']/g, '').match(/[a-z0-9$]+/g) ?? [];
  const html = text(R('index.html')).replace(/<(script|style|symbol)[\s\S]*?<\/\1>/g, ' ');
  const chunks = [...html.matchAll(/>([^<>]{3,})</g)].map((m) => m[1]);
  for (const a of html.matchAll(/(?:name="description"|property="og:(?:title|description|image:alt)"|name="twitter:(?:title|description)")\s+content="([^"]+)"|(?:alt|aria-label|title)="([^"]+)"/g)) chunks.push(a[1] ?? a[2]);
  // text a visitor can read but that lives outside the HTML: CSS content strings and sentences in scripts
  for (const f of src(['.css'])) for (const m of text(f).matchAll(/content:\s*"([^"]+)"/g)) chunks.push(m[1]);
  const TECH = new Set(['noopener noreferrer', 'no preference']);
  for (const f of src(['.js'])) for (const m of text(f).replace(/\/\/.*$/gm, '').matchAll(/`([^`]*)`|'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
    const str = (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*}/g, ' ');
    const sentence = /^[A-Z][^{}()<>=;\[\]\\]*\s[^\s]+\s[^\s]+/.test(str) && !/^(Math|Intl|Date)\b/.test(str);
    const phrase = /^[a-z][a-z’', .!?·]*$/.test(str) && /\s/.test(str.trim()) && !TECH.has(str);
    if (sentence || phrase) chunks.push(str);
  }
  const hits = new Map();
  for (const c of chunks) { const w = words(c); for (let i = 0; i < w.length - 1; i++) { const bg = `${w[i]} ${w[i + 1]}`; if (ref.has(bg) && !(STOP.has(w[i]) && STOP.has(w[i + 1])) && !hits.has(bg)) hits.set(bg, c.trim().slice(0, 70)); } }
  eq([...hits].map(([k, v]) => `${k}  <-  ${v}`).sort(), [], 'bigrams shared with the reference');
});

gate('09 assets: favicon is RGBA built from the logo with no dark fringe', () => {
  for (const s of [16, 32, 48]) {
    const img = decodePng(readFileSync(R(`public/favicon-${s}.png`)));
    eq([img.w, img.h, img.ct], [s, s, 6], `favicon-${s} geometry/colourtype`);
    eq(img.px[3], 0, `favicon-${s} corner must be transparent`);
    let solid = 0, fringeDark = 0;
    const sage = lum(tok('mark'));
    for (let i = 0; i < img.px.length; i += 4) {
      const a = img.px[i + 3];
      if (a === 0) continue;
      const l = lum('#' + [0, 1, 2].map((k) => img.px[i + k].toString(16).padStart(2, '0')).join(''));
      if (a > 240 && Math.abs(l - sage) < 0.05) solid++;
      if (a > 40 && a < 215 && l < sage * 0.35 && !(img.px[i] < 40 && img.px[i + 1] < 40)) fringeDark++; // edge pixels darkened by black bleed
    }
    ok(solid > (s * s) / 6, `favicon-${s}: too few logo-fill pixels (${solid})`);
    ok(fringeDark <= s / 2, `favicon-${s}: dark fringe on ${fringeDark} edge pixels`);
  }
  const ico = readFileSync(R('public/favicon.ico'));
  eq([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4) >= 3], [0, 1, true], 'ICO header with 3+ sizes');
  const share = decodePng(readFileSync(R('public/share.png')));
  eq([share.w, share.h], [1200, 630], 'share card size');
});

gate('10 head: metadata, CSP and manifest agree with the tokens and the register', () => {
  const html = text(R('dist/index.html'));
  const bg = tok('bg').toLowerCase();
  ok(html.includes(`name="theme-color" content="${bg}"`), 'theme-color not from tokens');
  const man = JSON.parse(text(R('dist/manifest.webmanifest')));
  eq([man.theme_color, man.background_color], [bg, bg], 'manifest colours');
  ok(/<title>[^<]{8,}<\/title>/.test(html) && /name="description" content="[^"]{40,}"/.test(html), 'title/description');
  ok(html.includes('property="og:image" content="https://initiate.site/share.png"'), 'og:image absolute');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
  ok(csp && !/unsafe-(inline|eval)/.test(csp) && /object-src 'none'/.test(csp), 'CSP missing or weak');
  ok(/connect-src[^;]*rpc\.mainnet\.chain\.robinhood\.com[^;]*api\.llama\.fi[^;]*api\.dexscreener\.com/.test(csp), 'CSP connect-src');
  ok(!/\sstyle=/.test(html.replace(/<symbol[\s\S]*?<\/symbol>/g, '')), 'inline style attribute would be blocked by CSP');
});

gate('11 contrast: token pairs meet WCAG', () => {
  const v = (n) => { const m = tokensCss.match(new RegExp(`--${n}:\\s*var\\(--([\\w-]+)\\)`)); return tok(m[1]); };
  const pairs = [['c-body', 'c-page', 7], ['c-strong', 'c-page', 12], ['c-accent', 'c-page', 7], ['c-muted', 'c-page', 4.5], ['c-muted', 'c-panel', 4.5], ['c-on-accent', 'c-accent', 7], ['c-accent-soft', 'c-panel', 4.5]];
  for (const [fg, bgc, min] of pairs) { const r = contrast(v(fg), v(bgc)); ok(r >= min, `${fg} on ${bgc} is ${r.toFixed(2)}, needs ${min}`); }
});

gate('12 weight: bundles and images stay within budget', () => {
  const dist = walk(R('dist'));
  const gz = (ext) => dist.filter((f) => f.endsWith(ext)).reduce((n, f) => n + gzipSync(readFileSync(f)).length, 0);
  ok(gz('.js') <= 40 * 1024, `JS gz ${gz('.js')}`);
  ok(gz('.css') <= 16 * 1024, `CSS gz ${gz('.css')}`);
  ok(dist.filter((f) => f.endsWith('.woff2')).reduce((n, f) => n + statSync(f).size, 0) <= 150 * 1024, 'fonts over 150 kB');
  ok(statSync(R('dist/coin.webp')).size <= 60 * 1024, 'hero coin over 60 kB');
});

// =====================================================================================
// BROWSER GATES
// =====================================================================================

gate('13 palette: each token pixel matches the real asset at its stated coordinate', async () => {
  const map = { cover: 'reference/SAMPUL INITIATE JPG.jpg.jpeg', 'slide 1': 'reference/INITIATE 1.jpg.jpeg', 'brand/LOGO INITIATE PNG.png': 'brand/LOGO INITIATE PNG.png' };
  const rows = [...tokensCss.matchAll(/(#[0-9a-fA-F]{6});\s*\/\*[^*]*?·\s*([^(*]+?)\s*\((\d+),(\d+)\)/g)].map((m) => ({ hex: m[1], file: m[2].trim(), x: +m[3], y: +m[4] }));
  ok(rows.length >= 12, `parsed ${rows.length} rows`);
  const s = await serve(ROOT, 0);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${s.url}/public/favicon-48.png`);
  try {
    for (const r of rows) {
      const file = Object.entries(map).find(([k]) => r.file.includes(k))?.[1];
      ok(file, `unknown provenance file: ${r.file}`);
      const got = await p.evaluate(async ([url, x, y]) => {
        const img = new Image(); img.src = url; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
        return [...g.getImageData(x, y, 1, 1).data.slice(0, 3)];
      }, [`${s.url}/${encodeURI(file)}`, r.x, r.y]);
      const want = [1, 3, 5].map((i) => parseInt(r.hex.slice(i, i + 2), 16));
      ok(got.every((v, i) => Math.abs(v - want[i]) <= 3), `${r.hex} at ${r.file} (${r.x},${r.y}) reads ${got}`);
    }
  } finally { await ctx.close(); await s.close(); }
});

gate('14 no overflow at 360/390/430/1366/1440, and every control is 48px (absent and stated builds)', async () => {
  const problems = [];
  for (const [label, site] of [['absent', prod], ['stated', stated]]) {
    for (const [w, h] of BREAKPOINTS) {
      const t = await page(site, { width: w, height: h, clock: false });
      await settle(t.p, 600);
      const res = await t.p.evaluate(() => {
        const vw = document.documentElement.clientWidth, out = { sw: document.documentElement.scrollWidth, vw, over: [], small: [] };
        const skip = (el) => el.closest('.marquee, .grid-fx, [inert], dialog:not([open]), .sr-copy, .sprite');
        for (const el of document.querySelectorAll('body *')) {
          if (skip(el)) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          if (r.right > vw + 1 || r.left < -1) out.over.push(`${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).slice(0, 24)} ${Math.round(r.left)}..${Math.round(r.right)}`);
        }
        for (const el of document.querySelectorAll('a[href], button, summary, [role="slider"], [role="radio"], input, select, textarea')) {
          if (skip(el) || el.closest('dialog')) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          if (r.width < 47.5 || r.height < 47.5) out.small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        return out;
      });
      if (res.sw > res.vw) problems.push(`${label}@${w}: scrollWidth ${res.sw} > ${res.vw}`);
      if (res.over.length) problems.push(`${label}@${w}: overflowing ${res.over.slice(0, 3).join('; ')}`);
      if (res.small.length) problems.push(`${label}@${w}: under 48px ${res.small.slice(0, 3).join('; ')}`);
      await t.close();
    }
  }
  eq(problems, [], 'layout problems');
});

gate('15 contract slot: top of page, always visible; inert when absent, full copyable address when stated', async () => {
  const t = await page(prod, { clock: false });
  const { p } = t;
  const top = await p.evaluate(() => { const s = document.querySelector('[data-ca]'); const r = s.getBoundingClientRect(); return { top: r.top, text: s.textContent.trim(), interactive: s.querySelectorAll('a, button, [tabindex]').length, state: s.dataset.state }; });
  const { records } = await import(pathToFileURL(R('src/records.js')).href);
  if (records.ca.state === 'stated') {
    eq([top.top, top.interactive, top.state], [0, 1, 'ready'], 'stated slot position / interactivity');
    eq(top.text.replace(/\s+/g, '').replace(/^CA/, ''), records.ca.value, 'full address shown');
  } else {
    eq([top.top, top.interactive, top.state], [0, 0, 'absent'], 'slot position / interactivity');
    ok(/not published yet/i.test(top.text), 'absent text');
  }
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await settle(p, 300);
  const after = await p.evaluate(() => document.querySelector('[data-ca]').getBoundingClientRect().top);
  eq(after, 0, 'slot stays pinned after scrolling to the bottom');
  ok(!(await p.evaluate(() => /\b20[2-3]\d\b|\bsoon\b|coming|launching on/i.test(document.querySelector('main').innerText))), 'a date or promise appears while records are absent');
  await t.close();
});

gate('16 contract slot (stated): full address visible at every width, click copies it', async () => {
  const addr = JSON.parse(text(R('gates/fixtures/records-stated.json'))).ca.value;
  for (const w of [360, 1440]) {
    const t = await page(stated, { width: w, height: 800, clock: false });
    const { p } = t;
    const v = await p.evaluate(() => { const c = document.querySelector('[data-ca-value]'); const r = c.getBoundingClientRect(); return { text: c.textContent, l: r.left, r: r.right, vw: innerWidth, clipped: c.scrollWidth > c.clientWidth + 1, top: document.querySelector('[data-ca]').getBoundingClientRect().top }; });
    eq(v.text, addr, `full address @${w}`);
    ok(v.l >= 0 && v.r <= v.vw && !v.clipped, `address clipped @${w}`);
    eq(v.top, 0, `pinned @${w}`);
    if (w === 1440) {
      await p.evaluate(() => window.scrollTo(0, 2500));
      await settle(p, 200);
      await p.click('.ca-copy');
      eq(await p.evaluate(() => navigator.clipboard.readText()), addr, 'clipboard contents');
      await p.waitForFunction(() => document.querySelector('.ca-copy').classList.contains('copied') && document.querySelector('#toast').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});
      ok(await p.evaluate(() => document.querySelector('.ca-copy').classList.contains('copied') && document.querySelector('#toast').classList.contains('show')), 'copied feedback');
    }
    await t.close();
  }
});

gate('17 socials: X and GitHub icon-only top right; inert without href until stated', async () => {
  const a = await page(prod, { clock: false });
  const absent = await a.p.evaluate(() => [...document.querySelectorAll('[data-social]')].map((e) => ({ tag: e.tagName, href: e.getAttribute('href'), tab: e.tabIndex, text: e.textContent.trim(), x: e.getBoundingClientRect().right, label: e.getAttribute('aria-label') })));
  eq(absent.map((s) => [s.tag, s.href, s.tab, s.text]), [['SPAN', null, -1, ''], ['SPAN', null, -1, '']], 'absent socials');
  ok(absent.every((s) => /not published yet/.test(s.label)), 'inert label');
  const dom = await a.p.content();
  ok(!/href="https:\/\/(x|twitter|github)\.com/.test(dom), 'social href leaked while absent');
  await a.close();
  const s = await page(stated, { clock: false });
  const live = await s.p.evaluate(() => [...document.querySelectorAll('[data-social]')].map((e) => ({ href: e.getAttribute('href'), rel: e.rel, label: e.getAttribute('aria-label'), text: e.textContent.trim() })));
  eq(live.map((l) => l.href), ['https://x.com/acme_fixture', 'https://github.com/acme-fixture'], 'stated hrefs');
  ok(live[0].label.includes('@acme_fixture') && live[1].label.includes('acme-fixture'), 'handle derived from URL');
  ok(live.every((l) => /noopener/.test(l.rel) && l.text === ''), 'rel / icon-only');
  const launcher = await s.p.evaluate(() => document.querySelector('[data-launcher-link]')?.getAttribute('href'));
  eq(launcher, 'https://launch.example.test/app', 'stated launcher links');
  await s.close();
  const a2 = await page(prod, { clock: false });
  eq(await a2.p.evaluate(() => !!document.querySelector('[data-launcher-inert]') && !document.querySelector('[data-launcher-link]')), true, 'launcher inert while absent');
  await a2.close();
});

gate('18 live data: skeletons first, then formatted values from the synthetic chain', async () => {
  const t = await page(prod, { hold: true });
  const { p } = t;
  await tick(p, 50);
  const before = await p.evaluate(() => ({
    stats: [...document.querySelectorAll('[data-stat]')].map((s) => s.dataset.state),
    skelVisible: [...document.querySelectorAll('.stat .skel')].every((e) => getComputedStyle(e).display !== 'none' || e.closest('[data-stat="network"]')),
    chart: document.querySelector('[data-chart]').dataset.state, marquee: document.querySelector('[data-marquee]').dataset.state,
    skelPills: document.querySelectorAll('.tok-skel').length,
  }));
  eq(before.stats, ['loading', 'loading', 'loading', 'ready'], 'stats while requests are held (network number is static)');
  ok(before.skelVisible && before.skelPills >= 8 && before.chart === 'loading' && before.marquee === 'loading', 'skeletons');
  t.network.unhold();
  await p.waitForFunction(() => document.querySelector('[data-stat="gas"]').dataset.state === 'ready' && document.querySelector('[data-stat="tvl"] [data-val]').dataset.value, null, { timeout: 20000 });
  await tick(p, 2500); await settle(p, 200);
  const after = await p.evaluate(() => ({ tvl: document.querySelector('[data-stat="tvl"] [data-val]').textContent, block: document.querySelector('[data-stat="block"] [data-val]').textContent, gas: document.querySelector('[data-stat="gas"] [data-val]').textContent, net: document.querySelector('[data-stat="network"] [data-val]').textContent, states: [...document.querySelectorAll('[data-stat]')].map((s) => s.dataset.state), chart: document.querySelector('[data-chart]').dataset.state }));
  eq(after.tvl, '$1.23B', 'TVL'); eq(after.block, (FIXTURE.block0).toLocaleString('en-US'), 'block'); eq(after.gas, '0.0219', 'gas gwei'); eq(after.net, '4663', 'network');
  eq(after.states, ['ready', 'ready', 'ready', 'ready'], 'ready states'); eq(after.chart, 'ready', 'chart ready');
  eq(t.errors, [], 'console errors');
  await t.close();
});

gate('19 numbers count up, then flash up or down when a later reading differs', async () => {
  const t = await page(prod, {
    hold: true,
    init: () => { window.__seen = []; addEventListener('DOMContentLoaded', () => { const el = document.querySelector('[data-stat="block"] [data-val]'); new MutationObserver(() => window.__seen.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true }); window.__flash = { block: [], gas: [] }; for (const k of ['block', 'gas']) { const v = document.querySelector('[data-stat="' + k + '"] [data-val]'); new MutationObserver(() => { for (const c of ['flash-up', 'flash-down']) if (v.classList.contains(c) && !window.__flash[k].includes(c)) window.__flash[k].push(c); }).observe(v, { attributes: true, attributeFilter: ['class'] }); } }); },
  });
  const { p } = t;
  t.network.unhold();
  await settle(p, 400); await tick(p, 2500); await settle(p, 200);
  const seen = (await p.evaluate(() => window.__seen)).map((x) => Number(x.replace(/,/g, '')));
  ok(new Set(seen).size >= 4, `count-up should pass through several values, saw ${seen.length}`);
  ok(seen[0] < FIXTURE.block0 && seen.every((v, i) => i === 0 || v >= seen[i - 1]) && seen.at(-1) === FIXTURE.block0, `count-up should climb to the reading: ${seen.slice(0, 4)}...${seen.at(-1)}`);
  eq(await p.evaluate(() => document.querySelector('[data-stat="block"] [data-val]').dataset.value), String(FIXTURE.block0), 'first reading');
  await tick(p, 6000); await settle(p, 250); await tick(p, 100);
  const up = await p.evaluate(() => ({ v: document.querySelector('[data-stat="block"] [data-val]').dataset.value, delta: document.querySelector('[data-stat="block"] [data-delta]').textContent, flash: window.__flash }));
  eq(up.v, String(FIXTURE.block0 + 25), 'second reading');
  ok(up.flash.block.includes('flash-up') && !up.flash.block.includes('flash-down'), `block rose, flash was ${JSON.stringify(up.flash.block)}`);
  ok(up.flash.gas.includes('flash-down'), `gas fell, flash was ${JSON.stringify(up.flash.gas)}`);
  ok(/^\+25 in \d+s$/.test(up.delta), `block delta ${up.delta}`);
  await t.close();
});

gate('20 status pill: connecting, live with pulsing dot, then delayed and unreachable', async () => {
  const t = await page(prod, { hold: true });
  const { p } = t;
  const st = () => p.evaluate(() => [document.querySelector('[data-pill]').dataset.state, document.querySelector('[data-pill-mirror]').dataset.state]);
  eq(await st(), ['connecting', 'connecting'], 'before data');
  t.network.unhold(); await settle(p, 400); await tick(p, 500);
  eq(await st(), ['live', 'live'], 'after data');
  const anim = await p.evaluate(() => getComputedStyle(document.querySelector('[data-pill] .dot'), '::after').animationName);
  ok(/ping/.test(anim), `live dot should pulse, animation is ${anim}`);
  t.network.failRpc = true;
  await tick(p, 40000);
  eq((await st())[0], 'stale', 'after failed polls (data still on screen)');
  await t.close();
});

gate('21 reduced motion: everything is instant and nothing runs', async () => {
  const t = await page(prod, { reduced: true });
  const { p } = t;
  await settle(p, 400); await tick(p, 500);
  const r = await p.evaluate(() => ({
    hidden: [...document.querySelectorAll('[data-reveal]')].filter((e) => getComputedStyle(e).opacity !== '1').length,
    anim: document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || a.transitionProperty),
    block: document.querySelector('[data-stat="block"] [data-val]').textContent,
    marquee: getComputedStyle(document.querySelector('.marquee-track')).animationName,
    dash: getComputedStyle(document.querySelector('.step-glyph path')).strokeDashoffset,
  }));
  eq(r.hidden, 0, 'reveal elements left hidden'); eq(r.anim, [], 'running animations');
  eq(r.block, FIXTURE.block0.toLocaleString('en-US'), 'value appears without counting'); eq(r.marquee, 'none', 'marquee'); ok(parseFloat(r.dash) === 0, 'glyphs drawn');
  await t.close();
});

gate('22 scroll: progress bar tracks position, reveals stagger in, parallax moves the hero art', async () => {
  const t = await page(prod, { clock: false });
  const { p } = t;
  await settle(p, 600);
  const bar = () => p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('[data-progress]')).transform).a);
  ok((await bar()) < 0.01, 'bar at top');
  await p.evaluate(() => window.scrollTo(0, 600));
  await settle(p, 400);
  const y0 = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.float-chip')).transform).f);
  ok(Math.abs(y0) > 30, `parallax should have moved the chip, f=${y0}`);
  await p.evaluate(() => window.scrollTo(0, 0));
  await settle(p, 300);
  const below = await p.evaluate(() => { const s = [...document.querySelectorAll('.step')]; return { op: getComputedStyle(s[0]).opacity, delays: s.map((e) => getComputedStyle(e).transitionDelay.split(',')[0]) }; });
  eq(below.op, '0', 'below-the-fold element hidden before it scrolls in');
  eq(below.delays, ['0s', '0.085s', '0.17s'], 'stagger');
  await p.evaluate(() => document.querySelector('#flow').scrollIntoView({ behavior: 'instant' }));
  await settle(p, 1400);
  eq(await p.evaluate(() => [...document.querySelectorAll('.step')].map((e) => getComputedStyle(e).opacity)), ['1', '1', '1'], 'steps revealed');
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await settle(p, 500);
  ok((await bar()) > 0.98, 'bar at bottom');
  await t.close();
});

gate('23 seal slider: drag, keys and readout; reward only when fully sealed', async () => {
  const t = await page(prod);
  const { p } = t;
  await p.evaluate(() => document.querySelector('[data-veil]').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await settle(p, 500); await tick(p, 1500);
  const val = () => p.evaluate(() => Number(document.querySelector('[data-veil-knob]').getAttribute('aria-valuenow')));
  eq(await val(), 32, 'intro glide');
  const box = await p.locator('[data-veil-stage]').boundingBox();
  await p.mouse.move(box.x + box.width * 0.32, box.y + box.height / 2);
  await p.mouse.down(); await p.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 4 }); await tick(p, 900); await p.mouse.up();
  const v = await val(); ok(v >= 66 && v <= 74, `drag to 70%, got ${v}`);
  ok(!(await p.evaluate(() => document.querySelector('[data-veil-reward]').classList.contains('show'))), 'reward early');
  await p.locator('[data-veil-knob]').focus();
  await p.keyboard.press('End'); await tick(p, 1500);
  eq(await val(), 100, 'End key');
  const full = await p.evaluate(() => ({ show: document.querySelector('[data-veil-reward]').classList.contains('show'), txt: document.querySelector('[data-veil-reward]').textContent, clip: getComputedStyle(document.querySelector('.ledger-open')).clipPath, vt: document.querySelector('[data-veil-knob]').getAttribute('aria-valuetext') }));
  ok(full.show && /sealed/i.test(full.txt) && full.vt === '100% sealed', `reward ${JSON.stringify(full)}`);
  await p.keyboard.press('Home'); await tick(p, 1500);
  eq(await val(), 0, 'Home key');
  await t.close();
});

gate('24 pairs: radio group with arrow keys, one checked, stage follows', async () => {
  const t = await page(prod, { clock: false });
  const { p } = t;
  await p.evaluate(() => document.querySelector('[data-pairs]').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await settle(p, 500);
  const read = () => p.evaluate(() => ({ checked: [...document.querySelectorAll('.pchip')].filter((b) => b.getAttribute('aria-checked') === 'true').length, label: document.querySelector('[data-pair-label]').textContent, href: document.querySelector('[data-pair-use]').getAttribute('href'), tab: [...document.querySelectorAll('.pchip')].filter((b) => b.tabIndex === 0).length }));
  const first = await read(); eq([first.checked, first.tab], [1, 1], 'initial');
  await p.locator('.pchip').first().focus();
  await p.keyboard.press('ArrowRight'); await settle(p, 100);
  const second = await read();
  ok(second.label !== first.label && second.href !== first.href && second.checked === 1, 'arrow right moves selection and stage');
  await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); await settle(p, 100);
  eq((await read()).label, 'An idea', 'wraps around');
  await t.close();
});

gate('25 marquee: live tokens, doubled for looping, sanitised, pauses on hover', async () => {
  const t = await page(prod, { clock: false });
  const { p } = t;
  await settle(p, 1800);
  const m = await p.evaluate(() => {
    const sets = [...document.querySelectorAll('.marquee-set')];
    const links = [...sets[0].querySelectorAll('a.tok')];
    return { n: sets.length, counts: sets.map((s) => s.children.length), dupInert: sets[1]?.hasAttribute('inert') && sets[1]?.getAttribute('aria-hidden') === 'true', dupLinks: sets[1]?.querySelectorAll('a').length, hrefs: links.map((a) => a.href), rels: links.every((a) => /noopener/.test(a.rel)), imgs: [...document.querySelectorAll('.tok-img img')].map((i) => new URL(i.src).hostname), syms: [...sets[0].querySelectorAll('.tok-sym')].map((e) => e.textContent), pwned: window.__pwned, injected: document.querySelectorAll('.marquee img[onerror]').length, state: document.querySelector('[data-marquee]').dataset.state, anim: getComputedStyle(document.querySelector('.marquee-track')).animationName };
  });
  eq([m.n, m.counts[0] === m.counts[1], m.dupInert, m.dupLinks, m.state], [2, true, true, 0, 'ready'], 'structure');
  ok(m.hrefs.length === 4 && m.hrefs.every((h) => h.startsWith('https://dexscreener.com/robinhood/0x')), `hrefs ${m.hrefs}`);
  ok(m.rels && m.imgs.every((h) => h === 'cdn.dexscreener.com'), 'rel / image hosts');
  ok(m.syms.includes('ALFA') && m.syms.every((s) => !/[<>]/.test(s)), `symbols ${m.syms}`);
  eq([m.pwned, m.injected], [undefined, 0], 'hostile symbol must not execute');
  ok(/marquee/.test(m.anim), 'scrolling');
  await p.hover('[data-marquee]', { force: true });
  eq(await p.evaluate(() => getComputedStyle(document.querySelector('.marquee-track')).animationPlayState), 'paused', 'hover pauses');
  await t.close();
});

gate('26 chart: one point per day, draws in, scrubs to a dated value', async () => {
  const t = await page(prod, { clock: false });
  const { p } = t;
  await settle(p, 1500);
  await p.evaluate(() => document.querySelector('[data-chart]').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await settle(p, 2500);
  const c = await p.evaluate(() => { const d = document.querySelector('[data-chart-line]').getAttribute('d'); return { pts: (d.match(/[ML]/g) || []).length, drawn: document.querySelector('[data-chart-line]').classList.contains('draw'), sub: document.querySelector('[data-chart-sub]').textContent }; });
  eq(c.pts, 90, 'last ninety days'); ok(c.drawn, 'draw-in ran'); ok(/over 90 days/.test(c.sub), c.sub);
  const box = await p.locator('[data-chart-area]').boundingBox();
  await p.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await settle(p, 200);
  const tip = await p.evaluate(() => ({ hidden: document.querySelector('[data-chart-tip]').hidden, txt: document.querySelector('[data-chart-tip]').textContent }));
  ok(!tip.hidden && /\$1\.\d+B/.test(tip.txt) && /\d{4}/.test(tip.txt), `tip ${tip.txt}`);
  await t.close();
});

gate('27 records list mirrors the register: published rows link only when stated', async () => {
  const a = await page(prod, { clock: false });
  const rowsA = await a.p.evaluate(() => [...document.querySelectorAll('[data-records] .rec')].map((r) => ({ name: r.querySelector('b').textContent, chip: r.querySelector('.chip-state').textContent, link: r.tagName === 'A' })));
  const { records: prodRecords } = await import(pathToFileURL(R('src/records.js')).href);
  const caChip = prodRecords.ca.state === 'stated' ? 'Published' : 'Not yet';
  eq(rowsA.map((r) => [r.name, r.chip, r.link]), [['Network', 'Published', false], ['Domain', 'Published', false], ['Contract address', caChip, false], ['Launcher', 'Not yet', false], ['X', 'Not yet', false], ['GitHub', 'Not yet', false]], 'absent build');
  await a.close();
  const s = await page(stated, { clock: false });
  const rowsS = await s.p.evaluate(() => [...document.querySelectorAll('[data-records] .rec')].map((r) => ({ name: r.querySelector('b').textContent, chip: r.querySelector('.chip-state').textContent, link: r.tagName === 'A', detail: r.querySelector('.rec-name span').textContent })));
  eq(rowsS.map((r) => [r.name, r.chip, r.link]), [['Network', 'Published', false], ['Domain', 'Published', false], ['Contract address', 'Published', false], ['Launcher', 'Published', true], ['X', 'Published', true], ['GitHub', 'Published', true]], 'stated build');
  eq(rowsS[4].detail, '@acme_fixture', 'X handle derived');
  await s.close();
});

gate('28 accessibility basics: landmarks, names, unique ids, visible focus, FAQ toggles', async () => {
  const t = await page(prod, { clock: false });
  const { p } = t;
  const a = await p.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    const unnamed = [...document.querySelectorAll('a[href], button, [role="slider"], [role="radio"], summary')].filter((e) => !(e.getAttribute('aria-label') || e.textContent.trim())).length;
    return { h1: document.querySelectorAll('h1').length, lang: document.documentElement.lang, landmarks: ['main', 'header', 'footer', 'nav'].map((s) => !!document.querySelector(s)), dupIds: ids.length - new Set(ids).size, unnamed, imgNoAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length };
  });
  eq([a.h1, a.lang, a.landmarks, a.dupIds, a.unnamed, a.imgNoAlt], [1, 'en', [true, true, true, true], 0, 0, 0], 'structure');
  const outlines = [];
  for (let i = 0; i < 10; i++) { await p.keyboard.press('Tab'); outlines.push(await p.evaluate(() => { const e = document.activeElement; const c = getComputedStyle(e); return e === document.body || (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) >= 2); })); }
  ok(outlines.every(Boolean), `focus ring missing on a tab stop: ${outlines}`);
  await p.evaluate(() => document.querySelector('#faq').scrollIntoView({ behavior: 'instant' }));
  await settle(p, 500);
  await p.locator('.faq summary').first().click(); await settle(p, 700);
  ok(await p.evaluate(() => document.querySelector('.faq details').open && document.querySelector('.faq details .ans').getBoundingClientRect().height > 20), 'FAQ opens');
  await t.close();
});

gate('29 network hygiene: only allow-listed hosts, no console errors, nothing cached by the page', async () => {
  const t = await page(prod);
  const { p } = t;
  await settle(p, 500); await tick(p, 8000); await settle(p, 400);
  const allowed = new Set(['127.0.0.1', 'rpc.mainnet.chain.robinhood.com', 'api.llama.fi', 'api.dexscreener.com', 'cdn.dexscreener.com']);
  eq([...t.network.hosts].filter((h) => !allowed.has(h)), [], 'unexpected hosts'); eq(t.network.refused, [], 'refused requests');
  eq(t.errors, [], 'console / page errors');
  ok(t.network.rpcCalls >= 2, `RPC should have polled, calls=${t.network.rpcCalls}`);
  eq(await p.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie]), [0, 0, ''], 'page stores nothing');
  await t.close();
});

gate('30 hero: one headline, reads at 360, status mirrored, art present and decorative', async () => {
  const t = await page(prod, { width: 360, height: 780, clock: false });
  const { p } = t;
  await settle(p, 1500);
  const h = await p.evaluate(() => { const h1 = document.querySelector('h1'); const r = h1.getBoundingClientRect(); return { text: h1.textContent.trim(), w: r.width, fs: parseFloat(getComputedStyle(h1).fontSize), art: document.querySelector('.hero-art').getAttribute('aria-hidden'), coin: document.querySelector('.coin').complete && document.querySelector('.coin').naturalWidth, pill: document.querySelector('[data-pill-mirror-text]').textContent }; });
  eq(h.text, 'Private when it matters.', 'headline'); ok(h.fs >= 36 && h.w <= 360, `h1 ${h.fs}px ${h.w}w`);
  eq(h.art, 'true', 'art decorative'); ok(h.coin === 560, 'coin loaded'); ok(/^Robinhood Chain · /.test(h.pill), h.pill);
  await t.close();
});

// =====================================================================================
ok(gates.length <= 30, `${gates.length} gates; the limit is 30`);

const builds = [];
function buildStated() {
  const out = '.gate-stated';
  rmSync(R(out), { recursive: true, force: true });
  const r = spawnSync(process.execPath, [R('node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'error'], { cwd: ROOT, env: { ...process.env, INITIATE_RECORDS_FIXTURE: R('gates/fixtures/records-stated.json'), INITIATE_OUT: out }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture build failed: ${r.stderr || r.stdout}`);
  return R(out);
}

const started = Date.now();
let failed = 0;
const servers = [];
try {
  ok(existsSync(R('dist/index.html')), 'dist/ is missing; run npm run build first');
  const fixtureDir = buildStated();
  prod = await serve(R('dist'), 0); stated = await serve(fixtureDir, 0); servers.push(prod, stated);
  browser = await chromium.launch({ executablePath: EDGE, args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const g of gates) {
    if (process.env.GATE_ONLY && !process.env.GATE_ONLY.split(",").some((n) => g.name.startsWith(n))) continue;
    const t0 = Date.now();
    try {
      await Promise.race([g.fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('gate timed out after 120s')), 120000))]);
      console.log(`PASS  ${g.name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      failed++;
      console.log(`FAIL  ${g.name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)\n      ${String(e.message).split('\n').join('\n      ')}`);
    }
    for (const c of open) await Promise.race([c.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    open.clear();
  }
} catch (e) {
  failed++;
  console.log(`SETUP FAILED: ${e.message}`);
} finally {
  await Promise.race([browser?.close(), new Promise((r) => setTimeout(r, 4000))]);
  for (const s of servers) await s.close().catch(() => {});
  rmSync(R('.gate-stated'), { recursive: true, force: true });
}
console.log(`\n${gates.length - failed}/${gates.length} gates passed in ${((Date.now() - started) / 1000).toFixed(0)}s`);
process.exit(failed ? 1 : 0);
void builds;
