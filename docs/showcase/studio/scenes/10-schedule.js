/* Scheduled loop actions: right-click ▶ ♻ ■ opens a popover that schedules the same action. A
 * restart on a busy loop waits for its task; Force skips the wait after one native modal. */
'use strict';

const path = require('node:path');
const { files } = require('../lib/workspace');
const { Terminals } = require('../lib/terminal');
const { ROOT } = require('../server');
const ui = require('../lib/ui');
const { describeSchedule } = require(path.join(ROOT, 'out-test', 'schedule.js'));

const ID = 't-7b3e';
const MIN = 60000;

module.exports = {
  workspace: () => ({ files: files([ID], { overrides: { [ID]: ['phase: inprogress', 'model: sonnet'] } }) }),
  // Only the sidebar's loop rows and the terminal matter here: the GIF is cropped to them (the
  // board above is cut away) and the caption band narrowed to the same width.
  crop: { x: 48, y: 392, width: 784, height: 456 },
  layout: { panel: true, panelHeight: 360, feature: '', band: { left: 48, width: 784 } },
  webviewState: { board: { phase: 'inprogress' } },
  setup(host) {
    host.loops.opus = { running: true, context: { used: 94000, window: 1000000 }, agents: [], restart: null };
    host.loops.sonnet = { running: true, context: { used: 612000, window: 1000000 }, agents: [], restart: null };
  },
  async run(rec, ctx) {
    const { host, sidebar } = ctx;
    const term = new Terminals(rec);
    // Simulated minutes since the scene started: the schedules' labels are the shipped
    // describeSchedule wording, computed against this clock.
    let now = 0;
    const schedules = {};
    const label = () => {
      for (const [model, s] of Object.entries(schedules)) {
        host.loops[model].restart = { ...s, label: describeSchedule(s, now) };
      }
    };

    for (const m of ['opus', 'sonnet']) {
      term.open(m);
      term.boot(m);
      term.tool(m, 'Read', '.loopboard/TODO.md', 'Read 12 lines');
    }
    term.say('opus', 'Nothing to groom. Next pass in 5m.');
    term.say('sonnet', 'Resuming <span class="t-blue">t-7b3e</span> — Migrate integration tests from Jest to node:test');
    term.tool('sonnet', 'Edit', 'test/integration/orders.test.js', 'Updated 42 lines');
    term.busy('sonnet', true);
    term.status('sonnet', 'Implementing… (2m 14s)');
    await term.render(12);

    // Mirrors controller.onArmRestart: arm, toast, refresh. Force consent is the scene's modal step.
    host.on('armRestart', async (msg) => {
      const minutes = Number(msg.minutes);
      schedules[msg.model] = { action: msg.action, minutes, repeat: !!msg.repeat, force: !!msg.force, pending: false, nextFireAt: now + minutes * MIN };
      label();
      const verb = msg.action === 'start' ? 'Starting' : msg.action === 'stop' ? 'Stopping' : 'Restarting';
      await host.toast('success', msg.repeat ? `${verb} ${msg.model} every ${minutes}m.` : `${verb} ${msg.model} in ${minutes}m.`, 'check');
      await host.refresh();
      return true;
    });

    // Right-click looks like any click on screen, so a keycap names the button while the popover
    // opens.
    const rightClick = async (locator) => {
      const p = await rec.click(locator, { button: 'right', ms: 480 });
      await rec.stage(([x, y]) => window.stage.keycap('Right-click', x + 18, y + 18, 1), [p.x, p.y]);
      await rec.hold(700);
      await rec.stage(() => window.stage.keycap('', 0, 0, 0));
    };
    const timeLapse = async (minutes) => {
      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        now += (minutes * MIN) / steps;
        label();
        await host.refresh();
        const elapsed = Math.round(now / MIN);
        term.status('sonnet', `Implementing… (${2 + elapsed}m 14s)`);
        await term.render(12);
        const p = await rec.point(sidebar.locator('.loop-wrap:has(.label:text-is("Sonnet")) .restart-indicator'));
        await rec.stage(([x, y, a]) => window.stage.keycap('⏩ +' + a + ' min', x, y, 1), [350, p.box.y - 8, elapsed]);
        await rec.hold(220);
      }
      await rec.stage(() => window.stage.keycap('', 0, 0, 0));
    };

    await rec.placeCursor(640, 620);
    await rec.caption('1', '<b>Right-click</b> ▶ ♻ ■ to schedule it instead of doing it now');
    await rec.hold(900);
    await rightClick(ui.loopBtn(ctx, 'Sonnet', 'Restart'));
    await rec.hold(300);
    await rec.spotlight(sidebar.locator('.restart-pop'));
    await rec.hold(700);
    await rec.spotlight(null);
    await rec.click(sidebar.locator('.restart-check:has-text("Repeat") input'), { ms: 380 });
    await rec.hold(200);
    await rec.click(sidebar.locator('.restart-actions .btn-sm.primary'), { ms: 420 });
    await rec.hold(400);
    await rec.spotlight(sidebar.locator('.loop-wrap:has(.label:text-is("Sonnet")) .restart-indicator'));
    await rec.hold(1000);
    await rec.spotlight(null);

    // Sonnet still holds the In Progress task when the timer runs out: without Force the restart
    // defers (mayFire) and fires on the idle edge once the task has left In Progress.
    await rec.caption('2', 'Loop still busy? The restart <b>waits</b> for its task');
    await timeLapse(15);
    schedules.sonnet.pending = true;
    label();
    await host.refresh();
    await rec.spotlight(sidebar.locator('.loop-wrap:has(.label:text-is("Sonnet")) .restart-indicator'));
    await rec.hold(1400);
    await rec.spotlight(null);
    await rec.caption('3', 'Task delivered — the restart fires: a <b>fresh</b> session');
    term.tool('sonnet', 'Bash', 'git push -u origin task/t-7b3e-node-test', 'Pushed');
    term.say('sonnet', 'Moved <span class="t-blue">t-7b3e</span> to Review.');
    term.busy('sonnet', false);
    term.status('sonnet', null);
    host.editIndex(ID, (e) => { e.phase = 'review'; });
    host.editDetail(ID, (d) => { d.delivered = 'Integration suite runs on `node:test`; Jest removed.'; d.links = ['task/t-7b3e-node-test']; });
    await host.refresh();
    await term.render(12);
    await rec.hold(700);

    // terminals.recycle: dispose the terminal, respawn a fresh one under the same name.
    term.close('sonnet');
    await term.render(12);
    await rec.hold(300);
    term.open('sonnet');
    await term.render(12);
    await rec.hold(300);
    term.boot('sonnet');
    host.loops.sonnet.context = { used: 18000, window: 1000000 };
    schedules.sonnet = { ...schedules.sonnet, pending: false, nextFireAt: now + 15 * MIN };
    label();
    await host.refresh();
    await term.render(12);
    await rec.spotlight(sidebar.locator('.loop-wrap:has(.label:text-is("Sonnet"))'));
    await rec.hold(1500);
    await rec.spotlight(null);

    await rec.caption('4', '<b>Force</b> skips the wait — confirmed once, when you arm it');
    await rightClick(ui.loopBtn(ctx, 'Opus', 'Stop'));
    await rec.hold(250);
    await rec.click(sidebar.locator('.restart-preset:text-is("60m")'), { ms: 380 });
    await rec.click(sidebar.locator('.restart-check:has-text("Force") input'), { ms: 380 });
    await rec.hold(250);

    // The webview posts armRestart; the controller's confirmForcedRestart modal comes first. Hold
    // the message back until the modal's button is clicked (untracked, or settle() would wait on it).
    let release;
    let armed;
    const consented = new Promise((r) => { release = r; });
    const arm = host.handlers.armRestart;
    host.on('armRestart', (msg) => { armed = consented.then(() => arm(msg)); return true; });
    await rec.click(sidebar.locator('.restart-actions .btn-sm.primary'), { ms: 420 });
    const modal = {
      message: 'Force-stop opus even while it is working on a task?',
      detail: 'A forced stop kills the session mid-task. The task stays <code>phase: inprogress</code> in the tracker with no worker attached, and under LOOP.md Rule 2 that blocks every loop from claiming new work until you fix it by hand. Any subagents the session still has running are killed with it, mid-edit. Confirming now also covers the stop itself — it fires later without asking again.',
      buttons: ['Arm forced stop', 'Cancel'],
      left: 440, top: 460,
    };
    for (let i = 1; i <= 4; i++) {
      await rec.stage(([o, a]) => window.stage.modal(o, a), [modal, i / 4]);
      await rec.hold(40);
    }
    await rec.hold(1800);
    await rec.click(ctx.page.locator('#modal .md-btn.primary'), { fake: true, ms: 520 });
    await rec.stage(() => window.stage.modal(null));
    release();
    await armed;
    await rec.hold(300);
    await rec.spotlight(sidebar.locator('.loop-wrap:has(.label:text-is("Opus")) .restart-indicator'));
    await rec.hold(1500);
    await rec.spotlight(null);
    await rec.hideCaption();
    await rec.moveTo(640, 620, 400);
    await rec.loopBack();
  },
};
