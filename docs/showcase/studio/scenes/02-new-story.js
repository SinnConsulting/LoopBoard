/* New Story: write a story in plain words, it lands as a DRAFT, the groomer loop turns it into a
 * structured story (problem / description / goals) with a question for you. */
'use strict';

const { files } = require('../lib/workspace');

const TEXT = 'Customers keep asking for a dark mode on the dashboard. Follow the OS setting by default, and remember a manual toggle per user.';

module.exports = {
  // Nothing In Progress, so the sidebar's Agents section sits right under the loop rows.
  workspace: () => ({ files: files(['t-7b3e']) }),
  layout: { sidebar: false, panel: false, feature: 'New Story & grooming' },
  webviewState: { board: { phase: 'new' } },
  setup(host) {
    host.loops.opus = { running: true, context: { used: 64000, window: 1000000 }, agents: [], restart: null };
    host.loops.sonnet = { running: true, context: { used: 120000, window: 1000000 }, agents: [], restart: null };
  },
  async run(rec, ctx) {
    const { host, board } = ctx;
    await rec.placeCursor(900, 330);
    await rec.caption('1', 'Click <b>New Story</b> and describe it in your own words');
    await rec.hold(700);
    await rec.click(board.locator('.tb-new'));
    await rec.hold(300);
    await rec.type(TEXT, { per: 42, chunk: 2 });
    await rec.hold(500);

    await rec.caption('2', 'Pick who <b>grooms</b> it and who <b>builds</b> it');
    await rec.click(board.locator('select[aria-label="Groom with"]'), { select: 'opus', ms: 460 });
    await rec.hold(250);
    await rec.click(board.locator('select[aria-label="Work with"]'), { select: 'sonnet', ms: 420 });
    await rec.hold(400);
    await rec.click(board.locator('button:text-is("Save Draft")'), { ms: 420 });
    await rec.caption('3', 'It lands in <b>New</b> as a DRAFT');
    await rec.hold(1500);

    // The Opus loop's next pass grooms the draft through a subagent (Rule 14); the sidebar lists
    // the live subagent while it runs.
    const draftId = host.webBoard().phases.new.find((t) => t.isDraft).id;
    await rec.caption('4', 'The Opus loop grooms it — the sidebar shows its live subagent');
    await rec.toggleSidebar(true);
    for (const secs of [3, 9, 17, 26, 34, 41]) {
      host.loops.opus.agents = [{ id: 'a7f3', label: `general-purpose · Groom ${draftId}`, duration: `${secs}s` }];
      await host.refresh();
      if (secs === 3) await rec.spotlight(ctx.sidebar.locator('.sb-section:has(.agent-dot)'));
      await rec.hold(secs === 3 ? 700 : 360);
    }
    await rec.spotlight(null);
    host.editIndex(draftId, (e) => {
      e.title = 'Dark mode for the dashboard';
      e.isDraft = false;
      e.phase = 'new';
      e.questions = [{ text: 'Should charts switch to a dark palette too, or keep their light background?', answer: '',
        suggestions: ['Dark palette for charts too', 'Keep charts light for now'] }];
    });
    host.editDetail(draftId, (d) => {
      d.problem = 'The dashboard is light-only. Users on dark desktops report eye strain, and it is the most-upvoted request on the feedback board.';
      d.description = 'Add a dark theme driven by CSS custom properties. Default to `prefers-color-scheme`; a toggle in the user menu overrides it and is stored on the user profile.';
      d.goals = '- The dashboard follows the OS colour scheme on first load.\n- A manual toggle overrides it and survives reloads and new devices.\n- Every page passes WCAG AA contrast in both themes.';
    });
    host.loops.opus.agents = [];
    await host.refresh();
    await rec.caption('5', 'A structured story — plus a question for you');
    await rec.hold(900);
    await rec.toggleSidebar(false);
    await rec.hold(400);
    await rec.scroll(host.frames.board, board.locator(`[data-task="${draftId}"] .qa-panel`), 900, '.pane', 300);
    await rec.moveTo(760, 600, 500);
    await rec.hold(2200);
    await rec.hideCaption();
    await rec.scroll(host.frames.board, 0, 500);
    await rec.moveTo(900, 330, 400);
    await rec.loopBack();
  },
};
