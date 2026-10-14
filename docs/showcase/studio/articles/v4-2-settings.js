/* v4 article: the settings page's Roles and Models tables, and the one-click migration of the
 * per-model loop keys an older LoopBoard left in the user settings. */
'use strict';

const { files } = require('../lib/workspace');

const TABS = [{ label: 'LoopBoard', icon: 'loopboard' }, { label: 'LoopBoard Settings', icon: 'settings', active: true }];

module.exports = {
  out: '../../v4/settings.gif',
  workspace: () => ({ orchestrator: true, files: files(['t-4f2a', 't-7b3e']) }),
  layout: { panel: false, feature: 'Roles and Models' },
  webviewState: { board: { phase: 'new', collapsedDefault: { new: true } } },
  setup(host) {
    // What a pre-v4 user typically still has: the old Opus slot's effort and --model string.
    host.settings['models.opus.effort'] = 'high';
    host.settings['models.opus.model'] = 'claude-opus-5-5';
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
    await rec.hold(700);

    await rec.caption('2', 'Old per-model loop keys? <b>Review migration</b> moves them over');
    await rec.spotlight(settings.locator('.banner.warn'));
    await rec.hold(1300);
    await rec.spotlight(null);
    await rec.click(settings.locator('.banner.warn button'), { ms: 450 });
    await rec.hold(900);
    await rec.spotlight(settings.locator('.migrate'));
    await rec.hold(1800);
    await rec.spotlight(null);
    const all = settings.locator('.mig-actions .btn.primary');
    await rec.click((await all.count()) ? all : settings.locator('.mig-do').first(), { ms: 450 });
    await rec.hold(1000);

    await rec.caption('3', '<b>Roles</b>: Orchestrator on Haiku; groomer, worker and reviewer default to Opus');
    await rec.spotlight(settings.locator('table.roles'));
    await rec.hold(1400);
    await rec.spotlight(null);
    await rec.click(settings.locator('select[aria-label="Worker effort"]'), { select: 'high', ms: 450 });
    await rec.hold(700);

    await rec.caption('4', '<b>Models</b>: switch one on, pin a model id, clamp its effort range');
    await rec.spotlight(settings.locator('table.models'));
    await rec.hold(1200);
    await rec.spotlight(null);
    await rec.click(settings.locator('[aria-label="Sonnet enabled"]'), { ms: 500 });
    await rec.hold(500);
    await rec.click(settings.locator('select[aria-label="Haiku highest effort"]'), { select: 'high', ms: 450 });
    await rec.hold(1800);
    await rec.hideCaption();
    await rec.moveTo(700, 400, 400);
    await rec.loopBack();
  },
};
