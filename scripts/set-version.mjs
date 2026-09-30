// Setzt die Versionskennung (?v=…) in index.html und allen Modul-Imports, damit Browser und GitHub Pages
// nach einem Update keine alten Dateien mit neuen mischen. Bei jedem Release ausführen:
//   node scripts/set-version.mjs 0.4.1
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const v = process.argv[2];
if (!/^\d+\.\d+(\.\d+)?$/.test(v || '')) { console.error('Aufruf: node scripts/set-version.mjs 0.4.1'); process.exit(1); }
const root = fileURLToPath(new URL('..', import.meta.url));
const edit = (file, fn) => { const p = root + file, a = readFileSync(p, 'utf8'), b = fn(a); if (a !== b) { writeFileSync(p, b); console.log('aktualisiert:', file); } };

edit('index.html', s => s
  .replace(/(href="css\/[^"?]+\.css)(\?v=[^"]*)?"/g, `$1?v=${v}"`)
  .replace(/(src="(?:vendor|js)\/[^"?]+\.js)(\?v=[^"]*)?"/g, `$1?v=${v}"`)
  .replace(/<meta name="app-version" content="[^"]*">/, `<meta name="app-version" content="${v}">`));
for (const f of readdirSync(root + 'js').filter(f => f.endsWith('.js'))) {
  edit('js/' + f, s => s.replace(/(from\s+'\.{1,2}\/[^'?]+\.js)(\?v=[^']*)?'/g, `$1?v=${v}'`));
}
