/* v4 article: a card picks its own groomer, worker and reviewer, each groom and work spawn with its
 * own effort; every pick is one index line in TODO.md, and an unset select falls to the role
 * default. Nothing is ever picked automatically. */
'use strict';

const { files } = require('../lib/workspace');

const ID = 't-4f2a';
const SPLIT = 300;

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
  out: '../../v4/task-routing.gif',
  workspace: () => ({ orchestrator: true, files: files([ID], { overrides: { [ID]: ['phase: new'] } }) }),
  layout: {
    sidebar: false, panel: false, split: true, splitHeight: SPLIT, feature: 'Per-task model and effort',
    tabs: [{ label: 'LoopBoard', icon: 'loopboard', active: true }],
    rightTabs: [{ label: 'TODO.md', icon: 'md', active: true }],
  },
  webviewState: { board: { phase: 'new', collapsedDefault: { new: false } } },
  async run(rec, ctx) {
    const { host, board } = ctx;
    const card = board.locator(`[data-task="${ID}"]`);
    const first = () => host.read('TODO.md').split('\n').findIndex((l) => l.startsWith('## Tasks')) + 1;
    const md = (text, o) => rec.stage(([t, opts]) => window.stage.md(t, opts), [text, Object.assign({ first: first() }, o || {})]);
    let pending = null;
    host.onWrite((p, before, after) => { if (p === 'TODO.md') pending = pending ? { before: pending.before, after } : { before, after }; });
    const flash = async (holdMs) => {
      if (!pending) return;
      const hl = changedLines(pending.before, pending.after);
      const after = pending.after;
      pending = null;
      await md(after, { hl, hlAlpha: 1 });
      await rec.hold(holdMs);
      for (let i = 5; i >= 0; i--) { await md(after, { hl, hlAlpha: i / 5 }); await rec.snap(60); }
    };
    const pick = async (label, value) => {
      await rec.click(card.locator(`select[aria-label="${label}"]`), { select: value, ms: 420 });
      await rec.hold(250);
      await flash(700);
    };

    await md(host.read('TODO.md'));
    await rec.placeCursor(760, 260);
    await rec.caption('1', 'Unset selects read <b>default (…)</b>: the role defaults from Settings');
    await rec.spotlight(card.locator('.card-selects'));
    await rec.hold(2000);
    await rec.spotlight(null);

    await rec.caption('2', 'Groom this one on <b>Haiku</b>, at low effort');
    await pick('Groom with', 'haiku');
    await pick('Groom effort', 'low');

    await rec.caption('3', 'Build it on <b>Opus</b> at high effort, review it on Haiku');
    await pick('Work with', 'opus');
    await pick('Work effort', 'high');
    await pick('Review with', 'haiku');

    await rec.caption('4', 'Every pick is one line in TODO.md. Nothing is chosen for you: no <b>auto</b>');
    await rec.hold(2600);
    await rec.hideCaption();
    await rec.moveTo(760, 260, 400);
    await rec.loopBack();
  },
};
