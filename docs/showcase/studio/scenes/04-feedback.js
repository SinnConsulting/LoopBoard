/* Feedback: a loop parks a task on questions instead of guessing; you answer (or accept a
 * suggestion) and the loop resumes by itself. */
'use strict';

const { files } = require('../lib/workspace');
const { Terminals } = require('../lib/terminal');
const ui = require('../lib/ui');

const ID = 't-5e61';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

module.exports = {
  workspace: () => ({ files: files([ID, 't-7b3e']) }),
  layout: { sidebar: false, panel: true, panelHeight: 200, feature: 'Answer questions' },
  webviewState: { board: { phase: 'new', sections: { feedback: { [ID]: { problem: true, description: true, goals: true } } } } },
  setup(host) {
    host.loops.opus = { running: true, context: { used: 212000, window: 1000000 }, agents: [], restart: null };
  },
  async run(rec, ctx) {
    const { host } = ctx;
    const term = new Terminals(rec);
    term.open('opus');
    term.boot('opus');
    term.tool('opus', 'Read', '.loopboard/tasks/t-5e61.md', 'Read 27 lines');
    term.say('opus', 'Two design decisions are not mine to make — parked <span class="t-blue">t-5e61</span> in Feedback.');
    term.say('opus', 'Waiting for answers. Next pass in 5m.');
    await term.render(6);

    await rec.placeCursor(700, 420);
    await rec.caption('1', 'Blocked? The loop parks the task in <b>Feedback</b> — it never guesses');
    await rec.hold(1200);
    await rec.click(ui.tab(ctx, 'Feedback'));
    await rec.hold(700);
    await rec.scroll(host.frames.board, ctx.board.locator(`[data-task="${ID}"] .qa-panel`), 700, '.pane', 60);

    await rec.caption('2', 'Answer it — or accept a suggestion in one click');
    await rec.hold(800);
    await rec.click(ctx.board.locator(`[data-task="${ID}"] .qa-suggestion`).first(), { ms: 600 });
    await rec.hold(1300);

    // Rule 10: every question answered → the owning loop resumes the task on its next pass (the
    // nudge pastes the task id into its terminal right away).
    await rec.caption('3', 'All answered — the loop resumes on its own');
    term.raw('opus', `<span class="t-dim">&gt;</span> ${esc(host.nudges.opus || '')}`);
    term.busy('opus', true);
    term.status('opus', 'Resuming t-5e61… (3s)');
    await term.render(6);
    await rec.hold(700);
    host.editIndex(ID, (e) => { e.phase = 'inprogress'; e.questions = []; });
    host.editDetail(ID, (d) => {
      d.description += '\n\nExponential backoff with jitter, capped at 5 attempts; a delivery that still fails is dead-lettered to a `webhook_failures` table.';
      d.worklog.push('2026-09-25 (opus): resumed — questions answered');
    });
    await host.refresh();
    term.say('opus', 'Resumed <span class="t-blue">t-5e61</span> — folding the answers into the description.');
    term.tool('opus', 'Write', 'src/webhooks/retry.ts', 'Wrote 58 lines');
    term.status('opus', 'Implementing… (41s)');
    await term.render(6);
    await rec.click(ui.tab(ctx, 'In Progress'), { ms: 500 });
    await rec.hold(2200);
    await rec.hideCaption();
    await rec.moveTo(700, 420, 400);
    await rec.loopBack();
  },
};
