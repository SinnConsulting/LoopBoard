/* Story tags (t-0b10): a New story gets a fresh tag and a color from the palette (tags.md), the
 * tab is filtered with `tag:api`, and the sidebar's Tags entry opens the cross-board overview. */
'use strict';

const { files } = require('../lib/workspace');
const ui = require('../lib/ui');

const ID = 't-9c1d';
const TAGGED = { 't-4f2a': 'api', 't-7b3e': 'ci', 't-2d8c': 'ci', 't-5e61': 'api', 't-a13f': 'observability' };

function tagged(ids) {
  const out = files(ids);
  for (const [id, tags] of Object.entries(TAGGED)) {
    out[`tasks/${id}.md`] = out[`tasks/${id}.md`].replace(/^(- added: .*)$/m, `$1\n- tags: ${tags}`);
  }
  out['tasks/t-31b0.md'] = '# Paginate the /v1/orders endpoint with opaque cursors (t-31b0)\n\n## Meta\n- added: 2026-09-12\n- completed: 2026-09-22\n- tags: api\n';
  out['tasks/t-c8e4.md'] = '# Add health and readiness probes for Kubernetes (t-c8e4)\n\n## Meta\n- added: 2026-09-10\n- completed: 2026-09-19\n- tags: api, ci\n';
  out['tags.md'] = '# Tags\n\n- api: blue\n- ci: orange\n- observability: purple\n';
  return out;
}

module.exports = {
  workspace: () => ({ files: tagged(['t-4f2a', ID, 't-7b3e', 't-2d8c', 't-5e61', 't-a13f']) }),
  layout: { panel: false, feature: 'Story tags' },
  webviewState: { board: { phase: 'new', collapsedDefault: { new: false }, sections: { new: { [ID]: { questions: false } } } } },
  async run(rec, ctx) {
    const { board, sidebar } = ctx;
    const card = ui.card(ctx, ID);

    await rec.placeCursor(760, 600);
    await rec.caption('1', 'Tag a story: <b>＋ tag</b>, type a name, Enter');
    await rec.hold(1000);
    await rec.click(card.locator('.tag-add'), { ms: 700 });
    await rec.hold(300);
    await rec.type('billing');
    await rec.hold(300);
    await ctx.page.keyboard.press('Enter');
    await rec.hold(900);

    await rec.caption('2', 'Click its dot to pick a <b>color</b>, kept in <code>tags.md</code>');
    await rec.click(card.locator('.tagchip[data-tag="billing"] .tagchip-dot'), { ms: 600 });
    await rec.hold(700);
    await rec.click(card.locator('.tag-swatch.tagc-green'), { ms: 500 });
    await rec.hold(1000);
    await rec.spotlight(card.locator('.tagchip[data-tag="billing"]'));
    await rec.hold(1100);
    await rec.spotlight(null);

    await rec.caption('3', 'Filter any tab with <code>tag:api</code>');
    await rec.click(board.locator('#search-input'), { ms: 700 });
    // `tag:` matches whole names only, so a half-typed token would flash "no matches": paste it.
    await rec.type('tag:api', { chunk: 7 });
    await rec.hold(1600);
    await rec.click(board.locator('.search-clear'), { ms: 500 });
    await rec.hold(600);

    await rec.caption('4', 'Sidebar <b>Tags</b> opens one tag across <b>every phase</b>');
    await rec.click(sidebar.locator('button[title="Open the tag overview"]'), { ms: 800 });
    await rec.hold(900);
    await rec.spotlight(board.locator('.tag-progress'));
    await rec.hold(1800);
    await rec.spotlight(null);

    await rec.caption('5', 'Switch tags in the picker; each shows its <b>done/total</b>');
    await rec.click(board.locator('.tag-pick:has-text("ci")'), { ms: 700 });
    await rec.hold(2200);
    await rec.hideCaption();
    await rec.moveTo(760, 600, 400);
    await rec.loopBack();
  },
};
