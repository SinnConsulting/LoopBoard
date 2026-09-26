// Loop terminals: plain VSCode terminals, one per model. Spawn/reuse/status/recycle
// + /loop injection. No external deps (no tmux/node-pty); output is never read.
import * as vscode from 'vscode';
import { Model, ResolvedModel, BUILTIN_MODEL_IDS, isValidModelString, sanitizeGroomConcurrency } from './model';
import { LoopStatus } from './view';
import { buildLoopCommand, buildClaudeBase, isValidPermissionMode, isValidLoopInterval, revealStep } from './loop';
import { sessionSuffix, spawnSessionName } from './context';

// Runtime allowlist for untrusted (webview-supplied) model ids — the logical slot ids. The webview
// values reach the loop terminal shell line, so the host validates them rather than trusting a
// compile-time `as Model` cast. (The configurable part is each slot's `--model` string, resolved
// and separately validated in spawn(); the set of logical ids stays fixed.)
export function isKnownModel(x: unknown): x is Model {
  return typeof x === 'string' && (BUILTIN_MODEL_IDS as string[]).includes(x);
}

function terminalName(model: Model): string {
  return 'Claude ' + model.charAt(0).toUpperCase() + model.slice(1);
}

// Sidebar-only display order for the Loops rows — explicit and independent of BUILTIN_MODELS
// (which also drives the board/composer/settings select order; reordering that would ripple into
// all of those). Touching the Loops row order means editing this one array.
const SIDEBAR_LOOP_ORDER: Model[] = ['fable', 'opus', 'sonnet'];

// `/loop` is a slash command, so it must be submitted inside the running REPL to invoke the loop
// skill. The tiny bootstrap prompt rides as claude's initial-prompt argv in ONE command line
// (`claude --permission-mode <mode> --model <model> '/loop ...'`, single-quoted): the CLI seeds
// it into the REPL input as a pasted-text chip but does NOT auto-submit, so a lone Enter follows
// after BOOT_DELAY_MS, once the TUI has booted and its paste-detection window has closed (an
// Enter after that window is not folded into the paste). Tune via F5 if the host boots slower.
// SUBMIT_DELAY_MS is the shorter window used when pasting into an already-running REPL.
const BOOT_DELAY_MS = 3500;
const SUBMIT_DELAY_MS = 1500;

export class TerminalManager {
  private changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeStatus = this.changeEmitter.event;
  private disposables: vscode.Disposable[] = [];
  // Which model's terminal a loop-row click (or spawn) last revealed. It stays set across panel
  // hides: a further click on that row runs `workbench.action.togglePanel`, which flips the panel's
  // real visibility, so it needs no knowledge of whether the panel is currently shown (VS Code
  // offers no panel-visibility API, and hiding the panel never clears `activeTerminal`) (t-9c3f).
  private revealedModel: Model | undefined;

