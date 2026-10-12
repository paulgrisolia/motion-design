// Frame-by-frame renderer: serves the repo, drives Chromium with window.seek(t), writes PNG frames.
// usage: node scripts/render.mjs [--out out/frames] [--from 0] [--to <duration>] [--fps 60] [--times 0.5,1,2] [--workers 4] [--lang en|fr]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1]]);
  return a;
}, []));
const OUT = path.resolve(ROOT, args.out || 'out/frames');
const FPS = +(args.fps || 60);
const TIMELINE = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/timeline.json'), 'utf8'));
const FROM = +(args.from || 0), TO = +(args.to || TIMELINE.duration);
const WORKERS = +(args.workers || 4);

const times = args.times
  ? args.times.split(',').map(Number)
  : Array.from({ length: Math.round((TO - FROM) * FPS) }, (_, i) => FROM + i / FPS);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.otf': 'font/otf' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'] });
const t0 = Date.now();
let done = 0;

async function worker(idx) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('pageerror', e));
  await page.goto(`http://localhost:${port}/src/index.html?render=1&lang=${args.lang || 'en'}`);
  await page.evaluate(() => window.ready);
  for (let i = idx; i < times.length; i += WORKERS) {
    const t = times[i];
    const url = await page.evaluate(tt => window.frameDataURL(tt), t);
    const name = args.times ? `t_${t.toFixed(2)}.png` : `f_${String(Math.round(t * FPS)).padStart(5, '0')}.png`;
    fs.writeFileSync(path.join(OUT, name), Buffer.from(url.split(',')[1], 'base64'));
    if (++done % 60 === 0) process.stdout.write(`  ${done}/${times.length} frames (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
  }
  await page.close();
}
await Promise.all(Array.from({ length: Math.min(WORKERS, times.length) }, (_, i) => worker(i)));
await browser.close();
server.close();
console.log(`rendered ${times.length} frames -> ${path.relative(ROOT, OUT)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
