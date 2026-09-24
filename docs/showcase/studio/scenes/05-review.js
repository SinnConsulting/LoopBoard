/* Review: read what was delivered, send it back with feedback, the loop reworks it, you accept. */
'use strict';

const { files } = require('../lib/workspace');
const { Terminals } = require('../lib/terminal');
const ui = require('../lib/ui');

const ID = 't-a13f';

module.exports = {
  workspace: () => ({ files: files([ID, 't-7b3e']) }),
  layout: { sidebar: false, panel: true, panelHeight: 190, feature: 'Review & accept' },
  webviewState: { board: { phase: 'review', sections: { review: { [ID]: { problem: true, description: true, goals: true } } } } },
  setup(host) {
    host.loops.opus = { running: true, context: { used: 305000, window: 1000000 }, agents: [], restart: null };
  },
  async run(rec, ctx) {
    const { host, board } = ctx;
    const term = new Terminals(rec);
    term.open('opus');
    term.boot('opus');
    term.say('opus', 'Moved <span class="t-blue">t-a13f</span> to Review — PR #212 is open. Nothing else to do.');
    await term.render(5);
    const frame = host.frames.board;
    const block = () => board.locator(`[data-task="${ID}"] .review-block`);

    await rec.placeCursor(760, 400);
    await rec.caption('1', 'Finished work lands in <b>Review</b> with what was delivered');
    await rec.hold(800);
    await rec.scroll(frame, block(), 800, '.pane', 170);
    await rec.hold(900);

    await rec.caption('2', 'Not quite? Write review feedback');
    await rec.click(board.locator(`[data-task="${ID}"] textarea[data-field="feedback"]`), { ms: 450 });
    await rec.type('Also redact the Cookie header in the request logs.', { per: 40, chunk: 2 });
    await rec.hold(300);
    await rec.click(board.locator(`[data-task="${ID}"] .review-block .field-save-btn`), { ms: 400 });
    await rec.moveTo(900, 330, 400);
    await rec.hold(1500);

    // Rule 13: review feedback sends the task back to In Progress; the loop addresses it, removes
    // the feedback line and delivers again.
    await rec.caption('3', 'The loop reworks it and delivers again');
    term.raw('opus', `<span class="t-dim">&gt;</span> ${(host.nudges.opus || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}`);
    term.busy('opus', true);
    term.status('opus', 'Addressing review feedback… (6s)');
    host.editIndex(ID, (e) => { e.phase = 'inprogress'; });
    await host.refresh();
    await term.render(5);
    await rec.hold(700);
    term.tool('opus', 'Edit', 'lib/log.ts', 'Updated with 1 addition');
    term.tool('opus', 'Bash', 'npm test', '<span class="t-green">✓ 131 passed</span> (3.8s)');
    term.status('opus', 'Pushing to PR #212… (48s)');
    await term.render(5);
    await rec.hold(800);
    host.editIndex(ID, (e) => { e.phase = 'review'; e.feedback = []; });
    host.editDetail(ID, (d) => {
      d.delivered = d.delivered.replace('Request bodies and the `authorization` header are redacted.', 'Request bodies, the `authorization` header and cookies are redacted.');
    });
    await host.refresh();
    term.say('opus', 'Feedback addressed — <span class="t-blue">t-a13f</span> is back in Review.');
    term.status('opus', null);
    term.busy('opus', false);
    await term.render(5);
    await rec.scroll(frame, 0, 500);
    await rec.hold(1200);

    await rec.caption('4', 'Happy with it? <b>Approve</b> — archived to DONE.md');
    await rec.click(ui.approve(ctx, ID));
    await rec.hold(600);
    await rec.click(ui.tab(ctx, 'Done'), { ms: 450 });
    await rec.hold(1800);
    await rec.hideCaption();
    await rec.moveTo(760, 400, 400);
    await rec.loopBack();
  },
};
