/* Hero: one story travels the whole loop — promote, a loop claims and builds it, it lands in
 * Review, you accept it into DONE.md. */
'use strict';

const { files } = require('../lib/workspace');
const { Terminals } = require('../lib/terminal');
const ui = require('../lib/ui');

const ID = 't-4f2a';

module.exports = {
  workspace: () => ({ files: files([ID, 't-9c1d']) }),
  layout: { sidebar: false, panel: true, panelHeight: 250, feature: 'The whole loop' },
  webviewState: {
    board: {
      phase: 'new',
      collapsedDefault: { new: false, backlog: true, inprogress: true, review: false },
      sections: { new: { [ID]: { description: true, goals: true }, 't-9c1d': { description: true, problem: true, questions: true } },
                  review: { [ID]: { problem: true, description: true, goals: true } } },
    },
  },
  setup(host) {
    host.loops.sonnet = { running: true, context: { used: 41000, window: 1000000 }, agents: [], restart: null };
    host.loops.opus = { running: true, context: { used: 88000, window: 1000000 }, agents: [], restart: null };
  },
  async run(rec, ctx) {
    const { host } = ctx;
    const term = new Terminals(rec);
    for (const m of ['opus', 'sonnet']) {
      term.open(m);
      term.boot(m);
      term.tool(m, 'Read', '.loopboard/TODO.md', 'Read 31 lines');
      term.say(m, m === 'opus' ? 'Nothing to groom. Next pass in 5m.' : 'Backlog is empty — nothing to claim. Next pass in 5m.');
    }
    await term.render();
    await rec.placeCursor(760, 470);

    await rec.caption('1', 'A groomed story is ready in <b>New</b>');
    await rec.hold(1300);

    await rec.caption('2', '<b>Promote</b> it — your first gate');
    await rec.click(ui.promote(ctx, ID));
    await rec.hold(900);

    // The Sonnet loop's next pass claims the top Backlog task (Rule 2: one task In Progress).
    await rec.caption('3', 'The Sonnet loop claims it and builds it');
    term.busy('sonnet', true);
    term.status('sonnet', 'Claiming t-4f2a…');
    term.tool('sonnet', 'Read', '.loopboard/tasks/t-4f2a.md', 'Read 24 lines');
    await term.render();
    await rec.hold(500);
    host.editIndex(ID, (e) => { e.phase = 'inprogress'; });
    host.editDetail(ID, (d) => { d.started = host.today; d.links = ['task/t-4f2a-rate-limit']; });
    await host.refresh();
    term.say('sonnet', 'Claimed <span class="t-blue">t-4f2a</span> — Add rate limiting to the public REST API');
    term.status('sonnet', 'Implementing… (4s)');
    await term.render();
    await rec.click(ui.tab(ctx, 'In Progress'), { ms: 420 });
    await rec.hold(500);
    const steps = [
      ['Bash', 'git switch -c task/t-4f2a-rate-limit', null, 'Implementing… (22s)'],
      ['Write', 'src/middleware/rateLimit.ts', 'Wrote 71 lines', 'Implementing… (1m 04s)'],
      ['Edit', 'src/app.ts', 'Updated with 3 additions', 'Implementing… (1m 31s)'],
      ['Bash', 'npm test', '<span class="t-green">✓ 126 passed</span> (4.1s)', 'Opening the PR… (2m 12s)'],
      ['Bash', 'gh pr create --fill', 'https://github.com/acme/acme-api/pull/219', 'Writing ## Delivered… (2m 20s)'],
    ];
    for (const [tool, arg, res, status] of steps) {
      term.tool('sonnet', tool, arg, res);
      term.status('sonnet', status);
      await term.render();
      await rec.hold(420);
    }

    host.editDetail(ID, (d) => {
      d.links = ['https://github.com/acme/acme-api/pull/219'];
      d.delivered = 'Token-bucket limiter in `src/middleware/rateLimit.ts`, keyed by API key with an IP fallback and backed by Redis. ' +
        'Over-limit requests return **429** with `Retry-After` and `X-RateLimit-Remaining`; limits come from the plan config. ' +
        '12 new tests, CI green. PR: https://github.com/acme/acme-api/pull/219';
    });
    host.editIndex(ID, (e) => { e.phase = 'review'; });
    await host.refresh();
    term.say('sonnet', 'Moved <span class="t-blue">t-4f2a</span> to Review — PR #219 is open.');
    term.status('sonnet', null);
    term.busy('sonnet', false);
    await term.render();
    await rec.caption('4', 'Delivered with a PR — it waits for <b>your</b> review');
    await rec.hold(300);
    await rec.click(ui.tab(ctx, 'Review'), { ms: 420 });
    await rec.hold(500);
    await rec.scroll(host.frames.board, ctx.board.locator(`[data-task="${ID}"] .review-block`), 700, '.pane', 150);
    await rec.hold(1600);
    await rec.scroll(host.frames.board, 0, 500);

    await rec.caption('5', '<b>Approve</b> — archived to DONE.md');
    await rec.click(ui.approve(ctx, ID), { ms: 600 });
    await rec.hold(500);
    await rec.click(ui.tab(ctx, 'Done'), { ms: 420 });
    await rec.hold(1700);
    await rec.hideCaption();
    await rec.moveTo(760, 470, 480);
    await rec.loopBack();
  },
};
