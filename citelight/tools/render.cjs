#!/usr/bin/env node
/*
 * Render the Citelight film with headless Chromium.
 *
 *   node tools/render.cjs --stills 3.2,13.1,27 --format portrait    # PNG stills
 *   node tools/render.cjs --events audio/events.json                # timing for the score
 *   node tools/render.cjs --video renders/citelight-16x9.mp4 --fps 60 --audio audio/score.wav
 *
 * Every frame is a pure function of time, so frames are split across
 * parallel browser pages, encoded as segments, then joined losslessly.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

function loadPlaywright() {
  try { return require('playwright'); } catch (e) {
    const root = execSync('npm root -g').toString().trim();
    return require(path.join(root, 'playwright'));
  }
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? def : argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1];
};

const format = arg('format', 'landscape');
const SIZE = { landscape: [1920, 1080], portrait: [1080, 1920] }[format];
if (!SIZE) throw new Error('format must be landscape or portrait');
const [W, H] = SIZE;
const url = 'file://' + path.join(ROOT, 'index.html') + `?render=1&format=${format}`;

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('[page error]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('[console]', m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  return page;
}

const launch = () => chromium.launch({
  args: ['--font-render-hinting=none', '--force-color-profile=srgb', '--disable-lcd-text', '--hide-scrollbars'],
});

async function shot(page, t, type = 'png') {
  await page.evaluate(tt => window.__seek(tt), t);
  return page.screenshot({ type, clip: { x: 0, y: 0, width: W, height: H }, ...(type === 'jpeg' ? { quality: 95 } : {}) });
}

function ffmpeg(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    p.on('close', code => (code === 0 ? resolve() : reject(new Error('ffmpeg failed:\n' + err.slice(-3000)))));
    p.on('error', reject);
    if (input) input(p.stdin);
  });
}

async function stills() {
  const times = String(arg('stills')).split(',').map(Number);
  const outdir = path.resolve(arg('outdir', path.join(ROOT, 'renders', 'stills')));
  const type = arg('jpeg') ? 'jpeg' : 'png';
  fs.mkdirSync(outdir, { recursive: true });
  const browser = await launch();
  const page = await openPage(browser);
  for (const t of times) {
    const buf = await shot(page, t, type);
    const f = path.join(outdir, `${format}-${t.toFixed(2)}.${type === 'jpeg' ? 'jpg' : 'png'}`);
    fs.writeFileSync(f, buf);
    console.log(f);
  }
  await browser.close();
}

async function events() {
  const out = path.resolve(arg('events'));
  const browser = await launch();
  const page = await openPage(browser);
  const ev = await page.evaluate(() => window.__events());
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(ev, null, 1));
  console.log('events →', out, `(${ev.hits.length} citation hits)`);
  await browser.close();
}

async function video() {
  const out = path.resolve(arg('video'));
  const fps = Number(arg('fps', 60));
  const from = Number(arg('from', 0));
  const to = Number(arg('to', 45));
  const crf = String(arg('crf', 19));
  const workers = Number(arg('workers', Math.max(1, Math.min(4, os.cpus().length))));
  const audioPath = arg('audio') ? path.resolve(arg('audio')) : null;
  const total = Math.round((to - from) * fps);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'citelight-'));
  const per = Math.ceil(total / workers);
  const started = Date.now();
  let done = 0;

  // one browser per worker: pages in a shared browser serialize on its compositor
  const segs = [];
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const a = w * per, b = Math.min(total, a + per);
    if (a >= b) return;
    const seg = path.join(tmp, `seg${w}.mp4`);
    segs[w] = seg;
    const browser = await launch();
    const page = await openPage(browser);
    await ffmpeg([
      '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-pix_fmt', 'yuv420p',
      '-profile:v', 'high', '-x264-params', 'aq-mode=3:aq-strength=0.9', '-g', String(fps * 2), '-bf', '3',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
      seg,
    ], async stdin => {
      for (let i = a; i < b; i++) {
        const buf = await shot(page, from + i / fps, 'jpeg');
        if (!stdin.write(buf)) await new Promise(r => stdin.once('drain', r));
        done++;
        if (done % fps === 0) {
          const el = (Date.now() - started) / 1000;
          process.stdout.write(`\r${done}/${total} frames · ${(done / el).toFixed(1)} fps · eta ${Math.round((total - done) / (done / el))}s   `);
        }
      }
      stdin.end();
    });
    await browser.close();
  }));
  process.stdout.write('\n');

  const list = path.join(tmp, 'list.txt');
  fs.writeFileSync(list, segs.filter(Boolean).map(s => `file '${s}'`).join('\n'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', list];
  if (audioPath) args.push('-ss', String(from), '-t', String(to - from), '-i', audioPath, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '256k', '-shortest');
  args.push('-c:v', 'copy', '-movflags', '+faststart', out);
  await ffmpeg(args);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('video →', out, `(${((Date.now() - started) / 1000).toFixed(0)}s)`);
}

(async () => {
  if (arg('stills')) await stills();
  else if (arg('events')) await events();
  else if (arg('video')) await video();
  else console.log('usage: --stills t1,t2 | --events file.json | --video out.mp4 [--fps 60] [--format portrait] [--audio score.wav]');
})().catch(e => { console.error(e); process.exit(1); });
