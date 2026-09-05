// Loop terminals: plain VSCode terminals, one per model. Spawn/reuse/status/recycle
// + /loop injection. No external deps (no tmux/node-pty); output is never read.
import * as vscode from 'vscode';
import { Model, ResolvedModel, BUILTIN_MODEL_IDS, isValidModelString, sanitizeGroomConcurrency } from './model';
import { LoopStatus } from './view';
import { buildLoopCommand, buildClaudeBase, isValidPermissionMode, isValidLoopInterval } from './loop';
import { sessionName } from './context';

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
  // Which model's terminal our own toggle last revealed — tracked independently of
  // `vscode.window.activeTerminal` because `workbench.action.closePanel` hides the panel without
  // clearing it, so the active-terminal check alone can never observe "currently hidden" and a
  // third click would try to hide an already-hidden panel instead of showing it again.
  private revealedModel: Model | undefined;

  constructor(
    private getCwd: () => vscode.Uri,
    private getLoopText: () => string,
    private getConfig: () => { permissionMode: string; interval: string; models: ResolvedModel[] },
    // Opt-in debug trace (t-2901) — routed through the store's single sink; defaults to a no-op so
    // the manager stays decoupled from the store and testable.
    private log: (level: 'info' | 'verbose', event: string, detail?: string) => void = () => {}
  ) {
    this.disposables.push(
      vscode.window.onDidOpenTerminal(() => this.changeEmitter.fire()),
      vscode.window.onDidCloseTerminal(() => this.changeEmitter.fire()),
      // Self-heal `revealedModel` against an external hide (e.g. native CMD+J Toggle Panel):
      // VS Code clears the active terminal when the terminal panel loses visibility, so if the
      // active terminal is no longer the one we last revealed, our flag is stale — reset it so
      // the next loop-row click show()s instead of firing a no-op closePanel (t-2e35).
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
  // explicit user gestures (clicking ▶ or a loop row) keep the default, focusing behaviour. A
  // second call for the same model toggles the whole bottom panel closed instead — VSCode has no
  // per-terminal hide API, and closePanel never disposes a terminal, so every loop (including
  // this one) stays alive and is shown intact on the next reveal. Tracked via `revealedModel`
  // rather than `vscode.window.activeTerminal`: closePanel hides the panel without clearing the
  // active terminal, so a live activeTerminal check can't tell "hidden" from "shown" and a third
  // click would silently no-op instead of re-showing.
  reveal(model: Model, preserveFocus = false): void {
    const terminal = this.find(model);
    if (!terminal) return;
    if (this.revealedModel === model) {
      vscode.commands.executeCommand('workbench.action.closePanel');
      this.revealedModel = undefined;
      this.log('info', 'loop-reveal', `${model} -> hide`);
      return;
    }
    terminal.show(preserveFocus);
    this.revealedModel = model;
    this.log('info', 'loop-reveal', `${model} -> show`);
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
    // defaults invalid/absent to 'high' / 3). Both are frozen at spawn: a settings change reaches
    // this slot only on its next start/restart (♻), exactly like the interval.
    const cmd = buildLoopCommand(this.getLoopText(), model, cfg.interval, resolved?.effort, resolved?.groomConcurrency);
    const terminal = vscode.window.createTerminal({ name: terminalName(model), cwd: this.getCwd() });
    terminal.show(preserveFocus);
    this.revealedModel = model;
    // `--name loopboard-<slot>` is what lets the context indicator (t-2b89) find THIS slot's
    // session file among all live claude processes — they all share the workspace cwd.
    const base = buildClaudeBase(cfg.permissionMode, modelString, sessionName(model));
    this.log(
      'info',
      'loop-spawn',
      `${model} -> --model ${modelString} (effort ${resolved?.effort ?? 'high'}, groom cap ${sanitizeGroomConcurrency(resolved?.groomConcurrency)})`
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

  stop(model: Model): void {
    if (this.revealedModel === model) this.revealedModel = undefined;
    this.log('info', 'loop-stop', model);
    this.find(model)?.dispose();
  }

  recycle(model: Model, preserveFocus = false): void {
    if (this.revealedModel === model) this.revealedModel = undefined;
    this.log('info', 'loop-recycle', model);
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
