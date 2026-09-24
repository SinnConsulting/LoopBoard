/* Deterministic frame recorder.
 *
 * Time never runs on its own: Playwright's fake clock owns every timer in the page (setTimeout,
 * setInterval, requestAnimationFrame, Date), and stage.advance() steps every CSS animation and
 * transition by hand. A frame is "screenshot, then hold it for N ms, then advance the world by
 * N ms" — so the GIF's timing is exactly the timing written in the scene, and two runs of the
 * same scene produce the same frames.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FRAME = 40; // ms per motion frame (25 fps) — GIF delays are centiseconds, and < 20ms is clamped by browsers
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

class Recorder {
  constructor(page, host, dir) {
    this.page = page;
    this.host = host;
    this.dir = dir;
    this.frames = [];
    this.cursor = { x: 640, y: 420, shown: false };
    this.cap = null; // { step, html }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }

  stage(fn, arg) { return this.page.evaluate(fn, arg); }

  // Let the webview → host → webview round trip land (bindings are async), then run the page's
  // own zero-delay work (rAF repaints, focus restores).
  async settle() {
    for (let i = 0; i < 3; i++) {
      await this.page.evaluate(() => 0);
      await this.host.idle();
    }
    await this.page.clock.runFor(1);
  }

  async tick(ms) {
    await this.page.clock.runFor(ms);
    await this.stage((dt) => window.stage.advance(dt), ms);
  }

  async snap(ms = FRAME) {
    await this.settle();
    const file = path.join(this.dir, `f${String(this.frames.length).padStart(5, '0')}.png`);
    await this.page.screenshot({ path: file, caret: 'initial' });
    this.frames.push({ file, ms });
    await this.tick(ms);
  }

  hold(ms) { return this.snap(ms); }

  // ---------------------------------------------------------------- cursor
  async placeCursor(x, y) {
    this.cursor = { x, y, shown: true };
    await this.stage(([a, b]) => window.stage.cursor(a, b, 1), [x, y]);
    await this.page.mouse.move(x, y);
  }

  async hideCursor() {
    this.cursor.shown = false;
    await this.stage(() => window.stage.cursor(-100, -100, 1));
  }

  // Glide the cursor to (x, y) along a gentle arc with ease-in-out, moving the REAL mouse along so
  // hover styles in the webviews light up exactly as they would for a user.
  async moveTo(x, y, ms = 520) {
    const from = { ...this.cursor };
    if (!from.shown) return this.placeCursor(x, y);
    const n = Math.max(2, Math.round(ms / FRAME));
    const dx = x - from.x, dy = y - from.y;
    const bow = Math.min(60, Math.hypot(dx, dy) * 0.12);
    for (let i = 1; i <= n; i++) {
      const t = ease(i / n);
      const off = Math.sin(Math.PI * t) * bow;
      const len = Math.hypot(dx, dy) || 1;
      const cx = from.x + dx * t + (-dy / len) * off;
      const cy = from.y + dy * t + (dx / len) * off;
      this.cursor = { x: cx, y: cy, shown: true };
      await this.stage(([a, b]) => window.stage.cursor(a, b, 1), [cx, cy]);
      await this.page.mouse.move(cx, cy);
      if (i < n) await this.snap(FRAME);
    }
  }

  // Resolve a locator (possibly inside an iframe) to page coordinates.
  async point(locator, where) {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const box = await locator.boundingBox();
    if (!box) throw new Error('no bounding box for ' + locator);
    const w = where || {};
    return {
      x: box.x + (w.dx != null ? w.dx : box.width / 2),
      y: box.y + (w.dy != null ? w.dy : box.height / 2),
      box,
    };
  }

  async moveToLocator(locator, where, ms) {
    const p = await this.point(locator, where);
    await this.moveTo(p.x, p.y, ms);
    return p;
  }

  // Move, press (cursor dips + ripple), perform the real click, and let the ripple play out.
  async click(locator, opts) {
    const o = opts || {};
    const p = await this.moveToLocator(locator, o.where, o.ms);
    await this.snap(o.dwell || 120);
    await this.stage(([a, b]) => { window.stage.cursor(a, b, 0.86); window.stage.ripple(a, b, 0); }, [p.x, p.y]);
    await this.snap(FRAME);
    // `select` = a native <select>: its popup is drawn outside the page and never reaches a
    // screenshot, so the pick is made programmatically (dispatching the same `change` event).
    if (o.fake) { /* stage chrome, not a webview: the caller applies the effect */ }
    else if (o.select != null) await locator.selectOption(o.select);
    else if (o.button === 'right') await this.page.mouse.click(p.x, p.y, { button: 'right' });
    else await this.page.mouse.click(p.x, p.y);
    await this.stage(([a, b]) => window.stage.cursor(a, b, 1), [p.x, p.y]);
    for (let i = 1; i <= 6; i++) {
      await this.stage(([a, b, t]) => window.stage.ripple(a, b, t), [p.x, p.y, i / 7]);
      await this.snap(FRAME);
    }
    await this.stage(([a, b]) => window.stage.ripple(a, b, 1), [p.x, p.y]);
    return p;
  }

  // Type like a person: one frame per keystroke, a little longer after spaces and punctuation.
  async type(text, opts) {
    const o = opts || {};
    const per = o.per || 55;
    let batch = '';
    for (const ch of text) {
      batch += ch;
      if (ch === '\n') { await this.page.keyboard.press('Enter'); batch = ''; await this.snap(per * 2); continue; }
      await this.page.keyboard.type(ch);
      if (batch.length >= (o.chunk || 1)) {
        batch = '';
        await this.snap(/[.,!?]/.test(ch) ? per * 3 : ch === ' ' ? per * 1.4 : per);
      }
    }
    if (batch) await this.snap(per);
  }

  // ---------------------------------------------------------------- captions & cards
  async caption(step, html, ms = 200) {
    if (this.cap) await this.hideCaption(120);
    this.cap = { step, html };
    const n = Math.max(1, Math.round(ms / FRAME));
    for (let i = 1; i <= n; i++) {
      await this.stage(([s, h, a]) => window.stage.caption(s, h, a), [step, html, ease(i / n)]);
      if (i < n) await this.snap(FRAME);
    }
  }

  async hideCaption(ms = 160) {
    if (!this.cap) return;
    const { step, html } = this.cap;
    const n = Math.max(1, Math.round(ms / FRAME));
    for (let i = n - 1; i >= 0; i--) {
      await this.stage(([s, h, a]) => window.stage.caption(s, h, a), [step, html, ease(i / n)]);
      if (i > 0) await this.snap(FRAME);
    }
    this.cap = null;
  }

  async titleCard(kicker, title, sub, holdMs) {
    for (let i = 0; i <= 5; i++) {
      await this.stage(([k, t, s, a]) => window.stage.titleCard(k, t, s, a), [kicker, title, sub, i / 5]);
      if (i < 5) await this.snap(FRAME);
    }
    await this.snap(holdMs || 1400);
    for (let i = 5; i >= 0; i--) {
      await this.stage(([k, t, s, a]) => window.stage.titleCard(k, t, s, a), [kicker, title, sub, i / 5]);
      if (i > 0) await this.snap(FRAME);
    }
  }

  // Click the LoopBoard activity-bar icon to open/close the side bar.
  async toggleSidebar(on) {
    await this.click(this.page.locator('#ab-loopboard'), { fake: true, ms: 480 });
    await this.stage((v) => window.stage.sidebar(v), on);
    await this.settle();
  }

  // Smoothly scroll a webview's scroll container (the board's `.pane`) to `top` px — or so that
  // `locator`'s element sits `margin` px below the pane's top edge.
  async scroll(frame, target, ms = 600, selector = '.pane', margin = 16) {
    const from = await frame.evaluate((sel) => document.querySelector(sel).scrollTop, selector);
    let to = target;
    if (typeof target !== 'number') {
      to = await target.evaluate((el, [sel, m]) => {
        const pane = document.querySelector(sel);
        return pane.scrollTop + el.getBoundingClientRect().top - pane.getBoundingClientRect().top - m;
      }, [selector, margin]);
    }
    const n = Math.max(2, Math.round(ms / FRAME));
    for (let i = 1; i <= n; i++) {
      const y = from + (to - from) * ease(i / n);
      await frame.evaluate(([sel, v]) => { document.querySelector(sel).scrollTop = v; }, [selector, y]);
      if (i < n) await this.snap(FRAME);
    }
  }

  async spotlight(locator, alpha = 1) {
    if (!locator) return this.stage(() => window.stage.spotlight(null));
    const box = await locator.boundingBox();
    return this.stage(([b, a]) => window.stage.spotlight(b, a), [box, alpha]);
  }

  // Close the loop: cross-fade from the current frame back into frame 0, so the GIF repeats with
  // no visible jump.
  async loopBack(ms = 480) {
    await this.settle();
    const first = 'data:image/png;base64,' + fs.readFileSync(this.frames[0].file).toString('base64');
    const n = Math.max(2, Math.round(ms / FRAME));
    for (let i = 1; i <= n; i++) {
      await this.page.evaluate(([src, a]) => window.stage.xfade(src, a), [first, ease(i / n)]);
      if (i < n) await this.snap(FRAME);
    }
    await this.page.evaluate(() => window.stage.xfade(null));
  }
}

module.exports = { Recorder, FRAME, ease };
