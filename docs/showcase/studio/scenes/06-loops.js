/* Loop terminals: ▶ spawns one Claude Code terminal per model slot, each row shows context usage,
 * and a right-click schedules a restart. */
'use strict';

const path = require('node:path');
const { files } = require('../lib/workspace');
const { Terminals } = require('../lib/terminal');
const { ROOT } = require('../server');
const ui = require('../lib/ui');
const { describeSchedule } = require(path.join(ROOT, 'out-test', 'schedule.js'));

module.exports = {
  // One Backlog task only: the sidebar stays short enough for the schedule popover, and the board
  // sits on In Progress so the claimed card appears as the Sonnet loop takes it.
  workspace: () => ({ files: files(['t-7b3e']) }),
  layout: { panel: false, panelHeight: 270, feature: 'Loop terminals' },
  webviewState: { board: { phase: 'inprogress' } },
  async run(rec, ctx) {
    const { host, sidebar } = ctx;
    const term = new Terminals(rec);
    const showPanel = () => rec.stage((o) => window.stage.layout(o), { panel: true, panelHeight: 270, feature: 'Loop terminals' });

    // ▶: VS Code opens a terminal named `Claude <Model>`, sends the ONE spawn line, and submits
    // the seeded /loop prompt once the TUI has booted.
    host.on('spawnLoop', async (msg) => {
      host.loops[msg.model].running = true;
      host.loops[msg.model].context = { used: 18000, window: 1000000 };
      term.open(msg.model);
      await showPanel();
      await term.render(9);
      await host.refresh();
      return true;
    });
    host.on('armRestart', async (msg) => {
      const minutes = Number(msg.minutes);
      const s = { action: msg.action, minutes, repeat: !!msg.repeat, force: !!msg.force, pending: false, nextFireAt: Date.now() + minutes * 60000 };
      host.loops[msg.model].restart = { action: s.action, minutes, repeat: s.repeat, force: s.force, pending: false, label: describeSchedule(s, Date.now()) };
      await host.refresh();
      return true;
    });

    await rec.placeCursor(760, 420);
    await rec.caption('1', '<b>▶</b> starts a loop — one Claude Code terminal per model');
    await rec.hold(900);
    await rec.click(ui.loopBtn(ctx, 'Opus', 'Start loop'));
    await rec.hold(500);
    term.boot('opus');
    await term.render(9);
    await rec.hold(350);
    term.tool('opus', 'Read', '.loopboard/LOOP.md', 'Read 223 lines');
    await term.render(9);
    await rec.hold(300);
    term.tool('opus', 'Read', '.loopboard/TODO.md', 'Read 38 lines');
    term.say('opus', 'Nothing to groom. Next pass in 5m.');
    await term.render(9);
    await rec.hold(700);

    await rec.click(ui.loopBtn(ctx, 'Sonnet', 'Start loop'));
    await rec.hold(450);
    term.boot('sonnet');
    await term.render(9);
    await rec.hold(350);
    term.tool('sonnet', 'Read', '.loopboard/LOOP.md', 'Read 223 lines');
    term.busy('sonnet', true);
    term.say('sonnet', 'Claiming <span class="t-blue">t-7b3e</span> — Migrate integration tests from Jest to node:test');
    term.status('sonnet', 'Implementing… (9s)');
    host.editIndex('t-7b3e', (e) => { e.phase = 'inprogress'; });
    host.editDetail('t-7b3e', (d) => { d.started = host.today; });
    host.loops.sonnet.context = { used: 46000, window: 1000000 };
    await host.refresh();
    await term.render(9);
    await rec.hold(700);

    await rec.caption('2', 'Each row shows its live context usage');
    for (const used of [74000, 118000, 163000, 211000]) {
      host.loops.sonnet.context = { used, window: 1000000 };
      await host.refresh();
      await rec.hold(330);
    }
    await rec.spotlight(sidebar.locator('.loop-wrap:has(.label:text-is("Sonnet")) .ctx-wrap'));
    await rec.hold(900);
    await rec.spotlight(null);

    await rec.caption('3', 'Right-click to <b>schedule</b> a restart, stop or start');
    await rec.click(ui.loopBtn(ctx, 'Opus', 'Restart'), { button: 'right' });
    await rec.hold(500);
    await rec.click(sidebar.locator('.restart-preset:text-is("60m")'), { ms: 420 });
    await rec.click(sidebar.locator('.restart-check:has-text("Repeat") input'), { ms: 380 });
    await rec.hold(250);
    await rec.click(sidebar.locator('.restart-actions .btn-sm.primary'), { ms: 420 });
    await rec.hold(500);
    await rec.spotlight(sidebar.locator('.restart-indicator'));
    await rec.hold(1600);
    await rec.spotlight(null);
    await rec.hideCaption();
    await rec.moveTo(760, 420, 400);
    await rec.loopBack();
  },
};
