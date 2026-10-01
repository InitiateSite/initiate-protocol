import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Everything the build needs to know about colour or the outside world is read from the two
// sources of truth (src/tokens.css, src/records.js); nothing is repeated here.
const tokensCss = readFileSync(new URL('./src/tokens.css', import.meta.url), 'utf8');
const token = (name) => {
  const m = tokensCss.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${name} missing from src/tokens.css`);
  return m[1];
};
const { records } = await import('./src/records.js');

const JS_FLAG = "document.documentElement.classList.add('js')";
const jsFlagHash = `sha256-${createHash('sha256').update(JS_FLAG).digest('base64')}`;

// The test build swaps the register for a fixture (gates/fixtures/*.json) so the "stated" paths
// can be exercised without shipping any way to do it in production.
const fixture = process.env.INITIATE_RECORDS_FIXTURE
  ? JSON.parse(readFileSync(process.env.INITIATE_RECORDS_FIXTURE, 'utf8'))
  : {};

const shell = () => ({
  name: 'initiate-shell',
  transformIndexHtml: {
    order: 'pre',
    handler(html, ctx) {
      const csp = [
        "default-src 'self'",
        `script-src 'self' '${jsFlagHash}'`,
        "style-src 'self'",
        "img-src 'self' data: https://cdn.dexscreener.com",
        "font-src 'self'",
        `connect-src 'self' ${new URL(records.chain.value.rpc).origin} https://api.llama.fi https://api.dexscreener.com`,
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
      ].join('; ');
      const cspTag = ctx.server ? '' : `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
      return html
        .replaceAll('%THEME%', token('bg'))
        .replaceAll('%SITE%', records.domain.value)
        .replace('%JS_FLAG%', JS_FLAG)
        .replace('%CSP%', cspTag);
    },
  },
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'manifest.webmanifest',
      source: JSON.stringify(
        {
          name: 'Initiate',
          short_name: 'Initiate',
          description: 'Private when it matters. Coins on Robinhood Chain.',
          start_url: '/',
          display: 'standalone',
          background_color: token('bg'),
          theme_color: token('bg'),
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          ],
        },
        null,
        2,
      ),
    });
  },
});

export default defineConfig({
  plugins: [shell()],
  define: { __RECORDS_OVERRIDE__: JSON.stringify(fixture) },
  build: {
    outDir: process.env.INITIATE_OUT || 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    sourcemap: false,
    target: 'es2022',
  },
  server: { host: '127.0.0.1', port: 5173 },
});
