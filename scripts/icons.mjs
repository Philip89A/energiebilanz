// Erzeugt die App-Icons (PNG) aus icons/icon.svg über den Browser.
// Aufruf: npx -y -p playwright node scripts/icons.mjs   (optional CHROMIUM_PATH)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('../icons/', import.meta.url));
const svg = readFileSync(dir + 'icon.svg', 'utf8');
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const p = await b.newPage();
// maskable: Motiv auf 80 % verkleinert, voller Hintergrund (Android schneidet Kreise/Formen aus)
const out = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['apple-touch-icon.png', 180, false], ['icon-maskable-512.png', 512, true]];
for (const [name, size, mask] of out) {
  await p.setViewportSize({ width: size, height: size });
  const inner = mask
    ? `<div style="width:${size}px;height:${size}px;background:#18212B;display:flex;align-items:center;justify-content:center"><div style="width:${size * 0.8}px;height:${size * 0.8}px">${svg.replace('rx="112"', 'rx="0"')}</div></div>`
    : `<div style="width:${size}px;height:${size}px">${svg}</div>`;
  await p.setContent(`<style>html,body{margin:0;background:transparent}svg{width:100%;height:100%;display:block}</style>${inner}`);
  await p.screenshot({ path: dir + name, omitBackground: true });
  console.log('geschrieben:', name);
}
await b.close();
