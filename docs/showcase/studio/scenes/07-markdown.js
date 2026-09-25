/* Markdown is the source of truth: a board click rewrites TODO.md, and a hand edit to TODO.md
 * repaints the board. */
'use strict';

const { files } = require('../lib/workspace');
const ui = require('../lib/ui');

const SPLIT = 350; // height of the TODO.md editor group (split down)

function changedLines(before, after) {
  const pool = new Map();
  for (const l of before.split('\n')) pool.set(l, (pool.get(l) || 0) + 1);
  const out = [];
  after.split('\n').forEach((l, i) => {
    const n = pool.get(l) || 0;
    if (n > 0) pool.set(l, n - 1);
    else if (l.trim()) out.push(i + 1);
  });
  return out;
}

module.exports = {
  workspace: () => ({ files: files(['t-4f2a', 't-9c1d']) }),
  layout: {
    sidebar: false, panel: false, split: true, splitHeight: SPLIT, feature: 'Markdown is the source of truth',
    tabs: [{ label: 'LoopBoard', icon: 'loopboard', active: true }],
    rightTabs: [{ label: 'TODO.md', icon: 'md', active: true }],
  },
  webviewState: {
    board: { phase: 'new', collapsedDefault: { new: true, backlog: true } },
  },
  async run(rec, ctx) {
    const { host } = ctx;
    const first = () => host.read('TODO.md').split('\n').findIndex((l) => l.startsWith('## Tasks')) + 1;
    const md = (text, o) => rec.stage(([t, opts]) => window.stage.md(t, opts), [text, Object.assign({ first: first() }, o || {})]);
    const tabs = (dirty) => rec.stage((d) => window.stage.layout({
      sidebar: false, panel: false, split: true, tabs: [{ label: 'LoopBoard', icon: 'loopboard', active: true }],
      rightTabs: [{ label: 'TODO.md', icon: 'md', active: true, dirty: d }],
    }), dirty);
    // Highlight the lines a write changed, fading out like an editor's change marker.
    const flashDiff = async (before, after, holdMs) => {
      const hl = changedLines(before, after);
      await md(after, { hl, hlAlpha: 1 });
      await rec.hold(holdMs);
      for (let i = 5; i >= 0; i--) { await md(after, { hl, hlAlpha: i / 5 }); await rec.snap(60); }
    };
    host.onWrite((p, before, after) => { if (p === 'TODO.md') pending = { before, after }; });
    let pending = null;

    await md(host.read('TODO.md'));
    await rec.placeCursor(760, 300);
    await rec.caption('1', 'The board is a live view of <b>.loopboard/TODO.md</b>');
    await rec.hold(1300);

    await rec.caption('2', 'Click on the board → the markdown is rewritten');
    await rec.click(ui.promote(ctx, 't-4f2a'));
    if (pending) { await flashDiff(pending.before, pending.after, 1500); pending = null; }

    await rec.caption('3', 'Edit the file → the board follows');
    let text = host.read('TODO.md');
    const lines = text.split('\n');
    const qi = lines.findIndex((l) => l.includes('question: Include line items'));
    const ai = qi + 1; // `    - answer:`
    const box = await rec.page.locator('#md-lines .ln').nth(ai + 1 - first()).boundingBox();
    await rec.moveTo(box.x + 190, box.y + 10, 600);
    await md(text, { caret: ai + 1 });
    await rec.snap(160);
    const typed = ' One row per invoice';
    for (let i = 1; i <= typed.length; i++) {
      lines[ai] = '    - answer:' + typed.slice(0, i);
      await md(lines.join('\n'), { caret: ai + 1 });
      if (i === 1) await tabs(true);
      await rec.snap(i === typed.length ? 300 : 55);
    }
    const saved = lines.join('\n');
    await rec.stage(([x, y]) => window.stage.keycap('⌘ S', x, y, 1), [box.x + 330, box.y - 40]);
    await rec.snap(500);
    await rec.stage(() => window.stage.keycap('', 0, 0, 0));
    await tabs(false);
    // What the file watcher does in the extension: the file changed on disk → reload + repaint.
    host.write('TODO.md', saved);
    await host.refresh();
    pending = null;
    await md(saved, { hl: [ai + 1], hlAlpha: 1 });
    await rec.hold(500);
    await rec.moveTo(760, 300, 500);
    await rec.spotlight(ctx.board.locator('[data-task="t-9c1d"]'));
    await rec.hold(2000);
    await rec.spotlight(null);
    await rec.hideCaption();
    await rec.loopBack();
  },
};
