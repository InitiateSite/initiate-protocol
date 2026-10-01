// Builds gates/fixtures/reference-bigrams.json from a folder of saved reference sources.
// Usage: node scripts/ref-bigrams.mjs <dir-with-reference-files>
// Deliberately over-inclusive: every quoted string and every run of text between
// tags counts, so the copy gate errs on the side of rejecting a phrase.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('pass the folder holding the saved reference files');

const words = (s) => s.toLowerCase().replace(/[’']/g, '').match(/[a-z0-9$]+/g) ?? [];
const bigramsOf = (text) => {
  const w = words(text), out = new Set();
  for (let i = 0; i < w.length - 1; i++) out.add(`${w[i]} ${w[i + 1]}`);
  return out;
};
const strip = (s) => s.replace(/\$\{[^}]*\}/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
const segments = (src) => {
  const segs = [];
  for (const m of src.matchAll(/`([^`]*)`|'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) segs.push(strip(m[1] ?? m[2] ?? m[3]));
  for (const m of src.matchAll(/>([^<>{}]{3,})</g)) segs.push(m[1]);
  return segs;
};

const all = new Set();
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(mjs|html|webmanifest)$/.test(f)) for (const s of segments(readFileSync(p, 'utf8'))) for (const b of bigramsOf(s)) all.add(b);
  }
};
walk(dir);
writeFileSync('gates/fixtures/reference-bigrams.json', JSON.stringify([...all].sort()));
console.log('bigrams', all.size);
