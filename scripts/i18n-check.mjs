// CI check: every t('...') in src/ must have a Malay, Chinese and Burmese entry in src/strings.js.
// Usage: node scripts/i18n-check.mjs [repo-dir]   (exits 1 when something is missing)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = path.resolve(process.argv[2] || '.');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-')), 'strings.mjs');
fs.copyFileSync(path.join(repo, 'src/strings.js'), tmp);
const S = (await import(pathToFileURL(tmp))).default;

const files = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(jsx?|mjs)$/.test(f) && !f.includes('strings') && !f.includes('.test.')) files.push(p);
  }
};
walk(path.join(repo, 'src'));

const keys = new Set();
const re = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = re.exec(s))) keys.add(m[2].replace(/\\(['"\\])/g, '$1'));
}

let missing = 0;
for (const k of keys) {
  for (const l of ['ms', 'zh', 'my']) {
    if (!(k in S[l])) {
      missing += 1;
      console.log(`missing ${l}: ${k}`);
    }
  }
}
console.log(`${keys.size} keys, ${missing} missing`);
process.exit(missing ? 1 : 0);
