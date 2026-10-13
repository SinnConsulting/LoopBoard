// Data model for the LoopBoard. Pure types — no vscode imports.
//
// v2 storage split: an index entry (`.loopboard/TODO.md`) carries only the slim metadata the
// board needs to route/columnize a task; everything else lives in the per-task detail file
// (`.loopboard/tasks/<id>.md`). The composed `Task` view type stitches the two back together for
// view.ts / the webview.

export type Phase = 'new' | 'inprogress' | 'feedback' | 'backlog' | 'review' | 'done';

// Task models (t-0e99): the values of the index's `model:`/`groomer:`/`reviewer:` fields and the
// `model` every groom, implementation and review subagent is spawned with. Loops are NOT keyed by
// them any more: one orchestrator loop (`LoopId`) delegates to subagents on these models.
export type Model = 'opus' | 'sonnet' | 'fable' | 'haiku';

// Built-in task models in display order (board selects, settings table, bootstrap prompt).
export const BUILTIN_MODELS: { id: Model; label: string }[] = [
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'fable', label: 'Fable' },
  { id: 'haiku', label: 'Haiku' },
];

export const BUILTIN_MODEL_IDS: Model[] = BUILTIN_MODELS.map((m) => m.id);

// `auto` (t-0e99): the orchestrator picks the model or effort itself (LOOP.md Subagents table) and
// writes the concrete value onto the index entry.
export const AUTO = 'auto';

// "On hold" sentinel for the `groomer:` field (t-65a2). Absent still means "default groomer";
// this explicit value means NO groomer — no loop may groom, re-groom or answer-fold the task
// until the human picks a real groomer again. It is a value of the existing routing field rather
// than a new key, so a task can never be held and routed at the same time. The same word on
// `reviewer:` means no review subagent runs.
export const GROOMER_HOLD = 'none';
export const NO_REVIEW = 'none';
export type ModelValue = Model | typeof AUTO;
export type GroomerValue = Model | typeof AUTO | typeof GROOMER_HOLD;
export type ReviewerValue = Model | typeof AUTO | typeof NO_REVIEW;

export function isModel(v: unknown): v is Model {
  return typeof v === 'string' && (BUILTIN_MODEL_IDS as string[]).includes(v);
}
export function isModelValue(v: unknown): v is ModelValue {
  return v === AUTO || isModel(v);
}
export function isGroomerValue(v: unknown): v is GroomerValue {
  return v === GROOMER_HOLD || isModelValue(v);
}
export function isReviewerValue(v: unknown): v is ReviewerValue {
  return v === NO_REVIEW || isModelValue(v);
}

// Per-task effort (`effort:` / `groomer-effort:`). `max` is deliberately absent: it is a loop
// session level only (`EFFORT_LEVELS` below), never a per-task value.
export const TASK_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;
export type TaskEffort = (typeof TASK_EFFORT_LEVELS)[number];
export type EffortValue = TaskEffort | typeof AUTO;
export function isEffortValue(v: unknown): v is EffortValue {
  return v === AUTO || (typeof v === 'string' && (TASK_EFFORT_LEVELS as readonly string[]).includes(v));
}

// Loop identity (t-0e99), split from the task model: it keys the terminal, the session name and
// every controller map (schedules, nudges, context, agents, afterTask, idle). Only the orchestrator
// ships; another loop category later is one more member here, not a framework.
export type LoopId = 'orchestrator';
export const LOOPS: { id: LoopId; label: string }[] = [{ id: 'orchestrator', label: 'Orchestrator' }];
export const LOOP_IDS: LoopId[] = LOOPS.map((l) => l.id);

// Runtime allowlist for untrusted (webview-supplied) loop ids: they key terminal names, so the host
// validates them rather than trusting a compile-time cast.
export function isLoopId(x: unknown): x is LoopId {
  return typeof x === 'string' && (LOOP_IDS as string[]).includes(x);
}

// Strict allowlist for any `--model` string that reaches the loop terminal shell line; admits the
// `[1m]` 1M-context suffix (e.g. `opus[1m]`). A configured value failing this is ignored and the
// default is used instead: the shell line never carries an unvalidated value.
const MODEL_STRING_RE = /^[A-Za-z0-9._[\]-]+$/;
export function isValidModelString(s: string): boolean {
  return MODEL_STRING_RE.test(s);
}

