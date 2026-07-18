// Loop terminals: plain VSCode terminals, one per model. Spawn/reuse/status/recycle
// + /loop injection. No external deps (no tmux/node-pty); output is never read.
import * as vscode from 'vscode';
import { Board, Model } from './model';
import { LoopStatus } from './view';
import { buildLoopCommand } from './loop';

const MODELS: { id: Model; name: string }[] = [
  { id: 'opus', name: 'Opus' },
  { id: 'sonnet', name: 'Sonnet' },
  { id: 'fable', name: 'Fable' },
];

function terminalName(model: Model): string {
  return 'Claude ' + model.charAt(0).toUpperCase() + model.slice(1);
}

// `/loop` is a slash command, so it must be submitted inside the running REPL to invoke the loop
// skill — passing it as claude's initial-prompt argv sends it as literal text. So: launch claude
// bare, wait for the TUI to boot, paste the single-line prompt into the REPL input (no newline),
// then send a lone Enter once the bracketed-paste detection window has closed (an Enter after that
// window is not folded into the paste). Tune both via F5 if the host boots/pastes slower.
const BOOT_DELAY_MS = 3500;
const SUBMIT_DELAY_MS = 1500;

export class TerminalManager {
  private changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeStatus = this.changeEmitter.event;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private getCwd: () => vscode.Uri,
    private getBoard: () => Board | undefined,
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
    const board = this.getBoard();
    const cmd = board ? buildLoopCommand(board, model, cfg.interval) : undefined;
    const terminal = vscode.window.createTerminal({ name: terminalName(model), cwd: this.getCwd() });
    terminal.show();
    const base = `claude --permission-mode ${cfg.permissionMode} --model ${model}`;
    // Launch claude bare so the /loop slash command can be submitted inside the REPL (see BOOT/
    // SUBMIT delay note above); passing it as argv would send it as literal text, not run the skill.
    terminal.sendText(base);
    if (cmd) {
      setTimeout(() => {
        // Guard: the user may have closed or replaced the terminal during the delay.
        if (this.find(model) !== terminal) return;
        // Paste the single-line prompt into the REPL input without a newline...
        terminal.sendText(cmd, false);
        // ...then submit it with a lone Enter after the paste-detection window closes.
        setTimeout(() => {
          if (this.find(model) === terminal) terminal.sendText('', true);
        }, SUBMIT_DELAY_MS);
      }, BOOT_DELAY_MS);
    } else {
      vscode.window.showWarningMessage('LoopBoard: no loop template found in TODO.md Automation section — starting claude without a loop.');
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