  constructor(
    private getCwd: () => vscode.Uri,
    private getLoopText: () => string,
    private getConfig: () => {
      permissionMode: string;
      interval: string;
      models: ResolvedModel[];
      delegateWork: boolean;
      delegateReview: boolean;
    },
    // Opt-in debug trace (t-2901) — routed through the store's single sink; defaults to a no-op so
    // the manager stays decoupled from the store and testable.
    private log: (level: 'info' | 'verbose', event: string, detail?: string) => void = () => {}
  ) {
    this.disposables.push(
      vscode.window.onDidOpenTerminal(() => this.changeEmitter.fire()),
      vscode.window.onDidCloseTerminal(() => this.changeEmitter.fire()),
      // Reset `revealedModel` when the user switches to ANOTHER terminal: the panel would then show
      // someone else's terminal, so the next click on this row must show() this model's terminal
      // rather than toggle the panel. Hiding the panel does NOT clear the active terminal, so this
      // never fires on a hide (⌘J included) — togglePanel in reveal() covers that (t-2e35, t-9c3f).
      vscode.window.onDidChangeActiveTerminal((active) => {
        if (this.revealedModel !== undefined && active !== this.find(this.revealedModel)) {
          this.revealedModel = undefined;
        }
      })
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.changeEmitter.dispose();
  }

  private find(model: Model): vscode.Terminal | undefined {
    const name = terminalName(model);
    return vscode.window.terminals.find((t) => t.name === name);
  }

  status(): LoopStatus[] {
    const cfg = this.getConfig();
    // Only enabled slots appear in the Loops overview, sorted into the explicit sidebar order.
    return cfg.models
      .filter((m) => m.enabled)
      .sort((a, b) => SIDEBAR_LOOP_ORDER.indexOf(a.id) - SIDEBAR_LOOP_ORDER.indexOf(b.id))
      .map((m) => ({
        id: m.id,
        name: m.label,
        running: !!this.find(m.id),
        // No override configured (resolved model === the slot's built-in default) => no hint at
        // all, just the slot name. A custom override shows the actual spawned --model string.
        hint: m.model === m.id ? '' : `model: ${m.model}`,
      }));
  }

  // Reveal an already-running loop's terminal; does nothing if it isn't running (never creates
  // one — that's spawn()'s job). Focuses it unless `preserveFocus` is set — pass true for
  // automatic/lifecycle reveals (e.g. auto-recycle) so they never steal focus from the board;
  // explicit user gestures (clicking ▶ or a loop row) keep the default, focusing behaviour. Once
  // this model's terminal has been revealed (`revealedModel`, decided by the pure `revealStep`),
  // further calls run `workbench.action.togglePanel` — the command ⌘J runs — and keep the flag
  // set: it flips the panel's REAL state, so a panel hidden or shown externally (⌘J) never costs a
  // dead click, and re-opening restores the last panel view (the terminal, showing this model's
  // active terminal) with focus. VSCode has no per-terminal hide API, and hiding the panel never
  // disposes a terminal, so every loop stays alive and is shown intact on the next reveal (t-9c3f).
  reveal(model: Model, preserveFocus = false): void {
    const terminal = this.find(model);
    if (!terminal) return;
    if (revealStep(this.revealedModel, model) === 'togglePanel') {
      vscode.commands.executeCommand('workbench.action.togglePanel');
      this.log('info', 'loop-reveal', `${model} -> toggle panel`);
    } else {
      terminal.show(preserveFocus);
      this.log('info', 'loop-reveal', `${model} -> show`);
    }
    this.revealedModel = model;
  }

  spawn(model: Model, preserveFocus = false): void {
    const existing = this.find(model);
    if (existing) {
      existing.show(preserveFocus);
      this.revealedModel = model;
      this.log('info', 'loop-spawn', `${model} -> already running (revealed)`);
      return;
    }
    const cfg = this.getConfig();
    // Resolve the actual `--model` string for this slot (custom override or built-in default), and
    // validate it before it reaches the shell line — never splice an unvalidated config value.
    const resolved = cfg.models.find((m) => m.id === model);
    const modelString = resolved ? resolved.model : model;
    if (!isValidModelString(modelString)) {
      this.log('info', 'loop-spawn', `${model} -> aborted (invalid --model "${modelString}")`);
      vscode.window.showWarningMessage(`LoopBoard: the configured --model for "${model}" is invalid — not starting the loop.`);
      return;
    }
    // permissionMode/interval are spliced into the shell line (buildClaudeBase / buildLoopCommand),
    // which sanitize them to safe defaults; warn so the user knows an off-list setting was ignored.
    if (!isValidPermissionMode(cfg.permissionMode)) {
      this.log('info', 'loop-spawn', `${model} -> invalid permissionMode "${cfg.permissionMode}"`);
      vscode.window.showWarningMessage(`LoopBoard: invalid loopBoard.permissionMode "${cfg.permissionMode}" — using "auto".`);
    }
    if (!isValidLoopInterval(cfg.interval)) {
      this.log('info', 'loop-spawn', `${model} -> invalid loopInterval "${cfg.interval}"`);
      vscode.window.showWarningMessage(`LoopBoard: invalid loopBoard.loopInterval "${cfg.interval}" — using "1m".`);
    }
    // The bootstrap prompt names the LOGICAL slot (model), so the worker claims `model: <slot>`
    // tasks; the terminal itself spawns with the resolved (possibly 1M-suffixed) --model string.
    // `resolved.effort` and `resolved.groomConcurrency` are already validated (resolveModels
    // defaults invalid/absent to 'medium' / 3). Both are frozen at spawn — effort as the
    // `--effort` flag (buildClaudeBase), the cap in the prompt: a settings change reaches this slot
    // only on its next start/restart (♻), exactly like the interval.
    const cmd = buildLoopCommand(
      this.getLoopText(),
      model,
      cfg.interval,
      resolved?.groomConcurrency,
      cfg.delegateWork,
      cfg.delegateReview
    );
    const terminal = vscode.window.createTerminal({ name: terminalName(model), cwd: this.getCwd() });
    terminal.show(preserveFocus);
    this.revealedModel = model;
    // `--name loopboard-<slot>-<suffix>` is what lets the context indicator (t-2b89) find THIS
    // slot's session file among all live claude processes — they all share the workspace cwd. The
    // suffix is fresh per spawn (t-x1t1) and deliberately NOT remembered: the `--name` registry is
    // global to `~/.claude/sessions/`, so without it a second VSCode window on a different folder —
    // or a recycle respawning before the old process let go — would take the bare name first and
    // this session would be renamed `nameSource: "collision"` for its whole life, hiding the bar.
    // `matchesSlot` reads the bare `loopboard-<slot>` as a prefix, so the reader needs nothing more.
    const base = buildClaudeBase(
      cfg.permissionMode,
      modelString,
      spawnSessionName(model, sessionSuffix(Math.random())),
      resolved?.effort
    );
    this.log(
      'info',
      'loop-spawn',
      `${model} -> --model ${modelString} (effort ${resolved?.effort ?? 'medium'}, groom cap ${sanitizeGroomConcurrency(resolved?.groomConcurrency)}, ` +
        `delegate ${cfg.delegateWork === true ? 'on' : 'off'}, review ${cfg.delegateReview === false ? 'off' : 'on'})`
    );
    if (cmd) {
      // One command line: the bootstrap prompt rides as claude's initial-prompt argv (see the
      // delay note above). Single-quoted; the prompt is one short line built by buildLoopCommand.
      terminal.sendText(`${base} '${cmd.replace(/'/g, `'\\''`)}'`);
      // The CLI only seeds the argv prompt into the REPL input — submit it with a lone Enter
      // once the TUI has booted and its paste-detection window has closed.
      setTimeout(() => {
        // Guard: the user may have closed or replaced the terminal during the delay.
        if (this.find(model) === terminal) terminal.sendText('', true);
      }, BOOT_DELAY_MS);
    } else {
      terminal.sendText(base);
      this.log('info', 'loop-spawn', `${model} -> no loop instructions found, starting without a loop`);
      vscode.window.showWarningMessage('LoopBoard: no loop instructions found in .loopboard/LOOP.md Automation section — starting claude without a loop.');
    }
    this.changeEmitter.fire();
  }

  // `note` is appended to the log detail. Only the manual ■/♻ handlers pass one — what the stop
  // killed, since this manager has no agent state of its own (t-aglg); automatic callers log the
  // agent side on their own line and leave the detail bare.
  stop(model: Model, note?: string): void {
    if (this.revealedModel === model) this.revealedModel = undefined;
    this.log('info', 'loop-stop', note ? `${model} — ${note}` : model);
    this.find(model)?.dispose();
  }

  recycle(model: Model, preserveFocus = false, note?: string): void {
    if (this.revealedModel === model) this.revealedModel = undefined;
    this.log('info', 'loop-recycle', note ? `${model} — ${note}` : model);
    const existing = this.find(model);
    if (existing) existing.dispose();
    // Respawn shortly after disposal so the name is free.
    setTimeout(() => this.spawn(model, preserveFocus), 400);
  }

  // Send /clear into the running loop terminal to reset the claude conversation context, keeping the
  // terminal open. /clear is a slash command, so it must be submitted inside the REPL: paste it with
  // no newline, then a lone Enter after the paste-detection window closes (same pattern as spawn()).
  clearSession(model: Model): void {
    const terminal = this.find(model);
    if (!terminal) return;
    this.log('info', 'loop-clear', model);
    terminal.sendText('/clear', false);
    setTimeout(() => {
      if (this.find(model) === terminal) terminal.sendText('', true);
    }, SUBMIT_DELAY_MS);
  }

  // Steering nudge (t-068e): paste one line naming what changed into a model's running loop.
  // Delivery is IMMEDIATE and cannot interrupt work in flight — the text only seeds the REPL
  // input, exactly like /clear, and is submitted by the same lone Enter after the paste-detection
  // window closes. Returns false when that model has no terminal, so the caller can hold the
  // nudge for the next spawn rather than losing it; a missing terminal is never an error.
  nudge(model: Model, text: string): boolean {
    const terminal = this.find(model);
    if (!terminal) return false;
    this.log('info', 'loop-nudge', `${model} — ${text}`);
    terminal.sendText(text, false);
    setTimeout(() => {
      if (this.find(model) === terminal) terminal.sendText('', true);
    }, SUBMIT_DELAY_MS);
    return true;
  }
}
