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
  AfterTask, resolveAfterTask, resolveHeldAfterTask,
} from './model';
import {
  ManifestSection, ValueMap, buildSettingsForm, findControl, formKeys, toConfigPatch, resetPatch,
  ConfigPatch, MODEL_GRID_KEYS, SETTINGS_PREFIX,
} from './settingsform';
import { buildModelGrid, gridPatch } from './settingsgrid';
import { MigrationPlan, SettingValues, actionWrites, buildMigrationPlan, scanKeys } from './settingsmigrate';
import { FieldPatch, refusalToast } from './merge';
import { BuildStamp, WEBVIEW_ASSETS, describeStamp, stampsDiffer } from './buildstamp';
import {
  RestartSchedule, LoopAction, armSchedule, delayUntilFire, mayFire, deferSchedule, afterFire,
  describeSchedule, parseMinutes, isLoopAction, supportsForce, appliesTo, MAX_DELAY_MS,
} from './schedule';
import {
  IdleState, IdleFireContext, IDLE_WARN_MS, resetIdle, observeIdle, idleWarnAt, markWarned, keepRunning,
  describeIdle, describeIdleStop, sanitizeIdleMinutes, decideIdleWarn, decideIdleStop,
} from './idle';
import { computeNudges, formatNudge, mergeNudgeItems, NudgeItem } from './nudge';
import { ContextReader, ContextReading } from './contextreader';
import { AgentEdges, AgentRow, describeAgent, foldAgentEdges, describeAgentEdge, describeAgentSide, rowsForEdges } from './subagents';
import { autoSyncPopup, decideAutoSync, describeSyncChanges } from './sync';
import { ContextAction, describeContext, describeThreshold, isStaleSession, sanitizeContextAction, sanitizeContextPercent, shouldClearTrip, shouldTrip } from './context';
import { AutoPromoteArm, createArm, evaluateArm } from './autopromote';
import { decideWhatsNew, describeWhatsNew, RELEASES_URL } from './whatsnew';
import { WhatsNewPanel } from './whatsnewpanel';

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
// The extension version the What's New check last saw (t-f070). globalState, not workspaceState:
// "I have seen this version" is per user profile and shared by every window.
const WHATS_NEW_LAST_SEEN_KEY = 'loopboard.whatsNew.lastSeenVersion';
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
  // t-aglg: `agentRows` holds `[]` both for "read fine, nothing live" and for "could not read", so
  // the fail-open is recorded apart (`agentsUnreadable`) for the log lines that must name it. The
  // `agents-start`/`agents-gone` edges diff against `agentBaseline` — the last SUCCESSFUL read —
  // never against `agentRows`, which a failed read clears to keep the sidebar honest.
  private agentsUnreadable = new Set<Model>();
  private agentBaseline = new Map<Model, AgentRow[]>();
  private afterTaskPending = new Set<Model>();
  // Idle stop (t-2dd4) — session-only, like everything above. `idleStates` holds a slot's clock
  // only while it runs (feature on, loop running, slot out of `busyModels`); `idleTimers` is that
  // slot's ONE timer — the warning while the clock runs, the stop while the warning is up.
  // `idleWarnings` is the open popup, keyed by the `warnedAt` stamp it was shown for: a popup can
  // resolve long after its warning was superseded (VSCode cannot close a notification), and a late
  // click must never act on the session that replaced it. `answered` = its choice was already
  // logged (a dismissal still stops at 30 s). `idleLabels` is what the rows last showed, so the
  // poll repaints a countdown that moved and nothing else.
  private idleStates = new Map<Model, IdleState>();
  private idleTimers = new Map<Model, ReturnType<typeof setTimeout>>();
  private idleWarnings = new Map<Model, { stamp: number; answered: boolean }>();
  private idleLabels = new Map<Model, string>();
  private contextTimer: ReturnType<typeof setInterval> | undefined;
  // Guards against overlapping polls: the interval and every refresh both trigger one, and each
  // awaits file IO.
  private contextPolling = false;
  // Build-mismatch check (t-5831), session-only: the webview-asset stamp taken at activation, and
  // whether this window already showed its one warning.
  private activationStamp: Promise<BuildStamp> | undefined;
  private buildMismatchWarned = false;
  // Right-click Promote (t-39e2): armed auto-promotes by task id, any number at once. SESSION-ONLY
  // BY DESIGN, like the restart schedules: nothing is persisted, so a reload clears every arm. Each
  // settling arm owns a timer that re-runs refresh() when its quiet period ends, so the promote fires
  // without waiting for another disk write; `autoPromoteFiring` keeps a concurrent refresh from
  // firing the same arm while its guarded promote is still writing.
  private autoPromoteArms = new Map<string, AutoPromoteArm>();
  private autoPromoteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private autoPromoteFiring = new Set<string>();
  // What the open What's New tab shows (t-f070): set when the activation check opens it. The link
  // the tab opens is THIS url, never one the webview sends back.
  private whatsNew: { previous: string; current: string; url: string } | undefined;

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

  // ---- build-mismatch check (t-5831) ----
  // Size + mtime of every media/ asset the board and sidebar webviews load. Missing = null.
  private async takeBuildStamp(): Promise<BuildStamp> {
    const stamp: BuildStamp = {};
    for (const name of WEBVIEW_ASSETS) {
      try {
        const st = await vscode.workspace.fs.stat(vscode.Uri.joinPath(this.extensionUri, 'media', name));
        stamp[name] = { size: st.size, mtime: st.mtime };
      } catch {
        stamp[name] = null;
      }
    }
    return stamp;
  }

  // Called once from `activate`: the stamp of the webview files THIS host was loaded alongside.
  stampBuild(): void {
    this.activationStamp = this.takeBuildStamp().then((s) => {
      this.store.debugLog('verbose', 'build-stamp', `activation — ${describeStamp(s)}`);
      return s;
    });
  }

  // On every board `ready`: a freshly created panel re-reads its assets from disk, so if they
  // changed since activation (a new build installed under this running window) the webview now
  // runs code the host does not. ONE native warning per window session — native on purpose, since
  // the mismatched webview cannot be trusted to show it.
  private async checkBuildStamp(): Promise<void> {
    if (!this.activationStamp) return;
    const [then, now] = await Promise.all([this.activationStamp, this.takeBuildStamp()]);
    if (!stampsDiffer(then, now)) {
      this.store.debugLog('verbose', 'build-stamp', 'ready — webview assets match activation');
      return;
    }
    const detail = `activation: ${describeStamp(then)} | now: ${describeStamp(now)}`;
    if (this.buildMismatchWarned) {
      this.store.debugLog('info', 'build-mismatch', `${detail} — already warned this session, no popup`);
      return;
    }
    this.buildMismatchWarned = true;
    this.store.debugLog('info', 'build-mismatch', detail);
    const message = 'LoopBoard was updated while this window was open — the board and the extension are out of step, so edits may be refused. Reload the window to finish the update.';
    const reload = 'Reload Window';
    this.store.debugLog('info', 'popup', `warning — ${message}`);
    const choice = await vscode.window.showWarningMessage(message, reload);
    this.store.debugLog('info', 'popup-choice', `build-mismatch -> ${choice === reload ? 'reload' : 'dismissed'}`);
    if (choice === reload) await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }

  dispose(): void {
    if (this.contextTimer !== undefined) clearInterval(this.contextTimer);
    for (const model of [...this.restartTimers.keys()]) this.clearRestartTimer(model);
    for (const model of [...this.idleTimers.keys()]) this.clearIdleTimer(model);
    for (const id of [...this.autoPromoteTimers.keys()]) this.clearAutoPromoteTimer(id);
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
      autoSyncTemplates: c.get<boolean>('autoSyncTemplates', true),
      sidebarMarquee: c.get<boolean>('sidebarMarquee', false),
      nudgeLoops: c.get<boolean>('nudgeLoops', true),
      // 35 is the default; 0 = the context threshold is off entirely (the indicator still renders).
      contextPercent: sanitizeContextPercent(c.get<number>('contextLimit.percent', 35)),
      contextAction: sanitizeContextAction(c.get<string>('contextLimit.action', 'recycle')),
      // Idle stop (t-2dd4): opt-in, off by default; an invalid minutes value falls back to 60.
      idleStopEnabled: c.get<boolean>('idleStop.enabled', false) === true,
      idleStopMinutes: sanitizeIdleMinutes(c.get<number>('idleStop.minutes', 60)),
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
      // Idle clock (t-2dd4): only while the feature is on, the loop runs and a clock exists — a busy
      // slot has no state, so it draws no line.
      const idle = cfg.idleStopEnabled && l.running ? this.idleStates.get(l.id) : undefined;
      const idleLabel = idle ? describeIdle(idle, cfg.idleStopMinutes, now) : '';
      l.idle = idleLabel ? { label: idleLabel, stopping: idle?.warnedAt !== undefined } : null;
      if (idleLabel) this.idleLabels.set(l.id, idleLabel);
      else this.idleLabels.delete(l.id);
    }
    const web = toWebviewBoard(board, this.store.workspaceName, cfg.defaultWorkerModel, loops, enabledIds, cfg.defaultGroomerModel, new Set(this.autoPromoteArms.keys()));
    web.todoMissing = this.store.todoMissing;
    web.helpUrl = HELP_URL;
    web.maxAttachmentSizeMB = cfg.maxAttachmentSizeMB;
    web.sidebarMarquee = cfg.sidebarMarquee;
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
    // Idle stop (t-2dd4): after the afterTask checks, on the same freshly loaded board. A
    // `config-change` refresh that finds the feature off drops every clock here.
    this.observeIdleClocks(board);
    this.evaluateAutoPromotes(board);
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
    // Suppressed items come back through `skipped` (t-6cbf) purely so the automatic decision is
    // visible in the log; the pure module does no logging of its own.
    const skipped: NudgeItem[] = [];
    const routes = computeNudges(prev?.tasks, next.tasks, {
      worker: cfg.defaultWorkerModel,
      groomer: cfg.defaultGroomerModel,
    }, skipped);
    for (const item of skipped) {
      this.store.debugLog('verbose', 'nudge-skip', `${item.taskId}:${item.reason} — task-file-only change on a New/DRAFT task, no grooming work`);
    }
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
        this.store.debugLog('info', 'auto-recycle', `${model} — ${this.describeAgents(model, true)}`);
        this.clearContextTrip(model, 'auto-recycle');
        this.resetIdleClock(model, 'auto-recycle');
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
        this.store.debugLog('info', 'clear-session', `${model} — ${this.describeAgents(model, true)}`);
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

  // Drops a hold that something else has already satisfied. Logged (at info) whenever there really
  // was one: a hold that silently disappears is as hard to explain as one that silently fires.
  private cancelAfterTask(model: Model, reason: string): void {
    if (!this.afterTaskPending.delete(model)) return;
    this.store.debugLog('info', 'aftertask-cancel', `${model} (${reason})`);
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
      // The slot may have been stopped or restarted by hand since the hold was recorded, and
      // `terminals.recycle` on a stopped slot is a plain START (dispose-if-present, then always
      // respawn). `resolveHeldAfterTask` is the pure guard against that — see its comment.
      const running = this.terminals.status().some((l) => l.id === model && l.running);
      const held = resolveHeldAfterTask(mode, running);
      if (held.act === 'skip') {
        this.store.debugLog('info', 'aftertask-skip', held.reason === 'off'
          ? `${model} — afterTask is off now, nothing to do`
          : `${model} — loop is not running, nothing to restart`);
        continue;
      }
      this.store.debugLog('info', held.act === 'clear' ? 'clear-session' : 'auto-recycle', `${model} (held for a live subagent)`);
      this.clearContextTrip(model, held.act === 'clear' ? 'clear-session' : 'auto-recycle');
      if (held.act === 'clear') this.terminals.clearSession(model);
      else {
        this.resetIdleClock(model, 'auto-recycle');
        this.terminals.recycle(model, true);
      }
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
        // Drop a held afterTask action for the same reason `contextPending` is dropped here: it was
        // recorded against a session that no longer exists, and `terminals.recycle` would start a
        // fresh loop rather than restart one (t-sbag). `flushAfterTask` guards this too; dropping
        // it at the source means a stopped loop never leaves a live hold behind at all.
        this.cancelAfterTask(m.id, 'loop is not running');
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
    // Idle stop (t-2dd4): the busy set moved (`busyChanged`) — a subagent finishing or starting is
    // visible ONLY here, since it writes no `.loopboard/` file — so observe the clocks against it.
    // Run on EVERY poll, not only on `busyChanged`: observing is idempotent, and it is also what
    // starts a clock after the feature was switched on in settings.json with the settings page
    // closed (no refresh fires then) and what moves a row's countdown between board writes.
    if (this.lastBoard) {
      this.observeIdleClocks(this.lastBoard);
      if (this.idleRowsStale()) changed = true;
    }
    if (changed) await this.postBoard();
  }

  // Re-reads one slot's live subagents and updates the busy signal. Returns whether the live set
  // changed — a repaint (the rows and their durations are on the sidebar) and a flush attempt.
  private async pollSubagents(model: Model): Promise<boolean> {
    if (!this.contextReader) return false;
    const now = Date.now();
    const read = await this.contextReader.readSubagents(model, now);
    const rows = read?.rows;
    // The session this slot's last restart ended (t-c7a2's echo guard, reused for the edges).
    const ended = this.contextEnded.get(model);
    const edgeRows = rowsForEdges(read, ended);
    // Logged on EVERY poll: this is the trail that explains a restart that did not happen. A read
    // failure is named as such — it must never look like a confident "nothing is running".
    this.store.debugLog('verbose', 'agents-read', rows === undefined
      ? `${model} — could not read this session's subagents`
      : `${model} ${rows.length} live${rows.length ? `: ${rows.map((r) => describeAgent(r, now).label).join(', ')}` : ''}${edgeRows === undefined ? ` (ended session ${ended} — no edges)` : ''}`);
    // A failed read is treated as "nothing live": an unreadable path must not hold every automatic
    // restart of this slot forever. Only a subagent we can actually SEE blocks one.
    const live = rows ?? [];
    const before = this.agentRows.get(model) ?? [];
    const same = before.length === live.length && before.every((r, i) => r.id === live[i].id);
    this.agentRows.set(model, live);
    if (live.length) this.agentBusy.add(model);
    else this.agentBusy.delete(model);
    // Lifecycle edges at info (t-aglg), from successful reads only: a failed read emits nothing and
    // leaves the baseline alone, so the next good read diffs against the last good one. A read of
    // the session a restart just ENDED counts as failed for the edges only (`rowsForEdges`) — its
    // killed agents would otherwise log a false `agents-start` now and a second `agents-gone` once
    // the new session resolves. The busy signal above is deliberately left as t-sbag defined it: a
    // `/clear` context action keeps the process, and whether that ends its agents is unverified.
    if (rows === undefined) this.agentsUnreadable.add(model);
    else this.agentsUnreadable.delete(model);
    if (edgeRows !== undefined) {
      this.logAgentEdges(model, foldAgentEdges(this.agentBaseline.get(model) ?? [], edgeRows), now);
      this.agentBaseline.set(model, edgeRows);
    }
    return !same;
  }

  // Drops a slot's subagent state (its session is gone). Returns whether anything was actually
  // dropped, so a stopped loop only forces one repaint. Agents still in the baseline are logged as
  // `agents-gone` first: the session going away is one of the ways an agent stops being live.
  private forgetAgents(model: Model): boolean {
    this.logAgentEdges(model, foldAgentEdges(this.agentBaseline.get(model) ?? [], []), Date.now());
    this.agentBaseline.delete(model);
    this.agentsUnreadable.delete(model);
    const hadRows = (this.agentRows.get(model) ?? []).length > 0;
    this.agentRows.delete(model);
    return this.agentBusy.delete(model) || hadRows;
  }

  private logAgentEdges(model: Model, edges: AgentEdges, now: number): void {
    for (const row of edges.gone) this.store.debugLog('info', 'agents-gone', `${model} ${describeAgentEdge('gone', row, now)}`);
    for (const row of edges.started) this.store.debugLog('info', 'agents-start', `${model} ${describeAgentEdge('start', row, now)}`);
  }

  private fireContextRestart(model: Model, action: ContextAction): void {
    this.contextPending.delete(model);
    // This path does not go through `clearContextTrip`, so it cancels the held afterTask action
    // itself — same rule: one restart, not two (t-sbag).
    this.cancelAfterTask(model, `context ${action}`);
    // The measurement belongs to the session we are about to end; the next poll measures the new
    // one. Its id is kept as the stale-session guard (t-c7a2) — this is the path the observed
    // restart storm took, and for `action: 'clear'` there is no terminal close/open event to route
    // through `clearContextTrip`.
    const ended = this.rememberEndedSession(model);
    this.store.debugLog('info', 'context-fire', `${model} ${action}${ended ? ` — ended session ${ended}` : ''} — ${this.describeAgents(model, true)}`);
    // preserveFocus — an automatic action never steals focus from whatever the user is doing.
    if (action === 'clear') this.terminals.clearSession(model);
    else {
      this.resetIdleClock(model, 'context recycle');
      this.terminals.recycle(model, true);
    }
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
    // A held afterTask action goes with it (t-sbag). Whatever restarted this loop — the normal
    // idle edge, a manual ♻, a ■, a timed action — has already given the slot the fresh session
    // the hold was waiting to give it, and firing the hold on top would be a SECOND restart:
    // `terminals.recycle` disposes and respawns 400 ms later, so a duplicate lands inside that
    // window and tears down the terminal the first one just created. Placed above the early return
    // below, which only guards the context-trip half.
    this.cancelAfterTask(model, reason);
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
    const web = await this.buildWebBoard(this.lastBoard);
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

  // The agent side of an action that went AHEAD (t-aglg) — the counterpart of `describeBusy`, which
  // only the defer paths reach. `acting` is false for a swallowed action, which kills nothing. It
  // reflects the LAST poll, so it can be up to one poll (30 s) old: an agent spawned since then is
  // not named.
  private describeAgents(model: Model, acting: boolean): string {
    return describeAgentSide(this.agentRows.get(model) ?? [], this.agentsUnreadable.has(model), acting, Date.now());
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
      this.store.debugLog('info', 'restart-skip', `${model} ${schedule.action} — loop is ${running ? 'already running' : 'not running'}, nothing to do — ${this.describeAgents(model, false)}`);
    } else {
      // A start ends no session, so it kills nothing even when forced.
      this.store.debugLog('info', 'restart-fire', `${model} ${schedule.action}${schedule.force ? ' (forced — a task may be mid-flight)' : ''} — ${this.describeAgents(model, schedule.action !== 'start')}`);
      this.clearContextTrip(model, `timed ${schedule.action}`);
      this.resetIdleClock(model, `timed ${schedule.action}`);
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

  // ---- ■, shared (t-2dd4 decision 4) ----

  // The one stop path. The ■ button and the idle stop both call this, so an idle stop is a ■ by
  // construction: drop the context trip (and with it any held afterTask action), cancel an armed
  // schedule — a repeating restart included, since restarting a terminal that was just stopped
  // would be the opposite of what stopping meant — reset the idle clock, dispose the terminal.
  // `note` becomes the `loop-stop` line's detail and is what tells a manual ■ from an idle stop in
  // the log (t-aglg): the ■ passes its agent side, the idle stop prefixes `idle stop`.
  private stopLoop(model: Model, reason: string, note: string): void {
    this.clearContextTrip(model, reason);
    this.cancelRestart(model, reason);
    this.resetIdleClock(model, reason);
    this.terminals.stop(model, note);
  }

  // ---- idle stop (t-2dd4) ----

  // Observes every slot against `busyModels` and (re)arms its one timer. Called on every refresh
  // and every context poll (the poll is the only place a subagent's start or finish is visible).
  // Idle = out of `busyModels` and nothing else (human decision, 2026-09-25): no In-Progress task
  // and no live subagent SEEN — a failed subagent read counts as none, exactly as `busyModels`
  // treats it. Feature off, or loop not running → no state, no timer, no row line.
  private observeIdleClocks(board: Board): void {
    const cfg = this.config();
    if (!cfg.idleStopEnabled) {
      for (const model of [...this.idleStates.keys()]) this.resetIdleClock(model, 'disabled');
      return;
    }
    const busy = this.busyModels(board);
    const running = new Set(this.terminals.status().filter((l) => l.running).map((l) => l.id));
    const now = Date.now();
    for (const model of BUILTIN_MODEL_IDS) {
      if (!running.has(model)) {
        this.resetIdleClock(model, 'loop is not running');
        continue;
      }
      const before = this.idleStates.get(model) ?? resetIdle();
      const after = observeIdle(before, model, busy, now);
      if (after.idleSince === undefined) {
        if (before.idleSince === undefined) continue; // busy, and no clock to drop
        // Turned busy. During the 30 s warning that is the hold the stop must never go past.
        const why = this.describeBusy(model, board);
        if (before.warnedAt !== undefined) this.store.debugLog('info', 'idle-hold', `${model} — ${why} during the idle warning, stop cancelled`);
        this.resetIdleClock(model, why);
        continue;
      }
      if (before.idleSince === undefined) {
        this.store.debugLog('verbose', 'idle-start', `${model} — no task in progress, ${this.describeAgents(model, false)}; stop at ${cfg.idleStopMinutes}m`);
      }
      this.idleStates.set(model, after);
      // Re-armed from the CURRENT minutes on every observation, so a change applied through the
      // settings page (which refreshes) moves the deadline at once. An open warning keeps its stop
      // timer untouched.
      if (after.warnedAt === undefined) this.armIdleTimer(model, after, cfg.idleStopMinutes);
    }
  }

  private armIdleTimer(model: Model, state: IdleState, minutes: number): void {
    const at = idleWarnAt(state, minutes);
    if (at === undefined) return;
    this.clearIdleTimer(model);
    const timer = setTimeout(() => {
      this.idleTimers.delete(model);
      this.onIdleWarnDue(model);
    }, Math.max(0, Math.min(MAX_DELAY_MS, at - Date.now())));
    this.idleTimers.set(model, timer);
  }

  private clearIdleTimer(model: Model): void {
    const timer = this.idleTimers.get(model);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.idleTimers.delete(model);
  }

  // Drops a slot's clock, timer and open warning. Spawn, recycle, ■, a terminal that closed, the
  // feature turned off, a slot that turned busy: whatever the reason, a popup still on screen for
  // this slot is now stale, and its choice is recorded as `superseded` here — a late click on it is
  // ignored by stamp.
  private resetIdleClock(model: Model, reason: string): void {
    this.clearIdleTimer(model);
    this.settleIdleWarning(model, 'superseded');
    if (this.idleStates.delete(model)) this.store.debugLog('verbose', 'idle-reset', `${model} (${reason})`);
  }

  // Closes the books on an open warning: logs its outcome once (unless a dismissal already did).
  private settleIdleWarning(model: Model, outcome: string): void {
    const warning = this.idleWarnings.get(model);
    if (!warning) return;
    this.idleWarnings.delete(model);
    if (!warning.answered) this.store.debugLog('info', 'popup-choice', `idle-stop ${model} -> ${outcome}`);
  }

  // Everything a fire-time decision re-reads. Configuration is read NOW, not remembered: a change
  // made in settings.json with the settings page closed triggers no refresh (t-sgrp). An unknown
  // board counts as busy — the fail-open direction is the forbidden one here, as for the context
  // trip.
  private idleFireContext(model: Model): IdleFireContext {
    const cfg = this.config();
    return {
      enabled: cfg.idleStopEnabled,
      running: this.terminals.status().some((l) => l.id === model && l.running),
      busy: !this.lastBoard || this.busyModels(this.lastBoard).includes(model),
      minutes: cfg.idleStopMinutes,
      now: Date.now(),
    };
  }

  private idleBusyReason(model: Model): string {
    return this.lastBoard ? this.describeBusy(model, this.lastBoard) : 'board not loaded yet';
  }

  // The warning timer fired: 30 s before the slot has been idle `minutes`.
  private onIdleWarnDue(model: Model): void {
    const state = this.idleStates.get(model);
    if (!state || state.warnedAt !== undefined) return;
    const ctx = this.idleFireContext(model);
    const decision = decideIdleWarn(state, ctx);
    if (decision.act === 'reset') {
      this.resetIdleClock(model, decision.reason);
      void this.postBoard();
      return;
    }
    if (decision.act === 'hold') {
      // A claim or a newly seen subagent raced the timer. Never forced: the clock restarts from
      // the next idle edge.
      this.store.debugLog('info', 'idle-hold', `${model} — ${this.idleBusyReason(model)}, idle warning skipped`);
      this.resetIdleClock(model, 'busy at warning time');
      void this.postBoard();
      return;
    }
    if (decision.act === 'rearm') {
      // `minutes` was raised since the timer was armed.
      this.armIdleTimer(model, state, ctx.minutes);
      return;
    }
    this.showIdleWarning(model, state, ctx.minutes);
  }

  // Non-modal, never steals focus. The 30 s deadline is our own timer racing the popup's promise:
  // VSCode tucks an unclicked notification into the bell WITHOUT resolving it.
  private showIdleWarning(model: Model, state: IdleState, minutes: number): void {
    const stamp = Date.now();
    this.idleStates.set(model, markWarned(state, stamp));
    this.idleWarnings.set(model, { stamp, answered: false });
    this.store.debugLog('info', 'idle-warn', `${model} idle ${minutes}m — no task in progress, ${this.describeAgents(model, false)}; stopping in ${IDLE_WARN_MS / 1000}s unless kept running`);
    this.clearIdleTimer(model);
    this.idleTimers.set(model, setTimeout(() => {
      this.idleTimers.delete(model);
      this.onIdleStopDue(model, stamp, 'timeout');
    }, IDLE_WARN_MS));
    const message = `LoopBoard: the ${model} loop has been idle for ${minutes} min — stopping in ${IDLE_WARN_MS / 1000} s.`;
    this.store.debugLog('info', 'popup', `warning — ${message}`);
    void vscode.window.showWarningMessage(message, 'Keep running', 'Stop now').then((choice) => this.onIdleChoice(model, stamp, choice));
    void this.postBoard();
  }

  private onIdleChoice(model: Model, stamp: number, choice: string | undefined): void {
    const warning = this.idleWarnings.get(model);
    // Superseded (already logged as such) or already answered: a late click does nothing.
    if (!warning || warning.stamp !== stamp || warning.answered) return;
    if (choice === 'Stop now') {
      this.onIdleStopDue(model, stamp, 'stop-now');
      return;
    }
    if (choice === 'Keep running') {
      this.idleWarnings.delete(model);
      this.store.debugLog('info', 'popup-choice', `idle-stop ${model} -> keep`);
      const state = keepRunning(this.idleStates.get(model) ?? resetIdle(), Date.now());
      this.idleStates.set(model, state);
      this.store.debugLog('verbose', 'idle-start', `${model} — kept running, clock restarted`);
      this.armIdleTimer(model, state, this.config().idleStopMinutes);
      void this.postBoard();
      return;
    }
    // Closed without a choice: the stop still goes ahead at 30 s.
    warning.answered = true;
    this.store.debugLog('info', 'popup-choice', `idle-stop ${model} -> dismissed`);
  }

  // The stop is due: the 30 s ran out (`timeout`) or the human clicked `Stop now`.
  private onIdleStopDue(model: Model, stamp: number, choice: 'timeout' | 'stop-now'): void {
    const warning = this.idleWarnings.get(model);
    if (!warning || warning.stamp !== stamp) return;
    const state = this.idleStates.get(model);
    const ctx = this.idleFireContext(model);
    const decision = decideIdleStop(state, stamp, ctx);
    if (decision === 'superseded') {
      this.resetIdleClock(model, !ctx.enabled ? 'disabled' : !ctx.running ? 'loop is not running' : 'superseded');
      void this.postBoard();
      return;
    }
    if (decision === 'hold') {
      this.store.debugLog('info', 'idle-hold', `${model} — ${this.idleBusyReason(model)} during the idle warning, stop cancelled`);
      this.resetIdleClock(model, 'busy at stop time');
      void this.postBoard();
      return;
    }
    this.clearIdleTimer(model);
    this.settleIdleWarning(model, choice);
    this.store.debugLog('info', 'idle-stop', `${model} ${describeIdleStop(state ?? resetIdle(), ctx.now, this.agentsUnreadable.has(model))}`);
    this.stopLoop(model, 'idle stop', `idle stop — ${this.describeAgents(model, true)}`);
  }

  // Whether a row's idle line would read differently from what was last painted — the poll's cue
  // to repaint a countdown that moved.
  private idleRowsStale(): boolean {
    const minutes = this.config().idleStopMinutes;
    const now = Date.now();
    for (const model of new Set([...this.idleStates.keys(), ...this.idleLabels.keys()])) {
      const state = this.idleStates.get(model);
      if ((state ? describeIdle(state, minutes, now) : '') !== (this.idleLabels.get(model) ?? '')) return true;
    }
    return false;
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
        // Not awaited: the warning waits on the human, the board must not.
        void this.checkBuildStamp();
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
        return this.onPatch(msg.patch as FieldPatch, msg.reqId);
      case 'gate':
        return this.onGate(msg.taskId, msg.action);
      case 'armPromote':
        return this.onArmPromote(String(msg.taskId ?? ''));
      case 'disarmPromote':
        this.disarmPromote(String(msg.taskId ?? ''), 'right-click');
        return this.refresh('auto-promote-disarm');
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
        if (isKnownModel(msg.model)) {
          // A ▶ on a running loop only reveals it, so the clock is reset only for a real start.
          if (!this.terminals.status().some((l) => l.id === msg.model && l.running)) this.resetIdleClock(msg.model, 'loop started');
          this.terminals.spawn(msg.model);
        }
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
          this.resetIdleClock(msg.model, 'manual restart');
          // The manual button ignores the subagent hold, so its log line records what it killed.
          this.terminals.recycle(msg.model, false, this.describeAgents(msg.model, true));
        }
        return;
      case 'stopLoop':
        if (isKnownModel(msg.model)) this.stopLoop(msg.model, 'loop stopped', this.describeAgents(msg.model, true));
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
        // before. A drop/paste scoped to an already-open Description, answer, or feedback
        // field (`field` set, keyed by `reqId`) only stages the bytes here — the webview folds
        // the returned link into that field's own draft value and saves it through the normal
        // field-patch path, so it lands in the right place instead of always the Description.
        const taskId = String(msg.taskId ?? '');
        const filename = String(msg.filename ?? '');
        if (!taskId || !filename || typeof msg.dataBase64 !== 'string') return;
        const field = msg.field === 'description' || msg.field === 'answer' || msg.field === 'title' || msg.field === 'feedback' ? msg.field : undefined;
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
          BoardPanel.current?.post({ type: 'attachRemoved', reqId: msg.reqId, status: result.status, message: result.message, description: result.description, title: result.title, feedback: result.feedback });
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

  // Run once per activation, right after autoHeal (t-4dce): bring TODO.md/LOOP.md's extension-owned
  // scaffolding up to the shipped templates with no click, when `loopBoard.autoSyncTemplates` is on.
  // Activation-only on purpose — nothing on refresh or file-watch re-runs it, so a hand-edit inside
  // a `loopboard:sync:` block survives until the next window load or extension update. Legacy
  // replacements run too, with no modal; the popup (and LOOP.md.bkp) is the safety net.
  async autoSyncTemplates(): Promise<void> {
    const log = (detail: string) => this.store.debugLog('info', 'template-autosync', detail);
    try {
      if (!(await this.store.hasTodoFile())) return log('skipped — no .loopboard/');
      const { todoText, loopText } = await this.readTemplates();
      // The plan is computed even with the setting off, so a hold not taken is visible in the log.
      const plan = await this.store.previewSync(todoText, loopText);
      if (decideAutoSync(plan, this.config().autoSyncTemplates) === 'none') {
        return log(plan.upToDate ? 'skipped — up to date' : `skipped — setting off (${plan.summary.length} part(s) out of date)`);
      }
      const outcome = await this.store.syncTemplates(todoText, loopText);
      if (outcome.status !== 'applied' || !outcome.plan) throw new Error(outcome.message ?? outcome.status);
      const applied = outcome.plan;
      const popup = autoSyncPopup(applied);
      if (!popup) return log('skipped — up to date');
      log(`applied — ${describeSyncChanges(applied)}`);
      this.store.debugLog('info', 'popup', `${popup.level} — ${popup.message}`);
      if (popup.level === 'warning') void vscode.window.showWarningMessage(popup.message);
      else void vscode.window.showInformationMessage(popup.message);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log(`failed — ${reason}`);
      this.store.debugLog('info', 'popup', `error — LoopBoard: template auto-sync failed — ${reason}`);
      void vscode.window.showErrorMessage(`LoopBoard: template auto-sync failed — ${reason}`);
    }
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

  // ---- What's New after an update (t-f070) ----

  // Run once per activation. The decision (first install / same / upgrade / downgrade / unparseable,
  // and the link) is the pure decideWhatsNew's; this only reads and writes globalState, opens the tab
  // and logs. Two windows reloading at once after an update can both read the old version before
  // either writes it and each open the tab — accepted, no locking (decisions/board-ui.md).
  async maybeShowWhatsNew(): Promise<void> {
    const log = (detail: string) => this.store.debugLog('info', 'whats-new', detail);
    const current = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON?.version;
    if (typeof current !== 'string') return log('skipped — running version unknown');
    const lastSeen = this.globalState.get<unknown>(WHATS_NEW_LAST_SEEN_KEY);
    const settingOn = vscode.workspace.getConfiguration('loopBoard').get<boolean>('showWhatsNew', true);
    const decision = decideWhatsNew(lastSeen, current, settingOn);
    // A failed write is carried into the ONE line below (describeWhatsNew), never logged beside a
    // line that still claims "recorded".
    let recordError: string | undefined;
    if (decision.record) {
      try {
        await this.globalState.update(WHATS_NEW_LAST_SEEN_KEY, current);
      } catch (err) {
        recordError = err instanceof Error ? err.message : String(err);
      }
    }
    if (decision.show && decision.url) {
      this.whatsNew = { previous: String(lastSeen), current, url: decision.url };
      const panel = WhatsNewPanel.show(this.extensionUri);
      panel.onMessage((msg) => void this.onWhatsNewMessage(msg));
    }
    log(describeWhatsNew(decision, recordError));
  }

  private async onWhatsNewMessage(msg: any): Promise<void> {
    if (!msg || typeof msg.type !== 'string') return;
    this.store.debugLog('verbose', 'dispatch', `whats-new ${msg.type}`);
    const info = this.whatsNew;
    switch (msg.type) {
      case 'whatsNewReady': {
        if (!info) return;
        const showAgain = vscode.workspace.getConfiguration('loopBoard').get<boolean>('showWhatsNew', true);
        WhatsNewPanel.current?.post({
          type: 'whatsNew', previous: info.previous, current: info.current, url: info.url,
          list: info.url === RELEASES_URL, dontShowAgain: !showAgain,
        });
        return;
      }
      case 'whatsNewOpen': {
        if (!info) return;
        // One line with the outcome: openExternal resolves false when no handler took the URL (as
        // the board's openLink surfaces), and a rejection is a failure, not an open.
        const link = (outcome: string) => this.store.debugLog('info', 'whats-new-link', `${info.url} — ${outcome}`);
        void vscode.env.openExternal(vscode.Uri.parse(info.url)).then(
          (opened) => link(opened ? 'opened' : 'not opened (no handler took it)'),
          (err) => link(`failed — ${err instanceof Error ? err.message : String(err)}`)
        );
        return;
      }
      case 'whatsNewOptOut': {
        // The tick IS the setting (Global, like every loopBoard.* key): ticked writes false, unticked
        // clears the key back to its default (on).
        const optOut = msg.optOut === true;
        try {
          await vscode.workspace.getConfiguration().update(
            'loopBoard.showWhatsNew', optOut ? false : undefined, vscode.ConfigurationTarget.Global
          );
          this.store.debugLog('info', 'whats-new-optout', optOut
            ? 'ticked — loopBoard.showWhatsNew set to false (Global)'
            : 'unticked — loopBoard.showWhatsNew reset to its default (on)');
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          this.store.debugLog('info', 'whats-new-optout', `failed — ${reason}`);
          // Shown on the tab itself (a board toast would land on a panel that may not be open), which
          // also puts the tick back to what is really stored.
          WhatsNewPanel.current?.post({ type: 'whatsNewError', reason, dontShowAgain: !optOut });
        }
        return;
      }
      case 'openSettings':
        return this.openSettings();
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
  // settings page's "Synchronise Templates" button and Init when `.loopboard/` already exists.
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

  // `reqId` (t-5831) is the webview's id for this patch (`sendPatch`). Every outcome is answered
  // with it in a `patchResult`, posted before the refresh, so the board knows WHICH edit was
  // refused and can give its text back in an editor. The toast text is the pure `refusalToast`.
  private async onPatch(patch: FieldPatch, reqId?: string): Promise<void> {
    const outcome = await this.store.applyFieldPatch(patch);
    const text = refusalToast(outcome.status, patch.field);
    if (text) this.toast('warning', text, patch.taskId, undefined, outcome.status === 'conflict' ? 'sameFieldConflict' : undefined);
    this.store.debugLog('verbose', 'patch-result', `${patch.taskId} ${patch.field} #${reqId ?? '-'} -> ${outcome.status}`);
    BoardPanel.current?.post({ type: 'patchResult', reqId, status: outcome.status, taskId: patch.taskId });
    return this.refresh();
  }

  private async onGate(taskId: string, action: string): Promise<void> {
    // Logged before the confirm gate (if any) so a cancelled promote/delete still leaves a
    // trace — previously a click that a modal aborted produced zero log output (t-0143).
    this.store.debugLog('info', 'gate-request', `${action} ${taskId}`);
    if (action === 'promote') {
      if (await this.confirmPromote(taskId)) {
        this.disarmPromote(taskId, 'left-click promote');
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

  // Right-click on Promote (t-39e2). Validated against the last board — never trust the webview:
  // only a New task can be armed, a DRAFT included (human decision 3, 2026-09-25). Arming an armed
  // task is a no-op; the board posts `disarmPromote` for the second right-click.
  private async onArmPromote(taskId: string): Promise<void> {
    const task = this.lastBoard?.tasks.find((t) => t.id === taskId);
    if (!task || task.phase !== 'new') {
      this.store.debugLog('info', 'auto-promote-arm', `${taskId} refused — ${task ? `phase ${task.phase}` : 'not on the board'}`);
    } else if (!this.autoPromoteArms.has(taskId)) {
      this.autoPromoteArms.set(taskId, createArm(Date.now()));
      this.store.debugLog('info', 'auto-promote-arm', `${taskId}${task.isDraft ? ' (draft — held until groomed)' : ''}`);
    }
    return this.refresh('auto-promote-arm');
  }

  // An explicit human action ends an arm: the second right-click, or a left-click promote.
  private disarmPromote(taskId: string, cause: string): void {
    if (!this.autoPromoteArms.delete(taskId)) return;
    this.clearAutoPromoteTimer(taskId);
    this.store.debugLog('info', 'auto-promote-disarm', `${taskId} — ${cause}`);
  }

  private clearAutoPromoteTimer(taskId: string): void {
    const timer = this.autoPromoteTimers.get(taskId);
    if (timer !== undefined) clearTimeout(timer);
    this.autoPromoteTimers.delete(taskId);
  }

  // Runs on every board load. The decision is pure (`evaluateArm`, src/autopromote.ts); a hold never
  // disarms (human decision 2) — only the task going away or leaving New drops an arm.
  private evaluateAutoPromotes(board: Board): void {
    if (this.autoPromoteArms.size === 0) return;
    const now = Date.now();
    for (const [id, arm] of [...this.autoPromoteArms]) {
      if (this.autoPromoteFiring.has(id)) continue;
      const task = board.tasks.find((t) => t.id === id);
      const { decision, arm: next } = evaluateArm(arm, task, now);
      this.clearAutoPromoteTimer(id);
      if (decision.kind === 'drop') {
        this.autoPromoteArms.delete(id);
        this.store.debugLog('info', 'auto-promote-drop', `${id} — ${task ? `left New (now ${task.phase})` : 'no longer on the board'}`);
      } else if (decision.kind === 'hold') {
        this.autoPromoteArms.set(id, next);
        this.store.debugLog('verbose', 'auto-promote-hold', `${id} ${decision.reason} — ${decision.detail}`);
        if (decision.wakeAt !== undefined) {
          this.autoPromoteTimers.set(id, setTimeout(() => {
            this.autoPromoteTimers.delete(id);
            void this.refresh('auto-promote-settle');
          }, Math.max(0, decision.wakeAt - now)));
        }
      } else if (task) {
        this.autoPromoteArms.set(id, next);
        void this.fireAutoPromote(id, task.title);
      }
    }
  }

  // The fire path: no confirm modal — it only ever fires on confirmPromote's no-modal case (zero
  // questions). The store re-checks the fresh entry under its write lock and refuses with
  // `conflict` if a loop filed a question since; the arm then stays held for a fresh quiet period.
  private async fireAutoPromote(taskId: string, title: string): Promise<void> {
    this.autoPromoteFiring.add(taskId);
    try {
      const r = await this.store.promote(taskId, today(), true);
      if (r.status === 'applied') {
        this.autoPromoteArms.delete(taskId);
        this.store.debugLog('info', 'auto-promote-fire', `${taskId} -> backlog`);
        this.toast('success', `Auto-promoted "${title}" to Backlog`, taskId, 'check');
      } else if (r.status === 'notfound') {
        this.autoPromoteArms.delete(taskId);
        this.store.debugLog('info', 'auto-promote-drop', `${taskId} — no longer on disk`);
      } else {
        const arm = this.autoPromoteArms.get(taskId);
        if (arm) this.autoPromoteArms.set(taskId, { ...arm, fingerprint: null });
        this.store.debugLog('info', 'auto-promote-refused', `${taskId} — the re-read entry is no longer ready; arm kept`);
      }
    } finally {
      this.autoPromoteFiring.delete(taskId);
    }
    return this.refresh('auto-promote');
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
