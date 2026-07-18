// Wires store + terminals + panel + sidebar. Handles webview messages and refreshes.
import * as vscode from 'vscode';
import { Store } from './store';
import { TerminalManager } from './terminals';
import { BoardPanel } from './panel';
import { SidebarProvider } from './sidebar';
import { toWebviewBoard, WebBoard } from './view';
import { Model, Board } from './model';
import { FieldPatch } from './merge';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export class Controller {
  private lastBoard: Board | undefined;
  private pendingReveal: { taskId?: string; phase?: string } | undefined;

  constructor(
    private extensionUri: vscode.Uri,
    private store: Store,
    private terminals: TerminalManager,
    private sidebar: SidebarProvider
  ) {
    store.onChange(() => this.refresh());
    terminals.onDidChangeStatus(() => this.refresh());
    sidebar.onMessage((msg) => this.handleMessage(msg));
  }

  getBoard(): Board | undefined {
    return this.lastBoard;
  }

  private config() {
    const c = vscode.workspace.getConfiguration('loopBoard');
    return {
      permissionMode: c.get<string>('permissionMode', 'auto'),
      interval: c.get<string>('loopInterval', '1m'),
      defaultModel: c.get<Model>('defaultModel', 'opus'),
      autoRecycle: c.get<boolean>('autoRecycle', false),
      clearSessionAfterTask: c.get<boolean>('clearSessionAfterTask', false),
    };
  }

  private buildWebBoard(board: Board): WebBoard {
    const web = toWebviewBoard(board, this.store.workspaceName, this.config().defaultModel, this.terminals.status());
    web.todoMissing = this.store.todoMissing;
    return web;
  }

  async refresh(): Promise<void> {
    const board = await this.store.load();
    this.maybeAutoRecycle(this.lastBoard, board);
    this.maybeClearSession(this.lastBoard, board);
    this.lastBoard = board;
    const web = this.buildWebBoard(board);
    BoardPanel.current?.post({ type: 'board', board: web });
    this.sidebar.post({ type: 'board', board: web });
    this.sidebar.setBadge(web.badge);
  }

  openBoard(): void {
    const panel = BoardPanel.show(this.extensionUri);
    panel.onMessage((msg) => this.handleMessage(msg));
    // The webview sends 'ready' once loaded; that handler posts the board.
  }

  private flushReveal(): void {
    if (this.pendingReveal && this.lastBoard) {
      BoardPanel.current?.post({ type: 'reveal', ...this.pendingReveal });
      this.pendingReveal = undefined;
    }
  }

  // Auto-recycle: when a model's task leaves In Progress and it has none left, recycle its terminal.
  private maybeAutoRecycle(prev: Board | undefined, next: Board): void {
    if (!prev || !this.config().autoRecycle) return;
    const inProgressBy = (b: Board, model: Model): number =>
      b.tasks.filter((t) => t.phase === 'inprogress' && (t.model ?? this.config().defaultModel) === model).length;
    for (const model of ['opus', 'sonnet', 'fable'] as Model[]) {
      const before = inProgressBy(prev, model);
      const after = inProgressBy(next, model);
      if (before > 0 && after === 0) {
        this.terminals.recycle(model);
      }
    }
  }

  // Clear-after-task: when a model's task leaves In Progress and it has none left, send /clear to its
  // terminal to reset the conversation context (terminal stays open). Runs after store.load() has
  // re-read the just-written TODO.md, so the tracker is persisted before we clear. Opt-in; skipped
  // when autoRecycle is on, since recycling already yields a fresh context.
  private maybeClearSession(prev: Board | undefined, next: Board): void {
    const cfg = this.config();
    if (!prev || !cfg.clearSessionAfterTask || cfg.autoRecycle) return;
    const inProgressBy = (b: Board, model: Model): number =>
      b.tasks.filter((t) => t.phase === 'inprogress' && (t.model ?? cfg.defaultModel) === model).length;
    for (const model of ['opus', 'sonnet', 'fable'] as Model[]) {
      const before = inProgressBy(prev, model);
      const after = inProgressBy(next, model);
      if (before > 0 && after === 0) {
        this.terminals.clearSession(model);
      }
    }
  }

  private toast(level: 'info' | 'success' | 'warning', text: string, taskId?: string): void {
    BoardPanel.current?.post({ type: 'toast', level, text, taskId });
  }

  async handleMessage(msg: any): Promise<void> {
    switch (msg?.type) {
      case 'ready':
        if (this.lastBoard) {
          const web = this.buildWebBoard(this.lastBoard);
          BoardPanel.current?.post({ type: 'board', board: web });
          this.sidebar.post({ type: 'board', board: web });
          this.sidebar.setBadge(web.badge);
        } else {
          await this.refresh();
        }
        this.flushReveal();
        return;
      case 'patch':
        return this.onPatch(msg.patch as FieldPatch);
      case 'gate':
        return this.onGate(msg.taskId, msg.action);
      case 'createDraft':
        await this.store.createDraft(String(msg.text ?? ''), today(), String(msg.groomer ?? ''), String(msg.model ?? ''));
        this.toast('info', 'Draft saved — the loop will groom it into a story.');
        return this.refresh();
      case 'spawnLoop':
        this.terminals.spawn(msg.model as Model);
        return;
      case 'recycleLoop':
        this.terminals.recycle(msg.model as Model);
        return;
      case 'stopLoop':
        this.terminals.stop(msg.model as Model);
        return;
      case 'createFiles':
        return this.onCreateFiles();
      case 'openLink':
        if (msg.url) void vscode.env.openExternal(vscode.Uri.parse(String(msg.url)));
        return;
      case 'openBoard':
        this.openBoard();
        return;
      case 'openSettings':
        void vscode.commands.executeCommand('workbench.action.openSettings', 'loopBoard');
        return;
      case 'reveal':
        this.pendingReveal = { taskId: msg.taskId, phase: msg.phase };
        this.openBoard();
        this.flushReveal();
        return;
    }
  }

  private async onCreateFiles(): Promise<void> {
    const tplUri = vscode.Uri.joinPath(this.extensionUri, 'media', 'todo-template.md');
    const todoText = new TextDecoder().decode(await vscode.workspace.fs.readFile(tplUri));
    const doneText = '# DONE\n\nAccepted tasks, newest first.\n';
    const created = await this.store.createInitialFiles(todoText, doneText);
    if (created) {
      void vscode.window.showInformationMessage('LoopBoard: created TODO.md and DONE.md in the workspace root.');
    }
    return this.refresh();
  }

  private async onPatch(patch: FieldPatch): Promise<void> {
    const outcome = await this.store.applyFieldPatch(patch);
    if (outcome.status === 'conflict') {
      this.toast('warning', `Task changed on disk — your edit to ${patch.field} was not applied.`, patch.taskId);
    } else if (outcome.status === 'notfound') {
      this.toast('warning', 'That task no longer exists on disk — the board was refreshed.', patch.taskId);
    }
    return this.refresh();
  }

  private async onGate(taskId: string, action: string): Promise<void> {
    if (action === 'promote') {
      await this.store.promote(taskId, today());
      this.toast('success', 'Promoted to Backlog ✓');
    } else if (action === 'accept') {
      const r = await this.store.acceptToDone(taskId, today());
      if (r.status === 'applied') this.toast('success', 'Accepted — archived to DONE.md ✓');
      else this.toast('warning', 'Could not accept — the task was not found on disk.');
    } else if (action === 'delete') {
      await this.store.deleteTask(taskId);
    }
    return this.refresh();
  }
}
