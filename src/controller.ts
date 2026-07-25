// Wires store + terminals + panel + sidebar. Handles webview messages and refreshes.
import * as vscode from 'vscode';
import { Store } from './store';
import { TerminalManager, isKnownModel } from './terminals';
import { BoardPanel } from './panel';
import { SidebarProvider } from './sidebar';
import { toWebviewBoard, WebBoard } from './view';
import { Model, Board, ModelsConfig, ResolvedModel, resolveModels, BUILTIN_MODEL_IDS } from './model';
import { FieldPatch } from './merge';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export class Controller {
  private lastBoard: Board | undefined;
  private pendingReveal: { taskId?: string; phase?: string; composer?: boolean } | undefined;

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

  private config() {
    const c = vscode.workspace.getConfiguration('loopBoard');
    return {
      permissionMode: c.get<string>('permissionMode', 'auto'),
      interval: c.get<string>('loopInterval', '1m'),
      defaultModel: c.get<Model>('defaultModel', 'opus'),
      autoRecycle: c.get<boolean>('autoRecycle', false),
      clearSessionAfterTask: c.get<boolean>('clearSessionAfterTask', false),
      models: resolveModels(c.get<ModelsConfig>('models')),
    };
  }

  private buildWebBoard(board: Board): WebBoard {
    const cfg = this.config();
    const enabledIds = cfg.models.filter((m: ResolvedModel) => m.enabled).map((m: ResolvedModel) => m.id);
    const web = toWebviewBoard(board, this.store.workspaceName, cfg.defaultModel, this.terminals.status(), enabledIds);
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

  // Returns true if a fresh panel was created (its webview isn't ready to receive posts yet).
  openBoard(): boolean {
    const { panel, created } = BoardPanel.show(this.extensionUri);
    panel.onMessage((msg) => this.handleMessage(msg));
    // The webview sends 'ready' once loaded; that handler posts the board (and flushes any reveal).
    return created;
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
    for (const model of BUILTIN_MODEL_IDS) {
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
    for (const model of BUILTIN_MODEL_IDS) {
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
      case 'createDraft': {
        // Ungroomed drafts carry explicit groomer/model (default when unspecified) so a loop
        // knows unambiguously who grooms and works the story — never left to the implicit default.
        const def = this.config().defaultModel;
        const groomer = String(msg.groomer ?? '') || def;
        const model = String(msg.model ?? '') || def;
        await this.store.createDraft(String(msg.text ?? ''), today(), groomer, model);
        this.toast('info', 'Draft saved — the loop will groom it into a story.');
        return this.refresh();
      }
      case 'spawnLoop':
        if (isKnownModel(msg.model)) this.terminals.spawn(msg.model);
        return;
      case 'recycleLoop':
        if (isKnownModel(msg.model)) this.terminals.recycle(msg.model);
        return;
      case 'stopLoop':
        if (isKnownModel(msg.model)) this.terminals.stop(msg.model);
        return;
      case 'createFiles':
        return this.onCreateFiles();
      case 'syncTemplates':
        return this.onSyncTemplates('Sync to the latest templates?');
      case 'openLink': {
        if (!msg.url) return;
        const uri = vscode.Uri.parse(String(msg.url));
        if (uri.scheme === 'http' || uri.scheme === 'https') void vscode.env.openExternal(uri);
        return;
      }
      case 'openBoard':
        this.openBoard();
        return;
      case 'openSettings':
        void vscode.commands.executeCommand('workbench.action.openSettings', 'loopBoard');
        return;
      case 'reveal':
        this.pendingReveal = { taskId: msg.taskId, phase: msg.phase, composer: !!msg.composer };
        // Flush inline only if the panel already existed (its webview is live). If openBoard just
        // created the panel, the webview's message listener isn't attached yet — posting now would
        // drop the reveal and the board would open on the default tab (the first-click bug). Leave
        // pendingReveal for the webview's `ready` handler, which flushes it after the board is sent.
        if (!this.openBoard()) this.flushReveal();
        return;
    }
  }

  private async readTemplates(): Promise<{ todoText: string; loopText: string }> {
    const read = async (name: string) =>
      new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.extensionUri, 'media', name)));
    return { todoText: await read('template-todo.md'), loopText: await read('template-loop.md') };
  }

  // Scaffold a fresh `.loopboard/` workspace (TODO.md + LOOP.md + tasks/). Wired to both the
  // board's empty-state button (`createFiles` message) and the `loopboard.init` command. When
  // `.loopboard/` already has files, offer the same sync/migrate flow as the explicit button
  // instead of a flat "already exists" toast.
  async onCreateFiles(): Promise<void> {
    const { todoText, loopText } = await this.readTemplates();
    const { created, error } = await this.store.createInitialFiles(todoText, loopText);
    if (created) {
      void vscode.window.showInformationMessage('LoopBoard: initialized .loopboard/ (TODO.md, LOOP.md, tasks/).');
      return this.refresh();
    }
    if (error) {
      void vscode.window.showErrorMessage(`LoopBoard: could not initialize .loopboard/ — ${error}`);
      return this.refresh();
    }
    return this.onSyncTemplates('Workspace already has .loopboard/ files — migrate them to the current format?');
  }

  // Shared sync/migrate flow: preview what's out of date, confirm, then apply. Used by both the
  // sidebar's "Synchronise Templates" button and Init when `.loopboard/` already exists.
  private async onSyncTemplates(confirmPrompt: string): Promise<void> {
    const { todoText, loopText } = await this.readTemplates();
    const preview = await this.store.previewSync(todoText, loopText);
    if (preview.upToDate) {
      void vscode.window.showInformationMessage('LoopBoard: TODO.md and LOOP.md already match the current templates.');
      return this.refresh();
    }
    const choice = await vscode.window.showWarningMessage(
      `${confirmPrompt}\n\n${preview.summary.join('\n')}`,
      { modal: true },
      'Sync'
    );
    if (choice !== 'Sync') return;
    const outcome = await this.store.syncTemplates(todoText, loopText);
    if (outcome.status === 'applied') {
      void vscode.window.showInformationMessage('LoopBoard: synced .loopboard/ to the current templates.');
    } else {
      void vscode.window.showErrorMessage(`LoopBoard: sync failed — ${outcome.message ?? outcome.status}`);
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
      if (!(await this.confirmDelete(taskId, false))) return;
      const r = await this.store.deleteTask(taskId);
      if (r.status === 'notfound') this.toast('warning', 'That task no longer exists on disk — the board was refreshed.', taskId);
    } else if (action === 'deleteDone') {
      if (!(await this.confirmDelete(taskId, true))) return;
      const r = await this.store.deleteDone(taskId);
      if (r.status === 'notfound') this.toast('warning', 'That task no longer exists on disk — the board was refreshed.', taskId);
    }
    return this.refresh();
  }

  // Native VS Code modal guarding a destructive delete (the sole safety net — deletion is a hard,
  // undoable-only-by-hand removal of source-of-truth markdown). `isDone` = removing an accepted-
  // history row from DONE.md. The task is looked up in the last board for its title/phase/owner.
  private async confirmDelete(taskId: string, isDone: boolean): Promise<boolean> {
    const task = isDone ? undefined : this.lastBoard?.tasks.find((t) => t.id === taskId);
    const entry = isDone ? this.lastBoard?.done.find((t) => t.id === taskId) : task;
    const title = (entry?.title ?? taskId).replace(/^\[x\]\s*/, '');
    let detail: string;
    if (isDone) {
      detail = 'This permanently removes the accepted-history entry from DONE.md (the task file is kept). This cannot be undone.';
    } else if (task?.phase === 'inprogress' && task.owner && task.owner !== 'unassigned') {
      detail = 'A loop may be actively working this task. This permanently deletes the task and its task file. This cannot be undone.';
    } else {
      detail = 'This permanently deletes the task and its task file. This cannot be undone.';
    }
    const choice = await vscode.window.showWarningMessage(`Delete “${title}”?`, { modal: true, detail }, 'Delete');
    return choice === 'Delete';
  }
}
