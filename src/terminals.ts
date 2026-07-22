// Loop terminals: plain VSCode terminals, one per model. Spawn/reuse/status/recycle
// + /loop injection. No external deps (no tmux/node-pty); output is never read.
import * as vscode from 'vscode';
import { Model } from './model';
import { LoopStatus } from './view';
import { buildLoopCommand } from './loop';

const MODELS: { id: Model; name: string }[] = [
  { id: 'opus', name: 'Opus' },
  { id: 'sonnet', name: 'Sonnet' },
  { id: 'fable', name: 'Fable' },
];

// Runtime allowlist for untrusted (webview-supplied) model ids — kept next to MODELS so the two
// can't drift. The webview values reach the loop terminal shell line, so the host validates them
// rather than trusting a compile-time `as Model` cast.
export function isKnownModel(x: unknown): x is Model {
  return MODELS.some((m) => m.id === x);
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
    private getConfig: () => { permissionMode: string; interval: string; defaultModel: Model }
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
    const def = this.getConfig().defaultModel;
    return MODELS.map((m) => ({
      id: m.id,
      name: m.name,
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
    const cmd = buildLoopCommand(this.getLoopText(), model, cfg.interval);
    const terminal = vscode.window.createTerminal({ name: terminalName(model), cwd: this.getCwd() });
    terminal.show();
    const base = `claude --permission-mode ${cfg.permissionMode} --model ${model}`;
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
