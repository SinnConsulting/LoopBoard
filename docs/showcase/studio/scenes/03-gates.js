/* The human gates: promote (New → Backlog) and its undo, demote (Backlog → New). */
'use strict';

const { files } = require('../lib/workspace');
const ui = require('../lib/ui');

const ID = 't-4f2a';

module.exports = {
  workspace: () => ({ files: files([ID, 't-9c1d', 't-a13f']) }),
  layout: { sidebar: false, panel: false, feature: 'Promote & demote' },
  webviewState: {
    board: {
      phase: 'new',
      sections: {
        new: { [ID]: { description: true, goals: true }, 't-9c1d': { description: true, questions: true } },
        backlog: { [ID]: { description: true, goals: true } },
      },
    },
  },
  async run(rec, ctx) {
    await rec.placeCursor(800, 520);
    await rec.caption('1', 'Ready? <b>Promote</b> moves it from New to Backlog');
    await rec.hold(1100);
    await rec.click(ui.promote(ctx, ID));
    await rec.hold(700);
    await rec.click(ui.tab(ctx, 'Backlog'), { ms: 450 });
    await rec.caption('2', 'Loops only ever claim from the <b>Backlog</b>');
    await rec.hold(1500);

    await rec.caption('3', 'Changed your mind? <b>Demote</b> sends it back — nothing is lost');
    await rec.click(ui.demote(ctx, ID));
    await rec.hold(700);
    await rec.click(ui.tab(ctx, 'New'), { ms: 450 });
    await rec.hold(700);
    await rec.caption('4', 'Only <b>you</b> pass these gates — a loop never ticks the box');
    await rec.hold(2000);
    await rec.hideCaption();
    await rec.moveTo(800, 520, 400);
    await rec.loopBack();
  },
};
