/* Settings: LoopBoard's own settings page — the three model slots as one grid; edits land in the
 * user settings and the sidebar follows. */
'use strict';

const { files } = require('../lib/workspace');

const TABS = [{ label: 'LoopBoard', icon: 'loopboard' }, { label: 'LoopBoard Settings', icon: 'settings', active: true }];

module.exports = {
  workspace: () => ({ files: files(['t-4f2a', 't-7b3e']) }),
  layout: { panel: false, feature: 'Settings' },
  webviewState: { board: { phase: 'new', collapsedDefault: { new: true } } },
  setup(host) {
    host.loops.opus = { running: true, context: { used: 96000, window: 1000000 }, agents: [], restart: null };
  },
  async run(rec, ctx) {
    const { host, settings } = ctx;
    host.on('openSettings', async () => {
      await rec.stage((t) => window.stage.layout({ panel: false, view: 'settings', tabs: t }), TABS);
      await host.postSettings();
      return true;
    });

    await rec.placeCursor(700, 400);
    await rec.caption('1', 'Open <b>Settings</b> from the sidebar');
    await rec.hold(800);
    await rec.click(ctx.sidebar.locator('button[aria-label="Open extension settings"]'));
    await rec.hold(600);
    await rec.caption('2', 'Every model slot in one grid: model, effort, groomers');
    await rec.spotlight(settings.locator('table').first());
    await rec.hold(1300);
    await rec.spotlight(null);

    await rec.click(settings.locator('input[aria-label="Opus --model string"]'), { ms: 500 });
    await rec.type('opus[1m]', { per: 70 });
    await rec.page.keyboard.press('Tab');
    await rec.hold(500);
    await rec.click(settings.locator('select[aria-label="Opus effort"]'), { select: 'high', ms: 450 });
    await rec.hold(700);

    await rec.caption('3', 'Turn a slot off — the sidebar follows instantly');
    await rec.click(settings.locator('[aria-label="Fable slot enabled"]'), { ms: 500 });
    await rec.hold(500);
    await rec.spotlight(ctx.sidebar.locator('.sb-section:has(.loop-wrap)'));
    await rec.hold(1500);
    await rec.spotlight(null);
    await rec.caption('4', 'Plain VS Code user settings — applied on the next ▶ start or ♻ restart');
    await rec.hold(2200);
    await rec.hideCaption();
    await rec.moveTo(700, 400, 400);
    await rec.loopBack();
  },
};