// Reasoning effort the orchestrator's loop session is started with, passed as `claude --effort
// <level>` (t-cffc, buildClaudeBase). It governs the loop session only: each subagent gets its
// effort per spawn (t-716f), from the task's `effort:`/`groomer-effort:` or the LOOP.md rubric.
// Same five levels as the CLI's `--effort`. Order matters (Faster -> Smarter).
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];
export function isValidEffort(s: string): s is Effort {
  return (EFFORT_LEVELS as readonly string[]).includes(s);
}

// Per-model user configuration: only whether the model is offered (board selects, `auto`, the
// bootstrap prompt's task-model list). The per-slot `--model`/effort/grooming-cap keys are gone with
// the per-model loops (t-0e99); the orchestrator carries its own.
export interface ModelConfigObject {
  enabled?: boolean; // default true
}
export type ModelsConfig = Record<string, ModelConfigObject | undefined>;

// Cap on grooming subagents one orchestrator pass may run in parallel (t-23ce). There is
// deliberately NO `0 = unlimited` sentinel: unbounded fan-out is the defect this cap exists to
// remove, so it must not stay reachable through configuration. The value is spliced into the
// bootstrap prompt's shell line, so anything non-integer, below the minimum or out of range falls
// back to the default rather than reaching the terminal raw.
export const DEFAULT_GROOM_CONCURRENCY = 3;
export const MAX_GROOM_CONCURRENCY = 99;
export function sanitizeGroomConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return DEFAULT_GROOM_CONCURRENCY;
  if (value < 1 || value > MAX_GROOM_CONCURRENCY) return DEFAULT_GROOM_CONCURRENCY;
  return value;
}

// Build a ModelsConfig from the flattened `models.<id>.enabled` keys. `get` is a scoped config
// lookup (a vscode WorkspaceConfiguration.get bound to the `loopBoard` section), passed as a plain
// function so this module stays vscode-free and unit-testable.
export function readModelsConfig(get: <T>(key: string, dflt: T) => T): ModelsConfig {
  const cfg: ModelsConfig = {};
  for (const id of BUILTIN_MODEL_IDS) cfg[id] = { enabled: get<boolean>(`models.${id}.enabled`, true) };
  return cfg;
}

// A task model after applying user config. Order follows BUILTIN_MODELS.
export interface ResolvedModel {
  id: Model;
  label: string;
  enabled: boolean;
}

export function resolveModels(config?: ModelsConfig): ResolvedModel[] {
  const cfg = config || {};
  return BUILTIN_MODELS.map((m) => ({ id: m.id, label: m.label, enabled: cfg[m.id]?.enabled !== false }));
}

export function enabledModels(config?: ModelsConfig): ResolvedModel[] {
  return resolveModels(config).filter((m) => m.enabled);
}

// ---- settings resolution with read-both fallbacks (t-0e99) ----
// `set` returns the value a user EXPLICITLY set for a `loopBoard.`-relative key, or undefined when
// it is unset (the host passes an `inspect()`-based lookup, so a manifest default never reads as
// set). Until the human applies the settings migration, the readers fall back to the old keys
// (read-both, never a write), exactly like `resolveAfterTask` and the legacy `defaultModel`.
export type SetLookup = (key: string) => unknown;

export interface OrchestratorConfig {
  model: string; // validated `--model` string
  effort: Effort; // validated loop session `--effort`
  groomConcurrency: number; // validated grooming cap per pass
}

export const ORCHESTRATOR_DEFAULTS: OrchestratorConfig = { model: 'opus', effort: 'medium', groomConcurrency: DEFAULT_GROOM_CONCURRENCY };

// The orchestrator defaults to Opus, so the old Opus slot's `.model|.effort|.groomConcurrency` are
// the values that carry over (the Sonnet/Fable slot keys carry nothing).
export function resolveOrchestrator(set: SetLookup): OrchestratorConfig {
  const pick = (key: string): unknown => {
    const v = set(`orchestrator.${key}`);
    return v !== undefined ? v : set(`models.opus.${key}`);
  };
  const model = pick('model');
  const effort = pick('effort');
  const trimmed = typeof model === 'string' ? model.trim() : '';
  return {
    model: trimmed && isValidModelString(trimmed) ? trimmed : ORCHESTRATOR_DEFAULTS.model,
    effort: typeof effort === 'string' && isValidEffort(effort) ? effort : ORCHESTRATOR_DEFAULTS.effort,
    groomConcurrency: sanitizeGroomConcurrency(pick('groomConcurrency')),
  };
}

