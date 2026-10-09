/* Drag reorder (t-81a0): a Backlog card is dragged by its grip above the card a loop would claim
 * first; the insertion line shows the slot, and the card lands there once TODO.md is rewritten. */
'use strict';

const { files } = require('../lib/workspace');
const ui = require('../lib/ui');

const ID = 't-5e61';
const TOP = 't-7b3e';

module.exports = {
  workspace: () => ({
    files: files([TOP, 't-4f2a', ID], {
      overrides: {
        't-4f2a': ['phase: backlog', 'model: sonnet'],
        [ID]: ['phase: backlog', 'model: opus'],
      },
    }),
  }),
  layout: { sidebar: false, panel: false, feature: 'Drag to reorder' },
  webviewState: { board: { phase: 'backlog', collapsedDefault: { backlog: true } } },
  async run(rec, ctx) {
    const { page, board } = ctx;
    const grip = board.locator(`[data-task="${ID}"] .drag-handle`);

    await rec.placeCursor(820, 560);
    await rec.caption('1', 'Loops claim the Backlog <b>top down</b>');
    await rec.hold(1300);
    await rec.spotlight(ui.card(ctx, TOP));
    await rec.hold(1200);
    await rec.spotlight(null);

    await rec.caption('2', 'Grab a card by its <b>grip</b> and drag it up');
    const from = await rec.moveToLocator(grip, null, 600);
    await rec.hold(500);
    await page.mouse.down();
    await rec.hold(120);
    const target = await rec.point(ui.card(ctx, TOP), { dy: 8 });
    await rec.moveTo(from.x + 40, target.y, 900);
    await rec.hold(1300);

    await rec.caption('3', 'Drop — <code>TODO.md</code> is rewritten, the card lands <b>after the refresh</b>');
    await page.mouse.up();
    await rec.hold(1600);
    await rec.spotlight(ui.card(ctx, ID));
    await rec.hold(1400);
    await rec.spotlight(null);

    await rec.caption('4', 'Now a loop takes <b>this</b> one next');
    await rec.hold(1800);
    await rec.hideCaption();
    await rec.moveTo(820, 560, 400);
    await rec.loopBack();
  },
};
