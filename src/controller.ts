// Wires store + terminals + panel + sidebar. Handles webview messages and refreshes.
import * as vscode from 'vscode';
import { Store } from './store';
import { TerminalManager, isKnownModel } from './terminals';
import { BoardPanel } from './panel';
import { SidebarProvider } from './sidebar';
import { toWebviewBoard, WebBoard } from './view';
import { Model, Board, ResolvedModel, resolveModels, readModelsConfig, BUILTIN_MODEL_IDS } from './model';
import { FieldPatch } from './merge';
import {
  RestartSchedule, LoopAction, armSchedule, delayUntilFire, mayFire, deferSchedule, afterFire,
  describeSchedule, parseMinutes, isLoopAction, supportsForce, appliesTo,
} from './schedule';

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
  // Scheduled loop restarts (t-77d1). SESSION-ONLY BY DESIGN: nothing here is persisted to
  // globalState, workspaceState or `.loopboard/`. The terminals themselves die with the window, so
  // a schedule outliving its terminal would be meaningless — a reload clears every schedule.
  private restartSchedules = new Map<Model, RestartSchedule>();
  private restartTimers = new Map<Model, ReturnType<typeof setTimeout>>();

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
    const loops = this.terminals.status();
    // Decorate each loop row with its armed/pending restart (t-77d1) — recomputed per refresh so
    // the countdown and the "waiting for task" state stay live without extra plumbing.
    const now = Date.now();
    for (const l of loops) {
      const s = this.restartSchedules.get(l.id);
      l.restart = s
        ? { action: s.action, minutes: s.minutes, repeat: s.repeat, force: s.force, pending: s.pending, label: describeSchedule(s, now) }
        : null;
    }
    const web = toWebviewBoard(board, this.store.workspaceName, cfg.defaultWorkerModel, loops, enabledIds, cfg.defaultGroomerModel);
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
    // A deferred restart fires on the same idle signal auto-recycle uses — the freshly loaded board
    // is the only place "is this model busy?" is knowable (terminal output can never be read).
    this.flushPendingRestarts(board);
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

  // ---- scheduled loop restarts (t-77d1) ----

  // Which models currently own an In-Progress task, with an absent `model:` resolved to the default
  // — the same test maybeAutoRecycle uses. This is the ONLY signal for "busy"; terminal output can
  // never be read (CLAUDE.md, src/terminals.ts).
  private inProgressModels(board: Board): Model[] {
    const dflt = this.config().defaultWorkerModel;
    const busy = new Set<Model>();
    for (const t of board.tasks) if (t.phase === 'inprogress') busy.add(t.model ?? dflt);
    return [...busy];
  }

  // Arms (or replaces) a model's schedule and starts its timer. Force consent is taken by the
  // caller, once, BEFORE this runs — fire time is silent.
  private armRestart(model: Model, action: LoopAction, minutes: number, repeat: boolean, force: boolean): void {
    const schedule = armSchedule(model, action, minutes, repeat, force, Date.now());
    // One schedule per model, whichever button armed it: "start in 5m" and "stop in 10m" on the
    // same loop are contradictory, so arming either replaces the other.
    this.restartSchedules.set(model, schedule);
    this.startRestartTimer(schedule);
    this.store.debugLog('info', 'restart-arm', `${model} ${action} in ${minutes}m repeat=${repeat} force=${schedule.force}`);
  }

  private startRestartTimer(schedule: RestartSchedule): void {
    this.clearRestartTimer(schedule.model);
    const timer = setTimeout(() => {
      this.restartTimers.delete(schedule.model);
      this.onRestartDue(schedule.model);
    }, delayUntilFire(schedule, Date.now()));
    this.restartTimers.set(schedule.model, timer);
  }

  private clearRestartTimer(model: Model): void {
    const timer = this.restartTimers.get(model);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.restartTimers.delete(model);
  }

  // Cancels a model's schedule entirely — the popover's Clear button, and stopLoop.
  private cancelRestart(model: Model, reason: string): void {
    if (!this.restartSchedules.has(model)) return;
    this.clearRestartTimer(model);
    this.restartSchedules.delete(model);
    this.store.debugLog('info', 'restart-cancel', `${model} (${reason})`);
  }

  // The timer elapsed. Either restart now, or mark the schedule pending and wait — indefinitely —
  // for the model to go idle. A pending restart is never dropped or expired.
  private onRestartDue(model: Model): void {
    const schedule = this.restartSchedules.get(model);
    if (!schedule) return;
    if (!this.lastBoard || !mayFire(schedule, this.inProgressModels(this.lastBoard))) {
      this.restartSchedules.set(model, deferSchedule(schedule));
      this.store.debugLog('info', 'restart-defer', `${model} — task in progress, waiting for idle`);
      void this.refresh('restart-defer');
      return;
    }
    this.fireRestart(schedule);
  }

  // Performs the action and either re-arms (repeat) or disarms (one-shot). An action that no longer
  // applies to the loop's CURRENT state is swallowed — the schedule still fires (so a one-shot
  // disarms and a repeat keeps its cadence), it just does nothing. A schedule is armed against a
  // state that can change before the timer elapses, and doing something else instead (starting a
  // loop the user has since stopped) would be worse than doing nothing.
  private fireRestart(schedule: RestartSchedule): void {
    const model = schedule.model;
    this.clearRestartTimer(model);
    const running = this.terminals.status().some((l) => l.id === model && l.running);
    if (!appliesTo(schedule.action, running)) {
      this.store.debugLog('info', 'restart-skip', `${model} ${schedule.action} — loop is ${running ? 'already running' : 'not running'}, nothing to do`);
    } else {
      this.store.debugLog('info', 'restart-fire', `${model} ${schedule.action}${schedule.force ? ' (forced — a task may be mid-flight)' : ''}`);
      // preserveFocus: an automatic action must never steal focus from whatever the user is doing —
      // same reasoning as the auto-recycle call above. (stop takes no focus argument.)
      if (schedule.action === 'start') this.terminals.spawn(model, true);
      else if (schedule.action === 'stop') this.terminals.stop(model);
      else this.terminals.recycle(model, true);
    }
    const next = afterFire(schedule, Date.now());
    if (next) {
      this.restartSchedules.set(model, next);
      this.startRestartTimer(next);
    } else {
      this.restartSchedules.delete(model);
    }
    void this.refresh('restart-fire');
  }

  // Called after every board load: any restart that was held back fires as soon as its model has no
  // In-Progress task left.
  private flushPendingRestarts(board: Board): void {
    if (this.restartSchedules.size === 0) return;
    const busy = this.inProgressModels(board);
    for (const schedule of [...this.restartSchedules.values()]) {
      if (schedule.pending && mayFire(schedule, busy)) this.fireRestart(schedule);
    }
  }

  // Arm request from the sidebar popover. Validates in the host too (never trust the webview), and
  // takes force consent ONCE here — a scheduled restart is unattended by definition, so prompting
  // at fire time would either block the restart the user asked for or pop over unrelated work.
  private async onArmRestart(msg: any): Promise<void> {
    if (!isKnownModel(msg.model)) return;
    const model = msg.model as Model;
    // Absent action = the original ♻-only shape; keep restart as the default so an older webview
    // payload still arms what it meant.
    const action: LoopAction = isLoopAction(msg.action) ? msg.action : 'restart';
    const minutes = parseMinutes(String(msg.minutes ?? ''));
    if (minutes === null) {
      this.toast('warning', 'Schedule delay must be a whole number of minutes.');
      return;
    }
    const repeat = !!msg.repeat;
    const force = supportsForce(action) && !!msg.force;
    if (force && !(await this.confirmForcedRestart(model, action))) {
      this.store.debugLog('info', 'gate-cancelled', `restart-force ${model} ${action}`);
      return this.refresh('restart-arm');
    }
    this.armRestart(model, action, minutes, repeat, force);
    const verb = action === 'start' ? 'Starting' : action === 'stop' ? 'Stopping' : 'Restarting';
    this.toast('success', repeat ? `${verb} ${model} every ${minutes}m.` : `${verb} ${model} in ${minutes}m.`, undefined, 'check');
    return this.refresh('restart-arm');
  }

  // Native modal naming the real consequence of a forced restart or stop: the extension never edits
  // a task's `phase:` (the loop writes it), so killing a worker mid-task leaves the task
  // `inprogress` in `.loopboard/TODO.md` with nobody on it — and LOOP.md Rule 2's global
  // single-task limit means that stale entry then blocks EVERY loop from claiming work until a
  // human fixes it. Only reachable for the two actions that can kill a working terminal.
  private async confirmForcedRestart(model: Model, action: LoopAction): Promise<boolean> {
    const verb = action === 'stop' ? 'stop' : 'restart';
    const message = `Force-${verb} ${model} even while it is working on a task?`;
    const confirmLabel = `Arm forced ${verb}`;
    this.store.debugLog('info', 'popup', `confirm — ${message}`);
    const choice = await vscode.window.showWarningMessage(
      message,
      {
        modal: true,
        detail: `A forced ${verb} kills the session mid-task. The task stays \`phase: inprogress\` in the tracker with no worker attached, and under LOOP.md Rule 2 that blocks every loop from claiming new work until you fix it by hand. Confirming now also covers the ${verb} itself — it fires later without asking again.`,
      },
      confirmLabel
    );
    const accepted = choice === confirmLabel;
    this.store.debugLog('info', 'popup-choice', `confirm-force-${verb} ${model} -> ${accepted ? 'accepted' : 'cancelled'}`);
    return accepted;
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
        // Left-click ♻ — restart right now. The scheduling popover is right-click (t-77d1
        // feedback); an armed schedule is left alone, since restarting now says nothing about
        // whether the user still wants the later one.
        if (isKnownModel(msg.model)) this.terminals.recycle(msg.model);
        return;
      case 'stopLoop':
        if (isKnownModel(msg.model)) {
          // Stopping a loop clears any schedule it had — restarting a terminal the user just
          // stopped would be the opposite of what they asked for.
          this.cancelRestart(msg.model, 'loop stopped');
          this.terminals.stop(msg.model);
        }
        return;
      case 'armRestart':
        return this.onArmRestart(msg);
      case 'clearRestart':
        if (isKnownModel(msg.model)) {
          this.cancelRestart(msg.model, 'cleared from the popover');
          return this.refresh('restart-clear');
        }
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
        // `search` is forwarded verbatim and its ABSENCE is meaningful (t-1cdb): undefined means
        // "plain phase navigation — drop the custom view, keep the human's typed filter", while a
        // present string INCLUDING '' installs a view (an empty view suppresses the typed filter so
        // an attention row's tab shows exactly the count it advertises). Never coerce '' away.
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

  // Native VS Code modal guarding a New→Backlog promote, in two cases (Rule 10 only parks Feedback
  // on blank answers, so nothing else stops a half-groomed New story from advancing):
  //   1. Some question is still BLANK — the story was never fully answered (t-oqg1).
  //   2. Every question is answered but the pairs are STILL PRESENT — Rule 14 says a still-present
  //      filled answer means the groomer has not folded it into ## Description yet, so promoting
  //      now ships a story whose description is knowingly stale (t-6936). This case is the more
  //      deceptive one: the card looks finished (full meter, "N / N answered").
  // A story with no questions at all promotes with zero friction. Review→DONE acceptance is
  // intentionally NOT guarded — a Review task has feedback: sub-bullets, not questions.
  // Mirrors the Synchronise Templates precedent above.
  private async confirmPromote(taskId: string): Promise<boolean> {
    const task = this.lastBoard?.tasks.find((t) => t.id === taskId);
    if (!task || task.questions.length === 0) return true;
    const hasUnanswered = task.questions.some((q) => q.answer.trim().length === 0);
    const message = hasUnanswered
      ? 'This story has unanswered questions — promote anyway?'
      : "These answers haven't been folded into the story yet — promote anyway?";
    const detail = hasUnanswered
      ? undefined
      : 'The groomer loop still owes this story a re-groom: it will incorporate the answers into the description and clear the questions. Promoting now hands a worker a description that does not yet contain your decisions.';
    this.store.debugLog('info', 'popup', `confirm — ${message} (${taskId})`);
    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true, detail },
      'Promote anyway'
    );
    const accepted = choice === 'Promote anyway';
    const which = hasUnanswered ? 'unanswered' : 'regroom-pending';
    this.store.debugLog('info', 'popup-choice', `confirm-promote ${which} ${taskId} -> ${accepted ? 'accepted' : 'cancelled'}`);
    return accepted;
  }

  // Native VS Code modal guarding a destructive delete (the sole safety net — deletion is a hard,
  // undoable-only-by-hand removal of source-of-truth markdown). `isDone` = removing an accepted-
  // history row from DONE.md. The task is looked up in the last board for its title/phase.
  private async confirmDelete(taskId: string, isDone: boolean): Promise<boolean> {
    const task = isDone ? undefined : this.lastBoard?.tasks.find((t) => t.id === taskId);
    const entry = isDone ? this.lastBoard?.done.find((t) => t.id === taskId) : task;
    const title = (entry?.title ?? taskId).replace(/^\[x\]\s*/, '');
    let detail: string;
    if (isDone) {
      detail = 'This permanently removes the accepted-history entry from DONE.md (the task file is kept). This cannot be undone.';
    } else if (task?.phase === 'inprogress') {
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
