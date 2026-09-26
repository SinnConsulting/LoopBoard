/* Right-click Promote: arm an automatic promote on a New story that still has an open question.
 * The arm waits while the question is answered and the groomer folds it in, then promotes the
 * story by itself once nothing is left open. A close-up: a narrow window, cropped to the card. */
'use strict';

const path = require('node:path');
const { files } = require('../lib/workspace');
const { ROOT } = require('../server');
const ui = require('../lib/ui');
const gates = require(path.join(ROOT, 'out-test', 'gates.js'));
const { AUTO_PROMOTE_SETTLE_MS } = require(path.join(ROOT, 'out-test', 'autopromote.js'));

const ID = 't-9c1d';
const TITLE = 'Export invoices as CSV from the billing page';

module.exports = {
  workspace: () => ({ files: files([ID, 't-7b3e']) }),
  // A narrow, tall window lays the card out at a readable size with room below it; the crop cuts
  // away the window chrome and the board's tab strip (stacked at this width), keeping the New
  // heading, the card, the toast corner and the caption band.
  viewport: { width: 760, height: 1100 },
  crop: { x: 56, y: 300, width: 696, height: 800 },
  layout: { sidebar: false, panel: false, feature: '', band: { left: 56, width: 696 } },
  webviewState: { board: { phase: 'new', sections: { new: { [ID]: { questions: false } } } } },
  async run(rec, ctx) {
    const { host, board } = ctx;
    const card = ui.card(ctx, ID);
    const promote = ui.promote(ctx, ID);

    // Right-click looks like any click on screen, so a keycap names the button.
    const rightClick = async (locator) => {
      const p = await rec.click(locator, { button: 'right', ms: 520 });
      await rec.stage(([x, y]) => window.stage.keycap('Right-click', x - 110, y + 18, 1), [p.x, p.y]);
      await rec.hold(800);
      await rec.stage(() => window.stage.keycap('', 0, 0, 0));
    };

    await rec.placeCursor(420, 760);
    await rec.caption('1', '<b>Right-click</b> Promote to promote it later, by itself');
    await rec.hold(1200);
    await rightClick(promote);
    await rec.hold(300);
    await rec.spotlight(promote);
    await rec.hold(1400);
    await rec.spotlight(null);

    // Hold (reason `questions`): the arm never fires while a question is open or answered but
    // not yet folded in, and a hold never disarms.
    await rec.caption('2', 'Armed — it waits while a question is <b>still open</b>');
    await rec.hold(900);
    await rec.click(board.locator(`[data-task="${ID}"] .qa-suggestion`).first(), { ms: 600 });
    await rec.hold(900);
    await rec.spotlight(promote);
    await rec.hold(1200);
    await rec.spotlight(null);

    // What the groomer writes on its re-groom (LOOP.md Rule 14): the answer is folded into the
    // story and the question pair deleted.
    await rec.caption('3', 'The groomer folds the answer in — <b>nothing left open</b>');
    host.editIndex(ID, (e) => { e.questions = []; });
    host.editDetail(ID, (d) => {
      d.description += ' One row per invoice: number, customer, issue date, due date, total and status.';
      d.worklog.push('2026-09-25 (opus): re-groomed — answer folded in');
    });
    await host.refresh();
    await rec.hold(900);
    await rec.spotlight(card);
    await rec.hold(1100);
    await rec.spotlight(null);

    // The quiet period (AUTO_PROMOTE_SETTLE_MS) must pass with the entry unchanged: time-lapse it.
    const p = await rec.point(promote);
    const secs = AUTO_PROMOTE_SETTLE_MS / 1000;
    for (let i = 1; i <= 5; i++) {
      await rec.stage(([x, y, s]) => window.stage.keycap('⏩ +' + s + ' s', x, y, 1), [p.x - 170, p.y + 34, Math.round((secs * i) / 5)]);
      await rec.hold(260);
    }
    await rec.stage(() => window.stage.keycap('', 0, 0, 0));

    // controller.fireAutoPromote: the guarded promote re-checks the fresh entry, then the toast.
    host.editIndex(ID, (e) => { if (gates.promoteIndexIfReady(e) !== 'applied') throw new Error('not ready to auto-promote'); });
    host.editDetail(ID, (d) => gates.promoteDetail(d, host.today));
    host.autoPromote.delete(ID);
    await host.toast('success', `Auto-promoted "${TITLE}" to Backlog`, 'check', ID);
    await host.refresh();
    await rec.caption('4', 'Then it promotes <b>itself</b> to the Backlog');
    await rec.hold(2600);
    await rec.hideCaption();
    await rec.moveTo(420, 760, 400);
    await rec.loopBack();
  },
};