// The five per-task defaults an absent index field resolves to. They ride the bootstrap prompt
// (sync copies LOOP.md byte for byte, so it cannot carry a configured value) and the board's
// selects show them as `default (<value>)`.
export interface TaskDefaults {
  groomer: ModelValue;
  groomerEffort: EffortValue;
  worker: ModelValue;
  workerEffort: EffortValue;
  reviewer: ReviewerValue;
}

export const TASK_DEFAULTS: TaskDefaults = {
  groomer: 'opus',
  groomerEffort: AUTO,
  worker: 'sonnet',
  workerEffort: AUTO,
  reviewer: NO_REVIEW,
};

export function resolveTaskDefaults(set: SetLookup): TaskDefaults {
  // The pre-split `loopBoard.defaultModel` still steers both default models while neither new key
  // is set (decisions/loops.md); an off-list value is ignored rather than spawned.
  const legacy = set('defaultModel');
  const model = (key: string, dflt: ModelValue): ModelValue => {
    const v = set(key);
    if (v !== undefined) return isModelValue(v) ? v : dflt;
    return isModelValue(legacy) ? legacy : dflt;
  };
  const effort = (key: string): EffortValue => {
    const v = set(key);
    return isEffortValue(v) ? v : AUTO;
  };
  // `loopBoard.delegateReview: true` meant "a review subagent gates the PR"; its successor value is
  // `auto` (the groomer's model judges against its own Goals). Read only while the new key is unset.
  const reviewerSet = set('defaultReviewerModel');
  const reviewer: ReviewerValue = reviewerSet !== undefined
    ? (isReviewerValue(reviewerSet) ? reviewerSet : TASK_DEFAULTS.reviewer)
    : set('delegateReview') === true ? AUTO : TASK_DEFAULTS.reviewer;
  return {
    groomer: model('defaultGroomerModel', TASK_DEFAULTS.groomer),
    groomerEffort: effort('defaultGroomerEffort'),
    worker: model('defaultWorkerModel', TASK_DEFAULTS.worker),
    workerEffort: effort('defaultWorkerEffort'),
    reviewer,
  };
}

// A task's worker as the orchestrator will resolve it: its own `model:`/`effort:`, else the
// defaults. What the sidebar's In Progress row shows.
export function resolveWorker(entry: { model?: ModelValue; effort?: EffortValue }, d: Pick<TaskDefaults, 'worker' | 'workerEffort'>): { model: ModelValue; effort: EffortValue } {
  return { model: entry.model ?? d.worker, effort: entry.effort ?? d.workerEffort };
}

// What a loop does with its terminal once the board's In-Progress task leaves In Progress (t-1f1e).
// One 3-state mode replaces the old `autoRecycle` + `clearSessionAfterTask` boolean pair, whose
// interaction was already hard-coded (a recycle always won, making `clear` moot).
//   none    — leave the terminal and its conversation alone
//   clear   — soft: send /clear, the terminal keeps running
//   recycle — hard: close the terminal and open a new one
export type AfterTask = 'none' | 'clear' | 'recycle';
export const AFTER_TASK_MODES: AfterTask[] = ['none', 'clear', 'recycle'];

// Resolve the mode, falling back to the deprecated booleans when `afterTask` is unset — the same
// read-both shape `resolveOrchestrator` uses for the old slot keys. The new key always wins, and
// nothing is ever written back to user config. The legacy mapping is lossless because
// `autoRecycle` already suppressed `clearSessionAfterTask` at the only call site.
export function resolveAfterTask(
  afterTask: string | undefined,
  legacyAutoRecycle = false,
  legacyClearSession = false,
): AfterTask {
  if (typeof afterTask === 'string' && (AFTER_TASK_MODES as string[]).includes(afterTask)) return afterTask as AfterTask;
  if (legacyAutoRecycle) return 'recycle';
  if (legacyClearSession) return 'clear';
  return 'none';
}

// What a HELD afterTask action should do when its idle edge finally arrives (t-sbag). A hold can
// outlive the state it was recorded in: the slot's terminal may have been stopped or restarted by
// hand in the meantime, and both `TerminalManager.recycle` (dispose-if-present, then ALWAYS
// respawn) and `clearSession` (early-returns with no terminal) would then do the wrong thing — the
// first by silently starting a loop the human just stopped, the second by logging a success for a
// no-op. So the decision is made here, once, and mirrors `appliesTo` in src/schedule.ts: an action
// that no longer applies is SWALLOWED, never turned into something else.
export type HeldAfterTask =
  | { act: 'recycle' | 'clear' }
  | { act: 'skip'; reason: 'off' | 'not-running' };

