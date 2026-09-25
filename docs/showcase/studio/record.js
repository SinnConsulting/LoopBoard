/* `node record.js [scene ...]` — records each scene to ../gifs/<scene>.gif (all scenes if none
 * are named). Runs inside the studio image: see the `showcase` target in the root Makefile. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { start } = require('./server');
const { Host } = require('./lib/host');
const { Recorder } = require('./lib/recorder');

const W = 1320;
const H = 848; // 800 of VS Code window + the 48px caption band
const SCENES = path.join(__dirname, 'scenes');
const GIFS = path.join(__dirname, '..', 'gifs');
const WORK = path.join(__dirname, '.frames');

async function mount(browser, base, scene) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-09-25T10:00:00') });
  if (scene.webviewState) await page.addInitScript((st) => { window.__studioState = st; }, scene.webviewState);
  const host = new Host(scene.workspace());
  if (scene.setup) scene.setup(host);
  await page.exposeBinding('__studioHost', (_src, pageName, msg) => { host.track(host.receive(pageName, msg)); });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.goto(base + '/');
  for (const name of ['board', 'sidebar', 'settings']) {
    const frame = await (await page.$(`#frame-${name}`)).contentFrame();
    await frame.waitForLoadState('load');
    host.frames[name] = frame;
  }
  host.stage = (fn, arg) => page.evaluate(fn, arg);
  // A webview's `ready` may have fired before the frames were registered — say hello again.
  await host.refresh();
  await host.postSettings();
  await page.evaluate(() => document.fonts.ready);
  for (const f of Object.values(host.frames)) {
    await f.evaluate(() => document.fonts.load('16px codicon')).catch(() => {});
    await f.evaluate(() => document.fonts.ready);
  }
  await page.evaluate((o) => window.stage.layout(o), scene.layout || {});
  await page.clock.runFor(50);
  return { context, page, host };
}

// `crop` = { x, y, width, height }: a scene that only needs part of the window is cut down to it
// here, after the full-window frames (and the loopBack cross-fade) were captured.
function encode(frames, out, crop) {
  const dir = path.dirname(frames[0].file);
  const list = frames.map((f) => `file '${path.basename(f.file)}'\nduration ${(f.ms / 1000).toFixed(3)}`).join('\n')
    + `\nfile '${path.basename(frames[frames.length - 1].file)}'\n`;
  fs.writeFileSync(path.join(dir, 'list.txt'), list);
  const raw = path.join(dir, 'raw.gif');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
    '-vf', (crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` : '') + 'split[a][b];[a]palettegen=max_colors=256:stats_mode=full:reserve_transparent=0[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    '-fps_mode', 'vfr', '-loop', '0', raw]);
  execFileSync('gifsicle', ['-O3', '--no-comments', '--no-names', '--no-extensions', '-o', out, raw]);
  return fs.statSync(out).size;
}

async function main() {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const stillOnly = process.argv.includes('--still');
  const all = fs.readdirSync(SCENES).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, '')).sort();
  const names = wanted.length ? all.filter((n) => wanted.some((w) => n.startsWith(w))) : all;
  fs.mkdirSync(GIFS, { recursive: true });
  const server = await start();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--no-sandbox', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'] });
  try {
    for (const name of names) {
      const scene = require(path.join(SCENES, name));
      const t0 = Date.now();
      const { context, page, host } = await mount(browser, base, scene);
      const rec = new Recorder(page, host, path.join(WORK, name));
      if (stillOnly) {
        await rec.settle();
        await page.screenshot({ path: path.join(WORK, `${name}-still.png`) });
      } else {
        await scene.run(rec, { page, host, board: page.frameLocator('#frame-board'), sidebar: page.frameLocator('#frame-sidebar'), settings: page.frameLocator('#frame-settings') });
        const total = rec.frames.reduce((s, f) => s + f.ms, 0);
        const size = encode(rec.frames, path.join(GIFS, `${name}.gif`), scene.crop);
        console.log(`${name}: ${rec.frames.length} frames, ${(total / 1000).toFixed(1)}s, ${(size / 1024).toFixed(0)} KB (${((Date.now() - t0) / 1000).toFixed(0)}s wall)`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
