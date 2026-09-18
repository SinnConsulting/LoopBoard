// Wires store + terminals + panel + sidebar. Handles webview messages and refreshes.
import * as vscode from 'vscode';
import { Store } from './store';
import { TerminalManager, isKnownModel } from './terminals';
import { BoardPanel } from './panel';
import { SettingsPanel } from './settingspanel';
import { SidebarProvider } from './sidebar';
import { toWebviewBoard, WebBoard } from './view';
import {
  Model, Board, ResolvedModel, resolveModels, readModelsConfig, BUILTIN_MODEL_IDS,
  AfterTask, resolveAfterTask,
} from './model';
import {
  ManifestSection, ValueMap, buildSettingsForm, findControl, formKeys, toConfigPatch, resetPatch,
  ConfigPatch, MODEL_GRID_KEYS, SETTINGS_PREFIX,
} from './settingsform';
import { buildModelGrid, gridPatch } from './settingsgrid';
import { MigrationPlan, SettingValues, actionWrites, buildMigrationPlan, scanKeys } from './settingsmigrate';
import { FieldPatch } from './merge';
import {
  RestartSchedule, LoopAction, armSchedule, delayUntilFire, mayFire, deferSchedule, afterFire,
  describeSchedule, parseMinutes, isLoopAction, supportsForce, appliesTo,
} from './schedule';
import { computeNudges, formatNudge, mergeNudgeItems, NudgeItem } from './nudge';
import { ContextReader, ContextReading } from './contextreader';
import { AgentRow, describeAgent } from './subagents';
import { ContextAction, describeContext, describeThreshold, isStaleSession, sanitizeContextAction, sanitizeContextPercent, shouldClearTrip, shouldTrip } from './context';

// How often each running loop's transcript is re-measured (t-2b89). A stat() short-circuits every
// poll whose transcript has not grown, so this is cheap; it only has to be fast enough that the
// row's number tracks a conversation, not every token.
const CONTEXT_POLL_MS = 30000;

