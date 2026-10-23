// Loop terminals: plain VSCode terminals, one per loop id (since t-0e99 only the orchestrator).
// Spawn/reuse/status/recycle + /loop injection. No external deps (no tmux/node-pty); output is
// never read.
import * as vscode from 'vscode';
import { LoopId, LOOPS, OrchestratorConfig, ResolvedModel, TaskDefaults, isValidModelString, isNarrowed } from './model';
import { LoopStatus } from './view';
import { buildLoopCommand, buildClaudeBase, isValidPermissionMode, isValidLoopInterval, revealStep, loopTerminalName } from './loop';
import { sessionSuffix, spawnSessionName } from './context';

// `/loop` is a slash command, so it must be submitted inside the running REPL to invoke the loop
// skill. The tiny bootstrap prompt rides as claude's initial-prompt argv in ONE command line
// (`claude --permission-mode <mode> --model <model> '/loop ...'`, single-quoted): the CLI seeds
// it into the REPL input as a pasted-text chip but does NOT auto-submit, so a lone Enter follows
// after BOOT_DELAY_MS, once the TUI has booted and its paste-detection window has closed (an
// Enter after that window is not folded into the paste). Tune via F5 if the host boots slower.
// SUBMIT_DELAY_MS is the shorter window used when pasting into an already-running REPL.
const BOOT_DELAY_MS = 3500;
const SUBMIT_DELAY_MS = 1500;

export interface LoopSpawnConfig {
  permissionMode: string;
  interval: number | string;
  orchestrator: OrchestratorConfig;
  models: ResolvedModel[]; // enabled task models, with their effort floor/ceiling
  defaults: TaskDefaults;
  // `ANTHROPIC_DEFAULT_<ALIAS>_MODEL` per overridden alias (aliasEnv, t-0e99 FB4): the terminal's
  // process env, so the orchestrator's own alias and every subagent spawned on it resolve to it.
  env: Record<string, string>;
}

export class TerminalManager {
  private changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeStatus = this.changeEmitter.event;
  private disposables: vscode.Disposable[] = [];
  // Which loop's terminal a loop-row click (or spawn) last revealed. It stays set across panel
  // hides: a further click on that row runs `workbench.action.togglePanel`, which flips the panel's
  // real visibility, so it needs no knowledge of whether the panel is currently shown (VS Code
  // offers no panel-visibility API, and hiding the panel never clears `activeTerminal`) (t-9c3f).
  private revealedLoop: LoopId | undefined;

