/* v4 article: ▶ starts the ONE Orchestrator loop (Haiku by default); it edits no code and runs every
 * groom and implementation as a subagent on the task's own model and effort. */
'use strict';

const { files } = require('../lib/workspace');
const { Terminals } = require('../lib/terminal');
const ui = require('../lib/ui');

const WORK = 't-7b3e';
const GROOM = 't-4f2a';
const T0 = Date.parse('2026-09-25T10:00:00');

module.exports = {
  out: '../../v4/orchestrator.gif',
  workspace: () => ({
    orchestrator: true,
    files: files([GROOM, WORK], { overrides: {
      [GROOM]: ['phase: new', 'groomer: haiku', 'groomer-effort: low'],
      [WORK]: ['phase: backlog', 'model: opus', 'effort: high'],
    } }),
  }),
  layout: { panel: false, panelHeight: 270, feature: 'One Orchestrator loop' },
  webviewState: { board: { phase: 'backlog', collapsedDefault: { new: true, backlog: true, inprogress: true } } },
  async run(rec, ctx) {
    const { host, sidebar } = ctx;
    const term = new Terminals(rec, host);
    const O = 'orchestrator';
    const agent = (id, description, model, secs) => ({ id, agentType: 'general-purpose', description, model, startedAt: T0 - secs * 1000 });

    host.on('spawnLoop', async () => {
      host.loops[O].running = true;
      host.loops[O].context = { used: 21000, window: 1000000 };
      term.open(O);
      await rec.stage((o) => window.stage.layout(o), { panel: true, panelHeight: 270, feature: 'One Orchestrator loop' });
      await term.render(9);
      await host.refresh();
      return true;
    });

    await rec.placeCursor(760, 420);
    await rec.caption('1', '<b>▶</b> starts ONE loop: the Orchestrator, on <b>Haiku</b> by default');
    await rec.hold(900);
    await rec.click(ui.loopBtn(ctx, 'Orchestrator', 'Start loop'));
    await rec.hold(700);
    term.boot(O);
    await term.render(9);
    await rec.hold(500);
    await rec.spotlight(ctx.page.locator('#panel'));
    await rec.hold(1600);
    await rec.spotlight(null);

    await rec.caption('2', 'It edits no code: every task runs as a <b>subagent</b> on the task’s own model and effort');
    term.tool(O, 'Read', '.loopboard/TODO.md', 'Read 22 lines');
    term.say(O, 'Claiming <span class="t-blue">t-7b3e</span>: model opus, effort high (from the task).');
    host.editIndex(WORK, (e) => { e.phase = 'inprogress'; });
    host.editDetail(WORK, (d) => { d.started = host.today; });
    await host.refresh();
    await term.render(9);
    await rec.click(ui.tab(ctx, 'In Progress'), { ms: 450 });
    await rec.hold(300);
    term.tool(O, 'Agent', 'work opus-high-t-7b3e: Migrate integration tests', 'subagent started');
    term.tool(O, 'Agent', 'groom haiku-low-t-4f2a: Add rate limiting', 'subagent started');
    term.status(O, 'Waiting for 2 subagents…');
    term.busy(O, true);
    host.loops[O].agents = [
      agent('a3c1', `work opus-high-${WORK}: Migrate integration tests`, 'opus', 4),
      agent('b7e2', `groom haiku-low-${GROOM}: Add rate limiting`, 'haiku', 2),
    ];
    host.loops[O].context = { used: 38000, window: 1000000 };
    await host.refresh();
    await term.render(9);
    await rec.hold(900);

    await rec.caption('3', 'The sidebar names each row <b>role model-effort-task</b>');
    await rec.spotlight(sidebar.locator('.sb-section:has(.sb-label:text-is("Agents"))'));
    await rec.hold(1900);
    await rec.spotlight(sidebar.locator('.sb-section:has(.sb-label:text-is("In Progress"))'));
    await rec.hold(1600);
    await rec.spotlight(null);

    await rec.caption('4', 'A finished subagent leaves the list; the Opus worker keeps going');
    host.loops[O].agents = [agent('a3c1', `work opus-high-${WORK}: Migrate integration tests`, 'opus', 38)];
    term.say(O, 'Groomed <span class="t-blue">t-4f2a</span>. Next pass in 5m.');
    term.status(O, 'Waiting for 1 subagent…');
    await host.refresh();
    await term.render(9);
    await rec.hold(2200);
    await rec.hideCaption();
    await rec.moveTo(760, 420, 400);
    await rec.loopBack();
  },
};