export function resolveHeldAfterTask(mode: AfterTask, running: boolean): HeldAfterTask {
  // Order matters only for the log line: a stopped loop is the more specific reason, and the one
  // worth naming, since "afterTask is off" would be a misleading explanation for a swallowed hold.
  if (!running) return { act: 'skip', reason: 'not-running' };
  if (mode === 'none') return { act: 'skip', reason: 'off' };
  return { act: mode };
}

export interface Question {
  text: string;
  answer: string;
  suggestions: string[]; // groomer-proposed answers (Rule 14); accepted via the existing answer patch
}

// One `.loopboard/TODO.md` (or DONE.md) entry — grammar v5. Nothing beyond these keys is canonical.
export interface IndexEntry {
  id: string;
  title: string;
  phase: Phase;
  checked: boolean;
  isDraft: boolean;
  model?: ModelValue; // worker model (absent = default worker)
  effort?: EffortValue; // worker effort (absent = default worker effort)
  groomer?: GroomerValue; // groomer model (absent = default groomer; 'none' = on hold)
  groomerEffort?: EffortValue; // `groomer-effort:` (absent = default groomer effort)
  reviewer?: ReviewerValue; // review subagent model (absent = default reviewer; 'none' = no review)
  questions: Question[];
  // Human feedback, one item per `feedback:` line, any phase incl. drafts (Rule 13; t-ae10 folded the
  // old `note:` key in here): index-only, removed once applied or folded.
  feedback: string[];
  completed?: string; // DONE.md entries only
  unknownLines: string[]; // preserved verbatim, flagged in UI
  raw: string; // original block text, for conflict detection
}

// One `.loopboard/tasks/<id>.md` file — pure content, no frontmatter (§2.2).
export interface TaskDetail {
  added?: string;
  started?: string;
  promoted?: string;
  completed?: string;
  worklog: string[];
  links: string[];
  dependsOn: string[];
  tags: string[]; // normalized (tags.ts), `- tags:` in Meta, [] when none (t-0b10)
  // Groomer-owned bookends around the story (t-2191): `problem` is why the task exists (short and
  // factual), `goals` is what "done" means (a bullet list the reviewer judges `delivered` against).
  // Both free markdown like `description`, both optional — existing task files simply have neither.
  problem?: string;
  description?: string;
  goals?: string;
  delivered?: string;
  unknownLines: string[]; // preserved verbatim, flagged in UI
  raw: string;
}

// Composed view used by view.ts / the webview: index metadata + detail content. The two `raw`
// fields collapse in the intersection, so the composed task carries the detail file's own text
// separately as `detailRaw` — without it a change confined to `tasks/<id>.md` would be invisible
// to nudge.ts's change detection (t-f1b0, the signal that replaced the removed `rev:` marker).
export type Task = IndexEntry & TaskDetail & { hasDetailFile: boolean; detailRaw: string };

// The parsed index file (`.loopboard/TODO.md`).
export interface IndexDoc {
  preamble: string; // everything above the "## Tasks" heading
  entries: IndexEntry[];
}

// DONE.md entries, each carrying its task file's problem/description/goals/delivered for the
// Done-tab card expansion (t-628b, t-2191) — everything else about a done task stays index-only.
export type DoneEntry = IndexEntry & Pick<TaskDetail, 'problem' | 'description' | 'goals' | 'delivered' | 'tags'>;

export interface Board {
  preamble: string; // index preamble (round-tripped verbatim)
  tasks: Task[]; // all active (non-done) tasks, in file order
  done: DoneEntry[]; // from DONE.md + tasks/<id>.md, read-only, newest first
  tagRegistry?: TagEntry[]; // `.loopboard/tags.md` (t-0b10): the tags that carry a color; absent = none
}

// ---- tags (t-0b10) ----
// The name rule and entry shape live here because merge.ts may import only this module; the
// `.loopboard/tags.md` registry parser/writer is `tags.ts`.
export const TAG_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export interface TagEntry {
  name: string;
  color?: TagColor;
}

// Trimmed, lower-cased, inner whitespace -> `-`. A comma would split the Meta list and a colon the
// registry line, so neither can be part of a name.
export function normalizeTag(name: string): string {
  return String(name).trim().toLowerCase().replace(/[\s,:]+/g, '-').replace(/^-+|-+$/g, '');
}

export function normalizeTags(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const tag = normalizeTag(n);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}