  constructor(
    private getCwd: () => vscode.Uri,
    private getProject: () => string,
    private getLoopText: () => string,
    private getConfig: () => LoopSpawnConfig,
    // Opt-in debug trace (t-2901), routed through the store's single sink; defaults to a no-op so
    // the manager stays decoupled from the store and testable.
    private log: (level: 'info' | 'verbose', event: string, detail?: string) => void = () => {}
  ) {
    this.disposables.push(
      vscode.window.onDidOpenTerminal(() => this.changeEmitter.fire()),
      vscode.window.onDidCloseTerminal(() => this.changeEmitter.fire()),
      // Reset `revealedLoop` when the user switches to ANOTHER terminal: the panel would then show
      // someone else's terminal, so the next click on this row must show() this loop's terminal
      // rather than toggle the panel. Hiding the panel does NOT clear the active terminal, so this
      // never fires on a hide (⌘J included); togglePanel in reveal() covers that (t-2e35, t-9c3f).
      vscode.window.onDidChangeActiveTerminal((active) => {
        if (this.revealedLoop !== undefined && active !== this.find(this.revealedLoop)) {
          this.revealedLoop = undefined;
        }
      })
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.changeEmitter.dispose();
  }

  private find(loop: LoopId): vscode.Terminal | undefined {
    const name = loopTerminalName(loop);
    return vscode.window.terminals.find((t) => t.name === name);
  }

  status(): LoopStatus[] {
    const cfg = this.getConfig();
    // The row hint is what the next ▶/♻ spawns with: `<model> · <effort>`.
    return LOOPS.map((l) => ({
      id: l.id,
      name: l.label,
      running: !!this.find(l.id),
      hint: `${cfg.orchestrator.model} · ${cfg.orchestrator.effort}`,
    }));
  }

  // Reveal an already-running loop's terminal; does nothing if it isn't running (never creates
  // one: that's spawn()'s job). Focuses it unless `preserveFocus` is set; pass true for
  // automatic/lifecycle reveals (e.g. auto-recycle) so they never steal focus from the board;
  // explicit user gestures (clicking ▶ or a loop row) keep the default, focusing behaviour. Once
  // this loop's terminal has been revealed (`revealedLoop`, decided by the pure `revealStep`),
  // further calls run `workbench.action.togglePanel` (the command ⌘J runs) and keep the flag
  // set: it flips the panel's REAL state, so a panel hidden or shown externally (⌘J) never costs a
  // dead click, and re-opening restores the last panel view with focus. VSCode has no per-terminal
  // hide API, and hiding the panel never disposes a terminal, so the loop stays alive and is shown
  // intact on the next reveal (t-9c3f).
  reveal(loop: LoopId, preserveFocus = false): void {
    const terminal = this.find(loop);
    if (!terminal) return;
    if (revealStep(this.revealedLoop, loop) === 'togglePanel') {
      vscode.commands.executeCommand('workbench.action.togglePanel');
      this.log('info', 'loop-reveal', `${loop} -> toggle panel`);
    } else {
      terminal.show(preserveFocus);
      this.log('info', 'loop-reveal', `${loop} -> show`);
    }
    this.revealedLoop = loop;
  }

  spawn(loop: LoopId, preserveFocus = false): void {
    const existing = this.find(loop);
    if (existing) {
      existing.show(preserveFocus);
      this.revealedLoop = loop;
      this.log('info', 'loop-spawn', `${loop} -> already running (revealed)`);
      return;
    }
    const cfg = this.getConfig();
    // `resolveOrchestrator` already validated the `--model` alias; it is checked once more right
    // before it reaches the shell line, so no code path splices an unvalidated config value.
    const modelString = cfg.orchestrator.model;
    if (!isValidModelString(modelString)) {
      this.log('info', 'loop-spawn', `${loop} -> aborted (invalid --model "${modelString}")`);
      vscode.window.showWarningMessage(`LoopBoard: the configured orchestrator --model is invalid, so the loop was not started.`);
      return;
    }
    // permissionMode/interval are spliced into the shell line (buildClaudeBase / buildLoopCommand),
    // which sanitize them to safe defaults; warn so the user knows an off-list setting was ignored.
    if (!isValidPermissionMode(cfg.permissionMode)) {
      this.log('info', 'loop-spawn', `${loop} -> invalid permissionMode "${cfg.permissionMode}"`);
      vscode.window.showWarningMessage(`LoopBoard: invalid loopBoard.permissionMode "${cfg.permissionMode}", using "auto".`);
    }
    if (!isValidLoopInterval(cfg.interval)) {
      this.log('info', 'loop-spawn', `${loop} -> invalid loopInterval "${cfg.interval}"`);
      vscode.window.showWarningMessage(`LoopBoard: invalid loopBoard.loopInterval "${cfg.interval}", using 1 minute.`);
    }
    // Everything below is frozen at spawn: the `--model`/`--effort` flags, and the cap, task models
    // and defaults in the prompt. A settings change reaches the loop only on its next ▶/♻.
    const cmd = buildLoopCommand(this.getLoopText(), cfg.interval, {
      groomConcurrency: cfg.orchestrator.groomConcurrency,
      models: cfg.models,
      defaults: cfg.defaults,
    });
    const env = Object.keys(cfg.env).length ? cfg.env : undefined;
    const terminal = vscode.window.createTerminal({ name: loopTerminalName(loop), cwd: this.getCwd(), env });
    terminal.show(preserveFocus);
    this.revealedLoop = loop;
    // `--name loopboard-<project>-<loop>-<suffix>` is what lets the context indicator (t-2b89) find THIS
    // loop's session file among all live claude processes (they all share the workspace cwd). The
    // suffix is fresh per spawn (t-x1t1) and deliberately NOT remembered: the `--name` registry is
    // global to `~/.claude/sessions/`, so without it a second VSCode window on a different folder,
    // or a recycle respawning before the old process let go, would take the bare name first and
    // this session would be renamed `nameSource: "collision"` for its whole life, hiding the bar.
    // `matchesSlot` reads the bare `loopboard-<project>-<loop>` as a prefix, so the reader needs nothing more.
    const name = spawnSessionName(loop, this.getProject(), sessionSuffix(Math.random()));
    const base = buildClaudeBase(cfg.permissionMode, modelString, name, cfg.orchestrator.effort);
    const d = cfg.defaults;
    const models = cfg.models.map((m) => `${m.id}${isNarrowed(m) ? ` ${m.minEffort}-${m.maxEffort}` : ''}`);
    const envNote = Object.entries(cfg.env).map(([k, v]) => `${k}=${v}`).join(' ');
    this.log(
      'info',
      'loop-spawn',
      `${loop} -> --name ${name} --model ${modelString} (effort ${cfg.orchestrator.effort}, groom cap ${cfg.orchestrator.groomConcurrency}, ` +
        `task models ${models.join(',') || 'none'}, defaults groomer ${d.groomer}/${d.groomerEffort} ` +
        `worker ${d.worker}/${d.workerEffort} reviewer ${d.reviewer}/${d.reviewerEffort}${envNote ? `, env ${envNote}` : ''})`
    );
    if (cmd) {
      // One command line: the bootstrap prompt rides as claude's initial-prompt argv (see the
      // delay note above). Single-quoted; the prompt is one short line built by buildLoopCommand.
      terminal.sendText(`${base} '${cmd.replace(/'/g, `'\\''`)}'`);
      // The CLI only seeds the argv prompt into the REPL input: submit it with a lone Enter
      // once the TUI has booted and its paste-detection window has closed.
      setTimeout(() => {
        // Guard: the user may have closed or replaced the terminal during the delay.
        if (this.find(loop) === terminal) terminal.sendText('', true);
      }, BOOT_DELAY_MS);
    } else {
      terminal.sendText(base);
      this.log('info', 'loop-spawn', `${loop} -> no loop instructions found, starting without a loop`);
      vscode.window.showWarningMessage('LoopBoard: no loop instructions found in .loopboard/LOOP.md Automation section, so claude was started without a loop.');
    }
    this.changeEmitter.fire();
  }

  // `note` is appended to the log detail. Only the manual ■/♻ handlers pass one (what the stop
  // killed, since this manager has no agent state of its own, t-aglg); automatic callers log the
  // agent side on their own line and leave the detail bare.
  stop(loop: LoopId, note?: string): void {
    if (this.revealedLoop === loop) this.revealedLoop = undefined;
    this.log('info', 'loop-stop', note ? `${loop}: ${note}` : loop);
    this.find(loop)?.dispose();
  }

  recycle(loop: LoopId, preserveFocus = false, note?: string): void {
    if (this.revealedLoop === loop) this.revealedLoop = undefined;
    this.log('info', 'loop-recycle', note ? `${loop}: ${note}` : loop);
    const existing = this.find(loop);
    if (existing) existing.dispose();
    // Respawn shortly after disposal so the name is free.
    setTimeout(() => this.spawn(loop, preserveFocus), 400);
  }

  // Send /clear into the running loop terminal to reset the claude conversation context, keeping the
  // terminal open. /clear is a slash command, so it must be submitted inside the REPL: paste it with
  // no newline, then a lone Enter after the paste-detection window closes (same pattern as spawn()).
  clearSession(loop: LoopId): void {
    const terminal = this.find(loop);
    if (!terminal) return;
    this.log('info', 'loop-clear', loop);
    terminal.sendText('/clear', false);
    setTimeout(() => {
      if (this.find(loop) === terminal) terminal.sendText('', true);
    }, SUBMIT_DELAY_MS);
  }

  // Steering nudge (t-068e): paste one line naming what changed into the running loop. Delivery is
  // IMMEDIATE and cannot interrupt work in flight: the text only seeds the REPL input, exactly like
  // /clear, and is submitted by the same lone Enter after the paste-detection window closes.
  // Returns false when the loop has no terminal, so the caller can hold the nudge for the next
  // spawn rather than losing it; a missing terminal is never an error.
  nudge(loop: LoopId, text: string): boolean {
    const terminal = this.find(loop);
    if (!terminal) return false;
    this.log('info', 'loop-nudge', `${loop}: ${text}`);
    terminal.sendText(text, false);
    setTimeout(() => {
      if (this.find(loop) === terminal) terminal.sendText('', true);
    }, SUBMIT_DELAY_MS);
    return true;
  }

  // Legacy per-model loop terminals (`Claude Opus|Sonnet|Fable`) still open, e.g. revived by VSCode
  // across the reload that installed this version (t-0e99). Disposing one is a plain ■.
  openTerminalNames(): string[] {
    return vscode.window.terminals.map((t) => t.name);
  }

  disposeTerminals(names: readonly string[]): number {
    let n = 0;
    for (const t of [...vscode.window.terminals]) {
      if (!names.includes(t.name)) continue;
      t.dispose();
      n++;
    }
    return n;
  }
}
