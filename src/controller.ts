// Wires store + terminals + panel + sidebar. Handles webview messages and refreshes.
import * as vscode from 'vscode';
import { Store } from './store';
import { TerminalManager, isKnownModel } from './terminals';
import { BoardPanel } from './panel';
import { SidebarProvider } from './sidebar';
import { toWebviewBoard, WebBoard } from './view';
import { Model, Board, ResolvedModel, resolveModels, readModelsConfig, BUILTIN_MODEL_IDS } from './model';
import { FieldPatch } from './merge';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Single source of truth for the Getting Started docs target — both the first-run popup and the
// sidebar Help button open this URL (t-de8d).
export const HELP_URL = 'https://github.com/SinnConsulting/LoopBoard#get-started';
const GETTING_STARTED_DISMISSED_KEY = 'loopboard.gettingStarted.dismissed';

// The webview can only carry attachment bytes as base64 in a postMessage; decode back to bytes
// here so store.stageAttachment has one raw-bytes entry point regardless of source (drag-drop/
// paste vs. the host-side file picker, which reads bytes directly).
function base64ToBytes(dataBase64: string): Uint8Array {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Read a split default-model enum setting, falling back to the legacy single `loopBoard.defaultModel`
// when the new key was never explicitly set — so pre-split configs keep steering both defaults.
export function readDefaultModel(c: vscode.WorkspaceConfiguration, key: string): Model {
  const explicit = c.inspect<Model>(key);
  const set = explicit?.workspaceFolderValue ?? explicit?.workspaceValue ?? explicit?.globalValue;
  if (set !== undefined) return set;
  const legacy = c.inspect<Model>('defaultModel');
  const legacyVal = legacy?.workspaceFolderValue ?? legacy?.workspaceValue ?? legacy?.globalValue;
  if (legacyVal !== undefined) return legacyVal;
  return c.get<Model>(key, 'opus');
}

export class Controller {
  private lastBoard: Board | undefined;
  private pendingReveal: { taskId?: string; phase?: string; composer?: boolean; search?: string } | undefined;

  constructor(
    private extensionUri: vscode.Uri,
    private store: Store,
    private terminals: TerminalManager,
    private sidebar: SidebarProvider,
    private globalState: vscode.Memento
  ) {
    store.onChange(() => this.refresh('store-change'));
    terminals.onDidChangeStatus(() => this.refresh('terminal-status'));
    sidebar.onMessage((msg) => this.handleMessage(msg));
  }

  private config() {
    const c = vscode.workspace.getConfiguration('loopBoard');
    // config() is a hot helper (called several times per refresh), so the read is logged at
    // verbose — not info — to keep the info trail a readable high-level lifecycle log (t-2901).
    this.store.debugLog('verbose', 'config-read', 'loopBoard');
    return {
      permissionMode: c.get<string>('permissionMode', 'auto'),
      interval: c.get<string>('loopInterval', '1m'),
      defaultWorkerModel: readDefaultModel(c, 'defaultWorkerModel'),
      defaultGroomerModel: readDefaultModel(c, 'defaultGroomerModel'),
      autoRecycle: c.get<boolean>('autoRecycle', false),
      clearSessionAfterTask: c.get<boolean>('clearSessionAfterTask', false),
      maxAttachmentSizeMB: c.get<number>('maxAttachmentSizeMB', 10),
      pulseTemplateSync: c.get<boolean>('pulseTemplateSync', true),
      models: resolveModels(readModelsConfig(<T>(k: string, d: T) => c.get<T>(k, d))),
    };
  }

  private async buildWebBoard(board: Board): Promise<WebBoard> {
    const cfg = this.config();
    const enabledIds = cfg.models.filter((m: ResolvedModel) => m.enabled).map((m: ResolvedModel) => m.id);
    const web = toWebviewBoard(board, this.store.workspaceName, cfg.defaultWorkerModel, this.terminals.status(), enabledIds, cfg.defaultGroomerModel);
    web.todoMissing = this.store.todoMissing;
    web.helpUrl = HELP_URL;
    web.maxAttachmentSizeMB = cfg.maxAttachmentSizeMB;
    // Recomputed on every refresh (and again right after a sync click via the refresh() it
    // triggers) so the pulse reflects live disk state rather than a cached snapshot (t-pul1).
    if (cfg.pulseTemplateSync && !this.store.todoMissing) {
      const { todoText, loopText } = await this.readTemplates();
      const preview = await this.store.previewSync(todoText, loopText);
      web.templatesOutOfDate = !preview.upToDate;
      this.store.debugLog('verbose', 'template-preview', preview.upToDate ? 'upToDate' : 'stale');
    }
    return web;
  }

  // `trigger` is the natural anchor for "what caused this repaint" (t-0143) — high-frequency, so
  // verbose only; most message-handler-triggered refreshes use the default rather than threading
  // a distinct label through every call site.
  async refresh(trigger = 'message'): Promise<void> {
    this.store.debugLog('verbose', 'refresh', trigger);
    const board = await this.store.load();
    this.maybeAutoRecycle(this.lastBoard, board);
    this.maybeClearSession(this.lastBoard, board);
    this.lastBoard = board;
    const web = await this.buildWebBoard(board);
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
      b.tasks.filter((t) => t.phase === 'inprogress' && (t.model ?? this.config().defaultWorkerModel) === model).length;
    for (const model of BUILTIN_MODEL_IDS) {
      const before = inProgressBy(prev, model);
      const after = inProgressBy(next, model);
      if (before > 0 && after === 0) {
        // Automatic lifecycle recycle — never steal focus from whatever the user is doing on the
        // board (e.g. typing in an answer field).
        this.store.debugLog('info', 'auto-recycle', model);
        this.terminals.recycle(model, true);
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
      b.tasks.filter((t) => t.phase === 'inprogress' && (t.model ?? cfg.defaultWorkerModel) === model).length;
    for (const model of BUILTIN_MODEL_IDS) {
      const before = inProgressBy(prev, model);
      const after = inProgressBy(next, model);
      if (before > 0 && after === 0) {
        this.store.debugLog('info', 'clear-session', model);
        this.terminals.clearSession(model);
      }
    }
  }

  // Every toast is captured here so it survives past the webview (t-0143) — warnings are what
  // matter in a bug report, so they log at info; routine success/info toasts stay verbose-only.
  private toast(level: 'info' | 'success' | 'warning', text: string, taskId?: string, icon?: string): void {
    this.store.debugLog(level === 'warning' ? 'info' : 'verbose', 'toast', `${level}${taskId ? ' ' + taskId : ''} — ${text}`);
    BoardPanel.current?.post({ type: 'toast', level, text, taskId, icon });
  }

  async handleMessage(msg: any): Promise<void> {
    this.store.debugLog('verbose', 'dispatch', String(msg?.type ?? '?'));
    switch (msg?.type) {
      case 'ready':
        if (this.lastBoard) {
          const web = await this.buildWebBoard(this.lastBoard);
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
        const cfg = this.config();
        const groomer = String(msg.groomer ?? '') || cfg.defaultGroomerModel;
        const model = String(msg.model ?? '') || cfg.defaultWorkerModel;
        await this.store.createDraft(String(msg.text ?? ''), today(), groomer, model);
        this.toast('info', 'Draft saved — the loop will groom it into a story.');
        return this.refresh();
      }
      case 'createDraftWithAttach': {
        // The New Story composer has no task id until a draft exists (t-att1 rework: pasted/
        // dropped images are held pending in the webview — never auto-saved — and ride the
        // Save Draft commit as an `attachments` array, staged onto the fresh draft here).
        const text = String(msg.text ?? '').trim();
        const attachments: unknown[] = Array.isArray(msg.attachments) ? msg.attachments : [];
        if (!text) return;
        const cfg = this.config();
        const groomer = String(msg.groomer ?? '') || cfg.defaultGroomerModel;
        const model = String(msg.model ?? '') || cfg.defaultWorkerModel;
        const draft = await this.store.createDraft(text, today(), groomer, model);
        if (draft.id) {
          // Stage bytes only (no auto-append) and then resolve the composer's caret-inserted
          // `[name](loopboard-pending:<n>)` placeholders to the real staged cache paths.
          const staged: { token: string; name: string; path: string }[] = [];
          const removedTokens: string[] = [];
          for (const a of attachments as { filename?: unknown; dataBase64?: unknown; token?: unknown }[]) {
            const filename = String(a?.filename ?? '');
            if (!filename || typeof a?.dataBase64 !== 'string') continue;
            const result = await this.store.stageAttachment(draft.id, filename, base64ToBytes(a.dataBase64), cfg.maxAttachmentSizeMB * 1024 * 1024, false);
            if (result.status === 'error') {
              this.toast('warning', result.message ?? 'Could not attach that file.', draft.id);
              const token = String(a?.token ?? '');
              if (token) removedTokens.push(token);
            } else if (result.path) staged.push({ token: String(a?.token ?? ''), name: result.path.split('/').pop() ?? filename, path: result.path });
          }
          await this.store.resolvePendingLinks(draft.id, staged, removedTokens);
        }
        this.toast('info', 'Draft saved — the loop will groom it into a story.');
        return this.refresh();
      }
      case 'spawnLoop':
        if (isKnownModel(msg.model)) this.terminals.spawn(msg.model);
        return;
      case 'revealTerminal':
        if (isKnownModel(msg.model)) this.terminals.reveal(msg.model);
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
        const url = String(msg.url);
        const uri = vscode.Uri.parse(url);
        if (url.startsWith('.loopboard/')) {
          // A staged attachment link (t-att1): relative to the workspace root, not a URL.
          void vscode.commands.executeCommand('vscode.open', this.store.resolveWorkspacePath(url));
        } else if (uri.scheme) {
          // Hand any absolute URI to the OS default handler for its scheme — not just
          // http(s) — so custom schemes like `tool://<ticketId>` (t-adf2) are honestly forwarded
          // rather than silently dropped. openExternal resolves false when no handler is
          // registered for the scheme; surface that instead of failing silently.
          void vscode.env.openExternal(uri).then((opened) => {
            if (!opened) this.toast('info', `No handler for ${uri.scheme}:// links.`);
          });
        }
        return;
      }
      case 'attach': {
        // t-att1 (any file type since t-058e), drag-drop/paste only (no file-picker button). A
        // whole-card drop (no `field`) appends straight to the task's Description, same as
        // before. A drop/paste scoped to an already-open Description, answer, feedback, or note
        // field (`field` set, keyed by `reqId`) only stages the bytes here — the webview folds
        // the returned link into that field's own draft value and saves it through the normal
        // field-patch path, so it lands in the right place instead of always the Description.
        const taskId = String(msg.taskId ?? '');
        const filename = String(msg.filename ?? '');
        if (!taskId || !filename || typeof msg.dataBase64 !== 'string') return;
        const field = msg.field === 'description' || msg.field === 'answer' || msg.field === 'title' || msg.field === 'feedback' || msg.field === 'note' ? msg.field : undefined;
        const result = await this.store.stageAttachment(
          taskId, filename, base64ToBytes(msg.dataBase64), this.config().maxAttachmentSizeMB * 1024 * 1024, !field
        );
        if (msg.reqId) {
          // Field-scoped: the webview folds the link into the field's draft value, no refresh
          // here. Whole-card: the webview mirrors the append locally for an immediate repaint
          // (`description` carries the store's authoritative post-append text), but still
          // refresh so deferred board state reconciles with disk.
          BoardPanel.current?.post({ type: 'attachStaged', reqId: msg.reqId, status: result.status, path: result.path, filename, message: result.message, description: result.description, title: result.title });
          if (field) return;
          return this.refresh();
        }
        if (result.status === 'error') this.toast('warning', result.message ?? 'Could not attach that file.', taskId);
        else if (result.status === 'notfound') this.toast('warning', 'That task no longer exists on disk — the board was refreshed.', taskId);
        return this.refresh();
      }
      case 'detach': {
        // t-att1 rework: the attachments area's × — delete the staged file and strip its markdown
        // link from the story's Description in one store-owned step, then mirror the result back
        // (same reply pattern as attachStaged) so the card repaints while a field is focused.
        const taskId = String(msg.taskId ?? '');
        const relPath = String(msg.path ?? '');
        if (!taskId || !relPath) return;
        const result = await this.store.removeAttachment(taskId, relPath);
        if (msg.reqId) {
          BoardPanel.current?.post({ type: 'attachRemoved', reqId: msg.reqId, status: result.status, message: result.message, description: result.description, title: result.title });
        } else if (result.status === 'error') {
          this.toast('warning', result.message ?? 'Could not delete that attachment.', taskId);
        }
        return this.refresh();
      }
      case 'openBoard':
        this.openBoard();
        return;
      case 'openSettings':
        void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:SinnConsulting.loopboard-todo');
        return;
      case 'reveal':
        this.pendingReveal = { taskId: msg.taskId, phase: msg.phase, composer: !!msg.composer, search: msg.search };
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

  // Run once on activation: recreate a missing/empty TODO.md or LOOP.md against an existing
  // `.loopboard/` with no user click needed. Create-only — never touches a non-empty file.
  async autoHeal(): Promise<void> {
    const { todoText, loopText } = await this.readTemplates();
    await this.store.autoHeal(todoText, loopText);
  }

  // First-run (and every subsequent activation) Getting Started prompt, gated on a globalState
  // flag that only "Show never again" sets — dismissing or opening the docs leaves it unset so
  // the popup reappears next activation (t-de8d).
  async maybeShowGettingStarted(): Promise<void> {
    if (this.globalState.get<boolean>(GETTING_STARTED_DISMISSED_KEY)) return;
    this.store.debugLog('info', 'popup', 'info — LoopBoard: new here? Check out the Getting Started guide.');
    const choice = await vscode.window.showInformationMessage(
      'LoopBoard: new here? Check out the Getting Started guide.',
      'Open Getting Started',
      'Show never again'
    );
    this.store.debugLog('info', 'popup-choice', `getting-started -> ${choice ?? 'dismissed'}`);
    if (choice === 'Open Getting Started') {
      void vscode.env.openExternal(vscode.Uri.parse(HELP_URL));
    } else if (choice === 'Show never again') {
      void this.globalState.update(GETTING_STARTED_DISMISSED_KEY, true);
    }
  }

  // Scaffold a fresh `.loopboard/` workspace (TODO.md + LOOP.md + tasks/). Wired to both the
  // board's empty-state button (`createFiles` message) and the `loopboard.init` command. When
  // `.loopboard/` already has files, offer the same sync/migrate flow as the explicit button
  // instead of a flat "already exists" toast.
  async onCreateFiles(): Promise<void> {
    const { todoText, loopText } = await this.readTemplates();
    const { created, error } = await this.store.createInitialFiles(todoText, loopText);
    if (created) {
      this.store.debugLog('info', 'popup', 'info — LoopBoard: initialized .loopboard/ (TODO.md, LOOP.md, tasks/).');
      void vscode.window.showInformationMessage('LoopBoard: initialized .loopboard/ (TODO.md, LOOP.md, tasks/).');
      return this.refresh();
    }
    if (error) {
      this.store.debugLog('info', 'popup', `error — LoopBoard: could not initialize .loopboard/ — ${error}`);
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
      this.store.debugLog('info', 'popup', 'info — LoopBoard: TODO.md and LOOP.md already match the current templates.');
      void vscode.window.showInformationMessage('LoopBoard: TODO.md and LOOP.md already match the current templates.');
      return this.refresh();
    }
    this.store.debugLog('info', 'popup', `confirm — ${confirmPrompt}`);
    const choice = await vscode.window.showWarningMessage(
      `${confirmPrompt}\n\n${preview.summary.join('\n')}`,
      { modal: true },
      'Sync'
    );
    this.store.debugLog('info', 'popup-choice', `sync-templates -> ${choice ?? 'cancelled'}`);
    if (choice !== 'Sync') return;
    const outcome = await this.store.syncTemplates(todoText, loopText);
    if (outcome.status === 'applied') {
      this.store.debugLog('info', 'popup', 'info — LoopBoard: synced .loopboard/ to the current templates.');
      void vscode.window.showInformationMessage('LoopBoard: synced .loopboard/ to the current templates.');
    } else {
      this.store.debugLog('info', 'popup', `error — LoopBoard: sync failed — ${outcome.message ?? outcome.status}`);
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
    // Logged before the confirm gate (if any) so a cancelled promote/delete still leaves a
    // trace — previously a click that a modal aborted produced zero log output (t-0143).
    this.store.debugLog('info', 'gate-request', `${action} ${taskId}`);
    if (action === 'promote') {
      if (await this.confirmPromote(taskId)) {
        await this.store.promote(taskId, today());
        this.toast('success', 'Promoted to Backlog', undefined, 'check');
      } else {
        this.store.debugLog('info', 'gate-cancelled', `promote ${taskId}`);
      }
      // Cancel falls through to the refresh() below, which restores the card the board
      // optimistically faded on click (board.js:473) — unlike confirmDelete, which never fades.
    } else if (action === 'accept') {
      const r = await this.store.acceptToDone(taskId, today());
      if (r.status === 'applied') this.toast('success', 'Accepted — archived to DONE.md', undefined, 'check');
      else this.toast('warning', 'Could not accept — the task was not found on disk.');
    } else if (action === 'demote') {
      const r = await this.store.demote(taskId, today());
      if (r.status === 'conflict') this.toast('warning', 'Task is no longer in Backlog — the board was refreshed.', taskId);
      else if (r.status === 'notfound') this.toast('warning', 'That task no longer exists on disk — the board was refreshed.', taskId);
      else this.toast('success', 'Demoted to New', undefined, 'check');
    } else if (action === 'delete') {
      if (!(await this.confirmDelete(taskId, false))) { this.store.debugLog('info', 'gate-cancelled', `delete ${taskId}`); return; }
      const r = await this.store.deleteTask(taskId);
      if (r.status === 'notfound') this.toast('warning', 'That task no longer exists on disk — the board was refreshed.', taskId);
    } else if (action === 'deleteDone') {
      if (!(await this.confirmDelete(taskId, true))) { this.store.debugLog('info', 'gate-cancelled', `deleteDone ${taskId}`); return; }
      const r = await this.store.deleteDone(taskId);
      if (r.status === 'notfound') this.toast('warning', 'That task no longer exists on disk — the board was refreshed.', taskId);
    }
    return this.refresh();
  }

  // Native VS Code modal guarding a New→Backlog promote when the story still has one or more
  // unanswered questions (Rule 10 only parks Feedback on blank answers, so nothing else stops a
  // half-groomed New story from advancing). Mirrors the Synchronise Templates precedent above.
  // Review→DONE acceptance is intentionally NOT guarded — a Review task has feedback: sub-bullets,
  // not questions.
  private async confirmPromote(taskId: string): Promise<boolean> {
    const task = this.lastBoard?.tasks.find((t) => t.id === taskId);
    const hasUnanswered = !!task && task.questions.some((q) => q.answer.trim().length === 0);
    if (!hasUnanswered) return true;
    this.store.debugLog('info', 'popup', `confirm — This story has unanswered questions — promote anyway? (${taskId})`);
    const choice = await vscode.window.showWarningMessage(
      'This story has unanswered questions — promote anyway?',
      { modal: true },
      'Promote anyway'
    );
    const accepted = choice === 'Promote anyway';
    this.store.debugLog('info', 'popup-choice', `confirm-promote ${taskId} -> ${accepted ? 'accepted' : 'cancelled'}`);
    return accepted;
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
    this.store.debugLog('info', 'popup', `confirm — Delete "${title}"? (${taskId})`);
    const choice = await vscode.window.showWarningMessage(`Delete “${title}”?`, { modal: true, detail }, 'Delete');
    const accepted = choice === 'Delete';
    this.store.debugLog('info', 'popup-choice', `confirm-delete ${taskId} -> ${accepted ? 'accepted' : 'cancelled'}`);
    return accepted;
  }
}
