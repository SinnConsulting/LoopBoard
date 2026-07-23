// Loop terminals: plain VSCode terminals, one per model. Spawn/reuse/status/recycle
// + /loop injection. No external deps (no tmux/node-pty); output is never read.
import * as vscode from 'vscode';
import { Model, ResolvedModel, BUILTIN_MODEL_IDS, isValidModelString } from './model';
import { LoopStatus } from './view';
import { buildLoopCommand, buildClaudeBase } from './loop';

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

  constructor(
    private getCwd: () => vscode.Uri,
    private getLoopText: () => string,
    private getConfig: () => { permissionMode: string; interval: string; defaultModel: Model; models: ResolvedModel[] }
  ) {
    this.disposables.push(
      vscode.window.onDidOpenTerminal(() => this.changeEmitter.fire()),
      vscode.window.onDidCloseTerminal(() => this.changeEmitter.fire())
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
    const def = cfg.defaultModel;
    // Only enabled slots appear in the Loops overview.
    return cfg.models
      .filter((m) => m.enabled)
      .map((m) => ({
        id: m.id,
        name: m.label,
        running: !!this.find(m.id),
        hint: m.id === def ? 'default' : `model: ${m.id}`,
      }));
  }

  spawn(model: Model): void {
    const existing = this.find(model);
    if (existing) {
      existing.show();
      return;
    }
    const cfg = this.getConfig();
    // Resolve the actual `--model` string for this slot (custom override or built-in default), and
    // validate it before it reaches the shell line — never splice an unvalidated config value.
    const resolved = cfg.models.find((m) => m.id === model);
    const modelString = resolved ? resolved.model : model;
    if (!isValidModelString(modelString)) {
      vscode.window.showWarningMessage(`LoopBoard: the configured --model for "${model}" is invalid — not starting the loop.`);
      return;
    }
    // The bootstrap prompt names the LOGICAL slot (model), so the worker claims `model: <slot>`
    // tasks; the terminal itself spawns with the resolved (possibly 1M-suffixed) --model string.
    const cmd = buildLoopCommand(this.getLoopText(), model, cfg.interval);
    const terminal = vscode.window.createTerminal({ name: terminalName(model), cwd: this.getCwd() });
    terminal.show();
    const base = buildClaudeBase(cfg.permissionMode, modelString);
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
      vscode.window.showWarningMessage('LoopBoard: no loop instructions found in .loopboard/LOOP.md Automation section — starting claude without a loop.');
    }
    this.changeEmitter.fire();
  }

  stop(model: Model): void {
    this.find(model)?.dispose();
  }

  recycle(model: Model): void {
    const existing = this.find(model);
    if (existing) existing.dispose();
    // Respawn shortly after disposal so the name is free.
    setTimeout(() => this.spawn(model), 400);
  }

  // Send /clear into the running loop terminal to reset the claude conversation context, keeping the
  // terminal open. /clear is a slash command, so it must be submitted inside the REPL: paste it with
  // no newline, then a lone Enter after the paste-detection window closes (same pattern as spawn()).
  clearSession(model: Model): void {
    const terminal = this.find(model);
    if (!terminal) return;
    terminal.sendText('/clear', false);
    setTimeout(() => {
      if (this.find(model) === terminal) terminal.sendText('', true);
    }, SUBMIT_DELAY_MS);
  }
}