// `loopBoard.afterTask` (t-1f1e) with a read-both fallback to the deprecated boolean pair. The
// default in package.json is 'none', so `get()` alone could never tell "unset" from "explicitly
// none" — hence `inspect()`, which reports only values a user actually set.
function readAfterTask(c: vscode.WorkspaceConfiguration): AfterTask {
  const i = c.inspect<string>('afterTask');
  const set = i?.workspaceFolderValue ?? i?.workspaceValue ?? i?.globalValue;
  return resolveAfterTask(
    set,
    c.get<boolean>('autoRecycle', false),
    c.get<boolean>('clearSessionAfterTask', false),
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Single source of truth for the Getting Started docs target — both the first-run popup and the
// sidebar Help button open this URL (t-de8d).
export const HELP_URL = 'https://github.com/SinnConsulting/LoopBoard#get-started';

// LoopBoard's own id, used twice: to read its own `contributes.configuration` back at runtime (so
// the settings page is drawn FROM the manifest and can never drift from it) and as the filter for
// the native Settings editor the page keeps as an escape hatch.
export const EXTENSION_ID = 'SinnConsulting.loopboard-todo';
export const NATIVE_SETTINGS_FILTER = `@ext:${EXTENSION_ID}`;

const GETTING_STARTED_DISMISSED_KEY = 'loopboard.gettingStarted.dismissed';
// DEAD KEY, kept only to be deleted. An earlier build of the migration panel could not remove
// `loopBoard.delegateWork.review` (it is unreadable behind its scalar parent) and instead asked the
// user to confirm they had dealt with it by hand, remembering that here. The removal turned out to
// be possible after all — reading and writing are different code paths in VSCode, see
// src/settingsmigrate.ts — so the advisory, the button and the claim are all gone. Every
// activation clears the leftover so an existing install does not carry it forever.
const DEAD_MIGRATE_ACK_KEY = 'loopboard.settingsMigrate.acknowledged';

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
  // Nudges routed to a model whose loop terminal is not running (t-068e): held here and delivered
  // on the next refresh that finds a terminal — a spawn/recycle fires onDidChangeStatus, which
  // refreshes. Session-only for the same reason the restart schedules are: the terminals die with
  // the window. Held items merge and de-duplicate, so a model that stays down for ten board edits
  // gets ONE line naming each task once, not ten lines.
  private pendingNudges = new Map<Model, NudgeItem[]>();
  // Context-usage state (t-2b89) — session-only, like the schedules above. `contextUsage` is the
  // last measurement per slot (absent = nothing to show); `contextTripped` remembers WHICH session
  // already tripped the threshold, so a loop sitting above it is restarted once, not every poll;
  // `contextPending` holds a trip whose slot owns the In-Progress task. Deliberately NOT an entry
  // in `restartSchedules`: a timed schedule (t-77d1) and a context trip are independent mechanisms
  // that coexist on the same loop — neither replaces or suppresses the other.
  private contextUsage = new Map<Model, ContextReading>();
  private contextTripped = new Map<Model, string>();
  private contextPending = new Set<Model>();
  // The session id this slot's last restart ENDED (t-c7a2). Every restart path wipes the three
  // maps above, including the `contextTripped` marker that would have suppressed a re-read of the
  // dead session — so the one fact worth keeping is the id we just killed. A reading still carrying
  // it is the old file's echo and is dropped whole (`isStaleSession`), before the threshold is even
  // looked at. Released only by a reading with a DIFFERENT id, never by ■ or ▶: a ▶ after ■ starts
  // a new process with a new id, so the guard is inert there and still covers the same race.
  private contextEnded = new Map<Model, string>();
  // Live subagents per slot (t-sbag), filled by the same poll as `contextUsage`. `agentBusy` is the
  // SECOND busy signal next to the tracker's In-Progress task: a loop whose session still has an
  // Agent-tool subagent working is not idle, however idle `.loopboard/` looks (grooming never sets
  // `phase: inprogress`). `agentRows` is what the sidebar's Agents section draws and what the debug
  // log names a held-back restart with. `afterTaskPending` is the afterTask recycle/clear held at
  // the idle edge because a subagent was still running — the same shape as `contextPending`.
  private agentBusy = new Set<Model>();
  private agentRows = new Map<Model, AgentRow[]>();
  private afterTaskPending = new Set<Model>();
  private contextTimer: ReturnType<typeof setInterval> | undefined;
  // Guards against overlapping polls: the interval and every refresh both trigger one, and each
  // awaits file IO.
  private contextPolling = false;

  constructor(
    private extensionUri: vscode.Uri,
    private store: Store,
    private terminals: TerminalManager,
    private sidebar: SidebarProvider,
    private globalState: vscode.Memento,
    private contextReader?: ContextReader
  ) {
    store.onChange(() => this.refresh('store-change'));
    terminals.onDidChangeStatus(() => this.refresh('terminal-status'));
    sidebar.onMessage((msg) => this.handleMessage(msg));
    if (contextReader) {
      this.contextTimer = setInterval(() => void this.pollContext(), CONTEXT_POLL_MS);
      void this.pollContext();
    }
  }

  dispose(): void {
    if (this.contextTimer !== undefined) clearInterval(this.contextTimer);
    for (const model of [...this.restartTimers.keys()]) this.clearRestartTimer(model);
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
      afterTask: readAfterTask(c),
      maxAttachmentSizeMB: c.get<number>('maxAttachmentSizeMB', 10),
      pulseTemplateSync: c.get<boolean>('pulseTemplateSync', true),
      nudgeLoops: c.get<boolean>('nudgeLoops', true),
      // 0 (the default) = the context threshold is off entirely; the indicator still renders.
      contextPercent: sanitizeContextPercent(c.get<number>('contextLimit.percent', 0)),
      contextAction: sanitizeContextAction(c.get<string>('contextLimit.action', 'recycle')),
      models: resolveModels(readModelsConfig(<T>(k: string, d: T) => c.get<T>(k, d))),
    };
  }

  // `reuseTemplateState` skips the template-sync preview and reuses the last computed answer. The
  // context poll repaints every 30s for as long as any loop runs, and re-reading + diffing TODO.md,
  // LOOP.md and both bundled templates that often — plus a `template-preview` log line each time —
  // is pure churn: nothing the poll changes can affect whether the templates are stale (t-2b89
  // review). Only a real refresh (which re-reads disk anyway) recomputes it.
  private lastTemplatesOutOfDate = false;

  private async buildWebBoard(board: Board, reuseTemplateState = false): Promise<WebBoard> {
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
      // Context bar (t-2b89): only for a running loop we actually measured — no measurement means
      // no row content at all, never a "0%".
      const u = l.running ? this.contextUsage.get(l.id) : undefined;
      const pending = this.contextPending.has(l.id);
      const threshold = cfg.contextPercent;
      const thresholdLabel = describeThreshold(threshold, cfg.contextAction);
      l.context = u
        ? { used: u.used, window: u.window, percent: u.percent, pending, label: describeContext(u.used, u.window, pending), threshold, thresholdLabel }
        // A deferred trip must stay visible even with no reading to draw a bar from, or the row
        // silently says nothing while a restart is queued behind the In-Progress task.
        : pending && l.running
          ? { used: 0, window: 0, percent: 0, pending, label: 'restart waiting for task', threshold, thresholdLabel }
          : null;
      // Live subagents (t-sbag): rendered per repaint so each row's duration ticks between the
      // 30 s polls. A stopped loop has no session and therefore no agents.
      l.agents = (l.running ? this.agentRows.get(l.id) ?? [] : []).map((r) => describeAgent(r, now));
    }
    const web = toWebviewBoard(board, this.store.workspaceName, cfg.defaultWorkerModel, loops, enabledIds, cfg.defaultGroomerModel);
    web.todoMissing = this.store.todoMissing;
    web.helpUrl = HELP_URL;
    web.maxAttachmentSizeMB = cfg.maxAttachmentSizeMB;
    // Recomputed on every refresh (and again right after a sync click via the refresh() it
    // triggers) so the pulse reflects live disk state rather than a cached snapshot (t-pul1).
    if (cfg.pulseTemplateSync && !this.store.todoMissing) {
      if (reuseTemplateState) {
        web.templatesOutOfDate = this.lastTemplatesOutOfDate;
      } else {
        const { todoText, loopText } = await this.readTemplates();
        const preview = await this.store.previewSync(todoText, loopText);
        web.templatesOutOfDate = !preview.upToDate;
        this.lastTemplatesOutOfDate = web.templatesOutOfDate;
        this.store.debugLog('verbose', 'template-preview', preview.upToDate ? 'upToDate' : 'stale');
      }
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
    this.maybeNudge(this.lastBoard, board);
    this.lastBoard = board;
    // A deferred restart fires on the same idle signal auto-recycle uses — the freshly loaded board
    // is the only place "is this model busy?" is knowable (terminal output can never be read).
    this.flushPendingRestarts(board);
    this.flushPendingContext(board);
    this.flushAfterTask(board);
    // Re-measure on every refresh as well as on the interval (t-2b89 review feedback): a loop's
    // turn ends by writing `.loopboard/` markdown, which is exactly what triggers a refresh — so
    // the bar tracks the conversation instead of trailing it by up to a poll. Cheap: each read is
    // stat-gated, and this never awaits the repaint below.
    void this.pollContext();
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

  // Steering (t-068e): route each CHANGED task to the one loop that now has something to do and
  // paste a line naming it into that loop's terminal. The nudge SUPPLEMENTS the every-pass board
  // re-read, which stays the source of truth — a nudge that is never delivered costs correctness
  // nothing, so nothing here throws, retries or blocks a refresh.
  private maybeNudge(prev: Board | undefined, next: Board): void {
    const cfg = this.config();
    if (!cfg.nudgeLoops) return;
    const routes = computeNudges(prev?.tasks, next.tasks, {
      worker: cfg.defaultWorkerModel,
      groomer: cfg.defaultGroomerModel,
    });
    for (const route of routes) {
      const held = this.pendingNudges.get(route.model) ?? [];
      // De-duplicate on task id: a task edited twice while its loop was down is named once, with
      // the newest reason and the UNION of its change descriptors (pure helper, unit-tested).
      this.pendingNudges.set(route.model, mergeNudgeItems(held, route.items));
      this.store.debugLog('verbose', 'nudge-route', `${route.model} <- ${route.items.map((i) => `${i.taskId}:${i.reason}`).join(',')}`);
    }
    for (const [model, items] of [...this.pendingNudges]) {
      if (this.terminals.nudge(model, formatNudge(items))) this.pendingNudges.delete(model);
      else this.store.debugLog('verbose', 'nudge-hold', `${model} — no terminal, ${items.length} task(s) held for next spawn`);
    }
  }

  // Auto-recycle: when a model's task leaves In Progress and it has none left, recycle its terminal.
  private maybeAutoRecycle(prev: Board | undefined, next: Board): void {
    if (!prev || this.config().afterTask !== 'recycle') return;
    const inProgressBy = (b: Board, model: Model): number =>
      b.tasks.filter((t) => t.phase === 'inprogress' && (t.model ?? this.config().defaultWorkerModel) === model).length;
    const busy = this.busyModels(next);
    for (const model of BUILTIN_MODEL_IDS) {
      const before = inProgressBy(prev, model);
      const after = inProgressBy(next, model);
      if (before > 0 && after === 0) {
        // The task is done but the session may not be (t-sbag): a subagent it spawned can still be
        // mid-edit, and recycling now kills it. Hold exactly like a deferred schedule does.
        if (busy.includes(model)) {
          this.holdAfterTask(model, next);
          continue;
        }
        // Automatic lifecycle recycle — never steal focus from whatever the user is doing on the
        // board (e.g. typing in an answer field).
        this.store.debugLog('info', 'auto-recycle', model);
        this.clearContextTrip(model, 'auto-recycle');
        this.terminals.recycle(model, true);
      }
    }
  }

  // Clear-after-task: when a model's task leaves In Progress and it has none left, send /clear to its
  // terminal to reset the conversation context (terminal stays open). Runs after store.load() has
  // re-read the just-written TODO.md, so the tracker is persisted before we clear. The 'recycle'
  // mode never reaches here — the modes are exclusive by construction now, where the old boolean
  // pair needed an explicit skip.
  private maybeClearSession(prev: Board | undefined, next: Board): void {
    const cfg = this.config();
    if (!prev || cfg.afterTask !== 'clear') return;
    const inProgressBy = (b: Board, model: Model): number =>
      b.tasks.filter((t) => t.phase === 'inprogress' && (t.model ?? cfg.defaultWorkerModel) === model).length;
    const busy = this.busyModels(next);
    for (const model of BUILTIN_MODEL_IDS) {
      const before = inProgressBy(prev, model);
      const after = inProgressBy(next, model);
      if (before > 0 && after === 0) {
        // Same hold as auto-recycle (t-sbag): `/clear` throws away the context a live subagent's
        // parent session is still working in.
        if (busy.includes(model)) {
          this.holdAfterTask(model, next);
          continue;
        }
        this.store.debugLog('info', 'clear-session', model);
        this.clearContextTrip(model, 'clear-session');
        this.terminals.clearSession(model);
      }
    }
  }

  // ---- afterTask held by a live subagent (t-sbag) ----

  // Records the hold. Idempotent: at most one afterTask action is ever pending per model, exactly
  // like a deferred schedule, and it waits indefinitely.
  private holdAfterTask(model: Model, board: Board): void {
    this.afterTaskPending.add(model);
    this.store.debugLog('info', 'aftertask-defer', `${model} — ${this.describeBusy(model, board)}, waiting for idle`);
  }

  // The held recycle/clear fires on the same idle edge deferred schedules watch — which, for a
  // subagent, is a poll rather than a board write (a finishing subagent touches no `.loopboard/`
  // file). The MODE is re-read here instead of remembered: what is configured now is what should
  // happen now, and `none` simply drops the hold.
  private flushAfterTask(board: Board): void {
    if (this.afterTaskPending.size === 0) return;
    const busy = this.busyModels(board);
    const mode = this.config().afterTask;
    for (const model of [...this.afterTaskPending]) {
      if (busy.includes(model)) continue;
      this.afterTaskPending.delete(model);
      if (mode === 'none') {
        this.store.debugLog('info', 'aftertask-skip', `${model} — afterTask is off now, nothing to do`);
        continue;
      }
      this.store.debugLog('info', mode === 'clear' ? 'clear-session' : 'auto-recycle', `${model} (held for a live subagent)`);
      this.clearContextTrip(model, mode === 'clear' ? 'clear-session' : 'auto-recycle');
      if (mode === 'clear') this.terminals.clearSession(model);
      else this.terminals.recycle(model, true);
    }
  }

  // ---- context-usage indicator + threshold restart (t-2b89) ----

  // Re-measure every running slot, then act on anything that crossed the threshold. Nothing here
  // ever throws: a slot with no session file or no readable transcript simply loses its reading.
  private async pollContext(): Promise<void> {
    if (!this.contextReader || this.contextPolling) return;
    this.contextPolling = true;
    try {
      await this.pollContextOnce();
    } finally {
      this.contextPolling = false;
    }
  }

  private async pollContextOnce(): Promise<void> {
    if (!this.contextReader) return;
    const cfg = this.config();
    let changed = false;
    // A subagent finishing writes nothing to `.loopboard/`, so nothing refreshes the board and the
    // deferral flushes that run there never happen. This poll is the ONLY place that edge is
    // visible — hence the flush pair (plus the afterTask hold) runs here too whenever the busy set
    // actually moved (t-sbag).
    let busyChanged = false;
    for (const m of cfg.models) {
      if (!m.enabled) continue;
      if (!this.terminals.status().some((l) => l.id === m.id && l.running)) {
        // A stopped loop has no context to report and no trip to remember — but its session id is
        // still worth keeping (t-c7a2): this branch runs on the close-event poll during a
        // recycle's 400 ms gap, and wiping `contextTripped` here is exactly what let the reopen
        // poll re-trip on the identical reading it had just acted on.
        changed = this.contextUsage.has(m.id) || changed;
        this.rememberEndedSession(m.id);
        this.contextTripped.delete(m.id);
        this.contextPending.delete(m.id);
        // A stopped loop's session is gone, and with it every subagent it owned.
        if (this.forgetAgents(m.id)) {
          changed = true;
          busyChanged = true;
        }
        continue;
      }
      // Read the subagents FIRST: the context read below has several early exits, and the busy
      // signal must be refreshed on every poll regardless of whether a measurement came back.
      if (await this.pollSubagents(m.id)) {
        changed = true;
        busyChanged = true;
      }
      const reading = await this.contextReader.read(m.id, m.model);
      if (!reading) {
        // Keep the last reading: a transient miss (transcript mid-write, EBUSY) must not blank the
        // bar and lose a pending trip's label. A stopped loop is cleared above, which is the only
        // case that genuinely has nothing to show.
        continue;
      }
      // The ended session's echo (t-c7a2): the new `claude` has not written its session file yet,
      // so the reader still resolves the id we just killed and its transcript still reads at the
      // pre-restart number. Drop the reading WHOLE — it is not stored (so the row shows no bar,
      // today's "no measurement" rendering, rather than a stale one), not compared against the
      // threshold and cannot trip. The hysteresis below keeps its meaning for the NEW session; this
      // guard sits in front of it rather than replacing it.
      if (isStaleSession(reading.sessionId, this.contextEnded.get(m.id))) {
        this.store.debugLog('verbose', 'context-stale', `${m.id} session ${reading.sessionId} was ended — ignoring`);
        continue;
      }
      this.contextEnded.delete(m.id);
      const before = this.contextUsage.get(m.id);
      this.contextUsage.set(m.id, reading);
      if (!before || before.used !== reading.used || before.sessionId !== reading.sessionId) changed = true;
      // Re-arm the hysteresis on the way down, so a loop that dropped below the threshold without
      // changing session id (`/clear`, auto-compaction) can trip again.
      if (shouldClearTrip(reading.percent, cfg.contextPercent) && this.contextTripped.delete(m.id)) {
        this.store.debugLog('info', 'context-rearm', `${m.id} back to ${reading.percent}% — trip re-armed`);
      }
      if (!shouldTrip(reading.percent, cfg.contextPercent, reading.sessionId, this.contextTripped.get(m.id))) continue;
      // Hysteresis: record the session that tripped BEFORE acting, so a loop parked above the
      // threshold is restarted once per session rather than on every poll.
      this.contextTripped.set(m.id, reading.sessionId);
      this.store.debugLog('info', 'context-trip', `${m.id} ${reading.percent}% >= ${cfg.contextPercent}% (${reading.used}/${reading.window})`);
      // An UNKNOWN board defers too (the constructor polls before the first refresh): with no
      // board there is no way to tell whether this slot owns the In-Progress task, and the
      // fail-open direction is the forbidden one.
      if (!this.lastBoard || this.busyModels(this.lastBoard).includes(m.id)) {
        // NEVER forced: killing a worker mid-task would leave its task `phase: inprogress` with
        // nobody on it, which Rule 2 turns into a board-wide block. A live subagent holds it the
        // same way (t-sbag) — restarting would kill the agent mid-edit. Wait for the idle edge.
        this.contextPending.add(m.id);
        const why = this.lastBoard ? this.describeBusy(m.id, this.lastBoard) : 'board not loaded yet';
        this.store.debugLog('info', 'context-defer', `${m.id} — ${why}, waiting for idle`);
        changed = true;
        continue;
      }
      this.fireContextRestart(m.id, cfg.contextAction);
      changed = true;
    }
    // The idle edge a finishing subagent produces (t-sbag). Each flush re-checks `busyModels`, so
    // running them here can only release a hold that is genuinely over.
    if (busyChanged && this.lastBoard) {
      this.flushPendingRestarts(this.lastBoard);
      this.flushPendingContext(this.lastBoard);
      this.flushAfterTask(this.lastBoard);
    }
    if (changed) await this.postBoard();
  }

  // Re-reads one slot's live subagents and updates the busy signal. Returns whether the live set
  // changed — a repaint (the rows and their durations are on the sidebar) and a flush attempt.
  private async pollSubagents(model: Model): Promise<boolean> {
    if (!this.contextReader) return false;
    const now = Date.now();
    const rows = await this.contextReader.readSubagents(model, now);
    // Logged on EVERY poll: this is the trail that explains a restart that did not happen. A read
    // failure is named as such — it must never look like a confident "nothing is running".
    this.store.debugLog('verbose', 'agents-read', rows === undefined
      ? `${model} — could not read this session's subagents`
      : `${model} ${rows.length} live${rows.length ? `: ${rows.map((r) => describeAgent(r, now).label).join(', ')}` : ''}`);
    // A failed read is treated as "nothing live": an unreadable path must not hold every automatic
    // restart of this slot forever. Only a subagent we can actually SEE blocks one.
    const live = rows ?? [];
    const before = this.agentRows.get(model) ?? [];
    const same = before.length === live.length && before.every((r, i) => r.id === live[i].id);
    this.agentRows.set(model, live);
    if (live.length) this.agentBusy.add(model);
    else this.agentBusy.delete(model);
    return !same;
  }

  // Drops a slot's subagent state (its session is gone). Returns whether anything was actually
  // dropped, so a stopped loop only forces one repaint.
  private forgetAgents(model: Model): boolean {
    const hadRows = (this.agentRows.get(model) ?? []).length > 0;
    this.agentRows.delete(model);
    return this.agentBusy.delete(model) || hadRows;
  }

  private fireContextRestart(model: Model, action: ContextAction): void {
    this.contextPending.delete(model);
    // The measurement belongs to the session we are about to end; the next poll measures the new
    // one. Its id is kept as the stale-session guard (t-c7a2) — this is the path the observed
    // restart storm took, and for `action: 'clear'` there is no terminal close/open event to route
    // through `clearContextTrip`.
    const ended = this.rememberEndedSession(model);
    this.store.debugLog('info', 'context-fire', `${model} ${action}${ended ? ` — ended session ${ended}` : ''}`);
    // preserveFocus — an automatic action never steals focus from whatever the user is doing.
    if (action === 'clear') this.terminals.clearSession(model);
    else this.terminals.recycle(model, true);
  }

  // A pending context trip fires on the same idle edge deferred schedules watch.
  private flushPendingContext(board: Board): void {
    if (this.contextPending.size === 0) return;
    const busy = this.busyModels(board);
    const action = this.config().contextAction;
    for (const model of [...this.contextPending]) {
      if (!busy.includes(model)) this.fireContextRestart(model, action);
    }
  }

  // Any restart of a loop — timed, manual ♻, stop, afterTask — invalidates a pending context trip
  // and its hysteresis marker: both were measured against a session that no longer exists.
  private clearContextTrip(model: Model, reason: string): void {
    // Remember-then-drop runs UNCONDITIONALLY (t-c7a2); only the log line is conditional on there
    // having been a trip. The old early return skipped a loop that never tripped — but ending its
    // session still leaves a stale bar (threshold 50, loop at 41%, ♻ → the row keeps showing 41%
    // for a session that is gone), and nothing would have recorded the id to suppress it.
    const ended = this.rememberEndedSession(model);
    if (!this.contextPending.has(model) && !this.contextTripped.has(model)) return;
    this.contextPending.delete(model);
    this.contextTripped.delete(model);
    this.store.debugLog('info', 'context-clear', `${model} (${reason})${ended ? ` — ended session ${ended}` : ''}`);
  }

  // Move the last reading's session id into `contextEnded` and drop the measurement: it belongs to
  // a session that is ending, and the next poll may still resolve it (t-c7a2). Returns the id so
  // callers can name it in their own log line. No reading on record = nothing to remember, and the
  // first reading after the restart is accepted — the same files that produced no reading before
  // are the only ones a stale read could come from.
  private rememberEndedSession(model: Model): string | undefined {
    const sessionId = this.contextUsage.get(model)?.sessionId;
    if (sessionId) this.contextEnded.set(model, sessionId);
    this.contextUsage.delete(model);
    return sessionId;
  }

  // Repaint from the board already in memory — no disk re-read. Used by the context poll, which
  // changes only host-side loop state.
  private async postBoard(): Promise<void> {
    if (!this.lastBoard) return;
    const web = await this.buildWebBoard(this.lastBoard, true);
    BoardPanel.current?.post({ type: 'board', board: web });
    this.sidebar.post({ type: 'board', board: web });
  }

  // ---- scheduled loop restarts (t-77d1) ----

  // Which models currently own an In-Progress task, with an absent `model:` resolved to the default
  // — the same test maybeAutoRecycle uses. This was the only signal for "busy" until t-sbag added
  // live subagents beside it (see busyModels); terminal output still can never be read (CLAUDE.md,
  // src/terminals.ts), so these two files are all there is.
  private inProgressModels(board: Board): Model[] {
    const dflt = this.config().defaultWorkerModel;
    const busy = new Set<Model>();
    for (const t of board.tasks) if (t.phase === 'inprogress') busy.add(t.model ?? dflt);
    return [...busy];
  }

  // The full "do not restart this loop automatically" set (t-sbag): the tracker's In-Progress
  // owners UNION the slots whose session still has a live subagent. Every AUTOMATIC restart
  // decision reads this; the manual ♻ button deliberately does not — a human clicking now is
  // warned in the tooltip and then obeyed.
  private busyModels(board: Board): Model[] {
    const busy = new Set<Model>(this.inProgressModels(board));
    for (const model of this.agentBusy) busy.add(model);
    return [...busy];
  }

  // Why a slot counts as busy, for the log line that explains a deferral. Both reasons can hold at
  // once, and a deferral nobody can explain is the failure mode of the subagent hold.
  private describeBusy(model: Model, board: Board): string {
    const reasons: string[] = [];
    if (this.inProgressModels(board).includes(model)) reasons.push('task in progress');
    const rows = this.agentRows.get(model) ?? [];
    if (rows.length) {
      const now = Date.now();
      reasons.push(`${rows.length} live subagent${rows.length === 1 ? '' : 's'}: ${rows.map((r) => describeAgent(r, now).label).join(', ')}`);
    }
    return reasons.length ? reasons.join(' + ') : 'busy';
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
    if (!this.lastBoard || !mayFire(schedule, this.busyModels(this.lastBoard))) {
      this.restartSchedules.set(model, deferSchedule(schedule));
      const why = this.lastBoard ? this.describeBusy(model, this.lastBoard) : 'board not loaded yet';
      this.store.debugLog('info', 'restart-defer', `${model} — ${why}, waiting for idle`);
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
      this.clearContextTrip(model, `timed ${schedule.action}`);
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

  // Called after every board load (and after a subagent poll that moved the busy set): any restart
  // that was held back fires as soon as its model has neither an In-Progress task nor a live
  // subagent left.
  private flushPendingRestarts(board: Board): void {
    if (this.restartSchedules.size === 0) return;
    const busy = this.busyModels(board);
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
        detail: `A forced ${verb} kills the session mid-task. The task stays \`phase: inprogress\` in the tracker with no worker attached, and under LOOP.md Rule 2 that blocks every loop from claiming new work until you fix it by hand. Any subagents the session still has running are killed with it, mid-edit. Confirming now also covers the ${verb} itself — it fires later without asking again.`,
      },
      confirmLabel
    );
    const accepted = choice === confirmLabel;
    this.store.debugLog('info', 'popup-choice', `confirm-force-${verb} ${model} -> ${accepted ? 'accepted' : 'cancelled'}`);
    return accepted;
  }

  // Every toast is captured here so it survives past the webview (t-0143) — warnings are what
  // matter in a bug report, so they log at info; routine success/info toasts stay verbose-only.
  // `kind` is a machine discriminator the webview keys behaviour on (today only
  // 'sameFieldConflict', t-bbad: force-flush the deferred board) — never match on `text`.
  private toast(level: 'info' | 'success' | 'warning', text: string, taskId?: string, icon?: string, kind?: string): void {
    this.store.debugLog(level === 'warning' ? 'info' : 'verbose', 'toast', `${level}${taskId ? ' ' + taskId : ''} — ${text}`);
    BoardPanel.current?.post({ type: 'toast', level, text, taskId, icon, kind });
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
        if (isKnownModel(msg.model)) {
          this.clearContextTrip(msg.model, 'manual restart');
          this.terminals.recycle(msg.model);
        }
        return;
      case 'stopLoop':
        if (isKnownModel(msg.model)) {
          this.clearContextTrip(msg.model, 'loop stopped');
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
        this.openSettings();
        return;
      case 'openNativeSettings':
        // The escape hatch t-set1's gear used to be. Settings search and JSON editing are NOT
        // reproduced on LoopBoard's own page — this covers both.
        this.store.debugLog('info', 'settings-native', NATIVE_SETTINGS_FILTER);
        void vscode.commands.executeCommand('workbench.action.openSettings', NATIVE_SETTINGS_FILTER);
        return;
      case 'settingsReady':
        return this.postSettings();
      case 'settingsPatch':
        return this.onSettingsPatch(String(msg.key ?? ''), msg.value);
      case 'settingsReset':
        return this.onSettingsReset(String(msg.key ?? ''));
      case 'gridPatch':
        return this.onGridPatch(msg.slot, msg.field, msg.value);
      case 'settingsScanStale':
        return this.onScanStale();
      case 'settingsMigrate':
        return this.onMigrateStale();
      case 'settingsMigrateKey':
        return this.onMigrateOne(String(msg.key ?? ''));
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

  // ---- LoopBoard's own settings page (t-sgrp) ----

  // The page's whole content comes from here: LoopBoard reads its OWN manifest back at runtime, so
  // goals 1–3 (sections, Beta area, `scope: application`) define what the page looks like and a
  // setting added later appears on it with no code change.
  private settingsManifest(): ManifestSection[] {
    const contributed = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON?.contributes?.configuration;
    if (Array.isArray(contributed)) return contributed as ManifestSection[];
    return contributed ? [contributed as ManifestSection] : [];
  }

  // Opens (or reveals) the page. The config listener is created WITH the panel and disposed with it
  // — see SettingsPanel; the codebase gains no permanently installed config listener.
  openSettings(): void {
    this.store.debugLog('info', 'settings-open', 'LoopBoard settings page');
    const { panel, created } = SettingsPanel.show(this.extensionUri, () => {
      this.store.debugLog('info', 'settings-config-change', 'loopBoard.* changed — repainting the settings page and the board');
      // TWO repaints, because a `loopBoard.*` change moves two surfaces. Everything the board and
      // sidebar draw from configuration — the enabled slot rows, the default worker/groomer marks,
      // the context threshold — is read on demand inside `config()`, and `refresh()` is the only
      // path that pushes a repaint to them; without this call they keep showing the OLD values
      // until an unrelated `.loopboard/` write or terminal event happens to refresh them.
      // Both are started, never chained: an await (or a rejection) in one must not skip the other.
      void this.postSettings();
      void this.refresh('config-change');
    });
    panel.onMessage((msg) => this.handleMessage(msg));
    // A fresh panel's webview isn't listening yet; it asks with `settingsReady`.
    if (!created) void this.postSettings();
  }

  private async postSettings(): Promise<void> {
    if (!SettingsPanel.current) return;
    const sections = this.settingsManifest();
    const root = vscode.workspace.getConfiguration();
    const values: ValueMap = {};
    for (const key of formKeys(sections)) {
      const inspected = root.inspect(key);
      // Only these two scopes can exist: every LoopBoard key is `scope: application`, so a
      // workspace value is not merely ignored — VSCode refuses to record one.
      values[key] = { defaultValue: inspected?.defaultValue, globalValue: inspected?.globalValue };
    }
    this.store.debugLog('verbose', 'settings-render', `${sections.length} section(s), ${Object.keys(values).length} key(s)`);
    const c = vscode.workspace.getConfiguration('loopBoard');
    const grid = buildModelGrid(
      readModelsConfig(<T>(k: string, d: T) => c.get<T>(k, d)),
      readDefaultModel(c, 'defaultWorkerModel'),
      readDefaultModel(c, 'defaultGroomerModel'),
    );
    SettingsPanel.current.post({
      type: 'settings',
      form: buildSettingsForm(sections, values),
      grid,
      extensionId: EXTENSION_ID,
      // Only ever set if the extension could not read its own manifest — the page then has nothing
      // to draw and must say so rather than render as an empty, working-looking form.
      problem: sections.length === 0
        ? 'LoopBoard could not read its own configuration manifest. Use “Open in VSCode Settings” instead.'
        : undefined,
    });
  }

  // The codebase's ONLY configuration write. Target is settled by goal 3 rather than chosen here:
  // every key is `scope: application`, so Global is the only target VSCode would accept anyway.
  private async writeConfig(patch: ConfigPatch): Promise<void> {
    this.store.debugLog('info', 'settings-write', `${patch.key} = ${JSON.stringify(patch.value ?? null)} (Global)`);
    let failure: string | undefined;
    try {
      await vscode.workspace.getConfiguration().update(patch.key, patch.value, vscode.ConfigurationTarget.Global);
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      this.store.debugLog('info', 'settings-write-failed', `${patch.key} — ${failure}`);
    }
    // The config listener repaints too, but only when the value actually CHANGED — a no-op write
    // fires no event, and the control would keep showing whatever the user typed. VSCode fires the
    // event for the extension's OWN `update()` as well, so the board/sidebar repaint the listener
    // now also does covers edits made ON this page; nothing extra is needed here (and a write that
    // changed nothing has nothing for the sidebar to redraw).
    await this.postSettings();
    // Strictly after the repaint: a fresh form clears the page's error map, so posting the reason
    // first would erase it again before the user ever saw it.
    if (failure) SettingsPanel.current?.post({ type: 'settingsError', key: patch.key, reason: failure });
  }

  // Generic control edit. Re-validated against the manifest here because the webview is never
  // trusted: it can post any value for any key, and this is the last gate before `update()`.
  private async onSettingsPatch(key: string, raw: unknown): Promise<void> {
    const form = buildSettingsForm(this.settingsManifest());
    const control = findControl(form, key);
    if (!control) {
      this.store.debugLog('info', 'settings-reject', `${key} — not a settings-page control`);
      SettingsPanel.current?.post({ type: 'settingsError', key, reason: 'not a setting this page owns.' });
      return;
    }
    const result = toConfigPatch(control, raw);
    if (!result.ok) {
      // Nothing on disk changed, so no fresh form is posted: the page re-renders from the state it
      // already has (putting the control back to the stored value) and shows the reason beside it.
      this.store.debugLog('info', 'settings-reject', `${key} — ${result.reason}`);
      SettingsPanel.current?.post({ type: 'settingsError', key, reason: result.reason });
      return;
    }
    return this.writeConfig(result.patch);
  }

  // Per-setting reset — `update(key, undefined, Global)` removes the user value so the manifest
  // default takes over again. Without it a custom page silently loses the one thing the native
  // editor makes obvious.
  private async onSettingsReset(key: string): Promise<void> {
    const control = findControl(buildSettingsForm(this.settingsManifest()), key);
    const known = control !== undefined || MODEL_GRID_KEYS.includes(key);
    if (!known) {
      SettingsPanel.current?.post({ type: 'settingsError', key, reason: 'not a setting this page owns.' });
      return;
    }
    return this.writeConfig(resetPatch(key));
  }

  // One grid cell edit. The grid is a different PRESENTATION of ordinary settings, so it lands in
  // the same write path; only the validation differs (pure, unit-tested in src/settingsgrid.ts).
  private async onGridPatch(slot: unknown, field: unknown, raw: unknown): Promise<void> {
    const c = vscode.workspace.getConfiguration('loopBoard');
    const grid = buildModelGrid(
      readModelsConfig(<T>(k: string, d: T) => c.get<T>(k, d)),
      readDefaultModel(c, 'defaultWorkerModel'),
      readDefaultModel(c, 'defaultGroomerModel'),
    );
    const result = gridPatch(grid, slot, field, raw);
    if (!result.ok) {
      this.store.debugLog('info', 'settings-reject', `${String(slot)}.${String(field)} — ${result.reason}`);
      SettingsPanel.current?.post({ type: 'settingsError', slot, field, reason: result.reason });
      return;
    }
    for (const patch of result.patches) await this.writeConfig(patch);
  }

  // ---- stale-settings migration (t-sgrp follow-up) ----

  // Every `loopBoard.*` key the user has actually set, as a flat dotted map. Two passes, because
  // neither alone is complete:
  //   * BY NAME, for every key `scanKeys` asks for. A migration source under a declared SCALAR
  //     parent (`loopBoard.delegateWork.review`) is not reachable by walking — VSCode's value tree
  //     dropped it — so the known ids must be inspected directly rather than discovered.
  //   * BY ENUMERATION, for keys the manifest never declared. The object
  //     `getConfiguration('loopBoard')` returns is mixed in with the section's value TREE (and
  //     unregistered keys survive into it), so its own property names are the only way an orphan is
  //     ever found. Descent stops at the first path the manifest does not know: an undeclared
  //     object is reported whole, so `{"loopBoard.gone": {"a": 1}}` is one orphan and not one per
  //     leaf. A declared namespace is descended into instead, and the four API methods on the
  //     returned object are skipped because they are functions.
  // `inspect().globalValue` is the gate in both passes: it is the only scope this page writes, so a
  // key that exists only in workspace settings is read, found to have no global value, and ignored.
  private collectSettingValues(declared: string[]): SettingValues {
    const root = vscode.workspace.getConfiguration();
    const values: SettingValues = {};
    const record = (key: string) => {
      const globalValue = root.inspect(key)?.globalValue;
      if (globalValue !== undefined) values[key] = globalValue;
    };
    for (const key of scanKeys(declared)) record(key);

    const walk = (path: string, node: unknown) => {
      const key = `${SETTINGS_PREFIX}${path}`;
      if (declared.includes(key)) return; // already read by name above
      // A namespace the manifest declares keys underneath (`loopBoard.models`, and a legacy object
      // written at that level) — live configuration, so look inside rather than at it.
      if (declared.some((d) => d.startsWith(`${key}.`))) {
        if (node && typeof node === 'object' && !Array.isArray(node)) {
          for (const [child, value] of Object.entries(node as Record<string, unknown>)) walk(`${path}.${child}`, value);
        }
        return;
      }
      record(key);
    };
    const section = vscode.workspace.getConfiguration('loopBoard') as unknown as Record<string, unknown>;
    for (const [name, value] of Object.entries(section)) {
      if (typeof value === 'function') continue;
      walk(name, value);
    }
    return values;
  }

  private stalePlan(): MigrationPlan {
    const declared = formKeys(this.settingsManifest());
    return buildMigrationPlan(declared, this.collectSettingValues(declared));
  }

  // Preview only — this NEVER writes. The page draws one line per affected key and asks; the writes
  // arrive separately as `settingsMigrate` (all of them) or `settingsMigrateKey` (one row).
  private onScanStale(): void {
    const plan = this.stalePlan();
    this.store.debugLog(
      'verbose',
      'settings-migrate-scan',
      plan.actions.map((a) => `${a.key} → ${a.kind}`).join('; ') || 'no stale loopBoard.* keys'
    );
    this.store.debugLog(
      'info',
      'settings-migrate-preview',
      plan.findings === 0 && plan.sweeps === 0
        ? 'nothing to migrate'
        : `${plan.findings} stale key(s), ${plan.writes.length} write(s) proposed, ` +
          `${plan.conflicts} conflict(s), ${plan.sweeps} blind removal(s) offered`
    );
    SettingsPanel.current?.post({ type: 'settingsMigration', plan });
  }

  // The bulk confirmation. The plan is REBUILT here rather than taken from the message: the page's
  // copy is a snapshot that `settings.json` may have moved out from under, and the webview is never
  // trusted to say which keys get written.
  private async onMigrateStale(): Promise<void> {
    const plan = this.stalePlan();
    if (plan.writes.length === 0) {
      this.store.debugLog('info', 'settings-migrate-choice', 'confirmed, but nothing is left to write');
      SettingsPanel.current?.post({ type: 'settingsMigration', plan, done: true, applied: 0, failures: [] });
      return;
    }
    this.store.debugLog('info', 'settings-migrate-choice', `confirmed — applying ${plan.writes.length} change(s)`);
    const failures = await this.applyMigrationWrites(plan, plan.writes);
    // Repaint from disk, then hand back the RE-SCANNED plan: what is still listed afterwards is
    // what genuinely remains, not a stale echo of the preview. A sweep is listed again by
    // construction — the scan cannot see that it just ran — so the panel says what was done instead.
    await this.postSettings();
    SettingsPanel.current?.post({
      type: 'settingsMigration',
      plan: this.stalePlan(),
      done: true,
      applied: plan.writes.length - failures.length,
      failures,
    });
  }

  // ONE row's button. Same discipline as the bulk path — the plan is rebuilt and the named key
  // looked up in it, so the page can only ask for an action the host independently planned, and a
  // key that is no longer stale (or never was) writes nothing at all.
  private async onMigrateOne(key: string): Promise<void> {
    const plan = this.stalePlan();
    const action = plan.actions.find((a) => a.key === key);
    if (!action) {
      this.store.debugLog('info', 'settings-migrate-reject', `${key} — not a planned action, nothing written`);
      SettingsPanel.current?.post({ type: 'settingsMigration', plan });
      return;
    }
    const writes = actionWrites(action);
    this.store.debugLog('info', 'settings-migrate-choice', `${key} — ${action.kind}, ${writes.length} write(s)`);
    const failures = await this.applyMigrationWrites(plan, writes);
    await this.postSettings();
    SettingsPanel.current?.post({
      type: 'settingsMigration',
      plan: this.stalePlan(),
      applied: writes.length - failures.length,
      failures,
      // A sweep's report is worded for a write whose outcome the host genuinely cannot observe, and
      // `didKind` sends the page where to put it — beside the button that caused it, inside the
      // collapsed "legacy keys" disclosure, never in the default view.
      did: action.kind === 'sweep' ? `Removed ${key} from your user settings, if it was there.` : `Done: ${key}.`,
      didKind: action.kind,
    });
  }

  // The only place this feature touches `settings.json`. A `sweep` write is logged as what it is —
  // it removes the key if present and is a byte-identical no-op if not, and the host cannot tell
  // which happened, so the log must not claim either.
  private async applyMigrationWrites(plan: MigrationPlan, writes: ConfigPatch[]): Promise<string[]> {
    const blind = new Set(plan.actions.filter((a) => a.kind === 'sweep').map((a) => a.key));
    const failures: string[] = [];
    for (const patch of writes) {
      const what =
        patch.value !== undefined ? `set to ${JSON.stringify(patch.value)}`
          : blind.has(patch.key) ? 'remove if present (unreadable here)'
            : 'remove';
      this.store.debugLog('info', 'settings-migrate-write', `${patch.key} — ${what} (Global)`);
      try {
        await vscode.workspace.getConfiguration().update(patch.key, patch.value, vscode.ConfigurationTarget.Global);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.store.debugLog('info', 'settings-migrate-failed', `${patch.key} — ${reason}`);
        failures.push(`${patch.key}: ${reason}`);
      }
    }
    return failures;
  }

  // One-time cleanup of the acknowledgement an earlier build stored (see DEAD_MIGRATE_ACK_KEY).
  // Nothing reads it any more, so leaving it would be a key this extension never explains again.
  private async forgetDeadMigrateAck(): Promise<void> {
    if (this.globalState.get<unknown>(DEAD_MIGRATE_ACK_KEY) === undefined) return;
    await this.globalState.update(DEAD_MIGRATE_ACK_KEY, undefined);
    this.store.debugLog('info', 'settings-migrate-ack-dropped', `${DEAD_MIGRATE_ACK_KEY} — obsolete, removed`);
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
    await this.forgetDeadMigrateAck();
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
      this.toast('warning', `Task changed on disk — your edit to ${patch.field} was not applied.`, patch.taskId, undefined, 'sameFieldConflict');
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
