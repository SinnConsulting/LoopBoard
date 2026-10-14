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

// "On hold" sentinel for the `groomer:` field (t-65a2). Absent still means "default groomer";
// this explicit value means NO groomer — no loop may groom, re-groom or answer-fold the task
// until the human picks a real groomer again. It is a value of the existing routing field rather
// than a new key, so a task can never be held and routed at the same time. The same word on
// `reviewer:` means no review subagent runs.
export const GROOMER_HOLD = 'none';
export const NO_REVIEW = 'none';
export type GroomerValue = Model | typeof GROOMER_HOLD;
export type ReviewerValue = Model | typeof NO_REVIEW;

export function isModel(v: unknown): v is Model {
  return typeof v === 'string' && (BUILTIN_MODEL_IDS as string[]).includes(v);
}
export function isGroomerValue(v: unknown): v is GroomerValue {
  return v === GROOMER_HOLD || isModel(v);
}
export function isReviewerValue(v: unknown): v is ReviewerValue {
  return v === NO_REVIEW || isModel(v);
}

// Per-task effort (`effort:` / `groomer-effort:`). `max` is deliberately absent (human decision,
// t-0e99): only the role defaults and the orchestrator's own session may run at `max`.
export const TASK_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;
export type TaskEffort = (typeof TASK_EFFORT_LEVELS)[number];
export function isTaskEffort(v: unknown): v is TaskEffort {
  return typeof v === 'string' && (TASK_EFFORT_LEVELS as readonly string[]).includes(v);
}

// Loop identity (t-0e99), split from the task model: it keys the terminal, the session name and
// every controller map (schedules, nudges, context, agents, idle). Only the orchestrator
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

// The CLI's five `--effort` levels: the orchestrator's session (`claude --effort`, t-cffc), the
// role defaults and the per-model floor/ceiling. Each subagent gets its effort per spawn (t-716f)
// from the task's `effort:`/`groomer-effort:`, else the role default. Order matters (Faster ->
// Smarter): `clampEffort` relies on it.
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];
export function isValidEffort(s: unknown): s is Effort {
  return typeof s === 'string' && (EFFORT_LEVELS as readonly string[]).includes(s);
}

// Per-model effort floor and ceiling (t-0e99 FB7): every spawn on that model has its effort clamped
// into [minEffort, maxEffort]. The full range (low..max) clamps nothing. An unset or invalid bound
// reads as the model's shipped default, and an inverted pair (min above max) as the whole default
// range, so a bad pair never narrows anything by accident.
export interface EffortRange {
  minEffort: Effort;
  maxEffort: Effort;
}
export const FULL_EFFORT_RANGE: EffortRange = { minEffort: 'low', maxEffort: 'max' };

export function sanitizeEffortRange(min: unknown, max: unknown, dflt: EffortRange = FULL_EFFORT_RANGE): EffortRange {
  const lo = isValidEffort(min) ? min : dflt.minEffort;
  const hi = isValidEffort(max) ? max : dflt.maxEffort;
  return EFFORT_LEVELS.indexOf(lo) > EFFORT_LEVELS.indexOf(hi)
    ? { minEffort: dflt.minEffort, maxEffort: dflt.maxEffort }
    : { minEffort: lo, maxEffort: hi };
}

// The shipped per-model defaults (owner decision 2026-10-14, the settings page the owner runs): Opus
// and Haiku on, Sonnet and Fable off; Opus capped at `xhigh`. Every role default sits on a model
// that is on. Mirrors the manifest (test/manifest-settings.test.js pins the two together).
export const MODEL_DEFAULTS: Record<Model, { enabled: boolean } & EffortRange> = {
  opus: { enabled: true, minEffort: 'low', maxEffort: 'xhigh' },
  sonnet: { enabled: false, minEffort: 'low', maxEffort: 'max' },
  fable: { enabled: false, minEffort: 'low', maxEffort: 'max' },
  haiku: { enabled: true, minEffort: 'low', maxEffort: 'max' },
};

export function isNarrowed(r: EffortRange): boolean {
  return r.minEffort !== FULL_EFFORT_RANGE.minEffort || r.maxEffort !== FULL_EFFORT_RANGE.maxEffort;
}

export function clampEffort(effort: Effort, r: EffortRange): Effort {
  const at = EFFORT_LEVELS.indexOf(effort);
  const lo = EFFORT_LEVELS.indexOf(r.minEffort);
  const hi = EFFORT_LEVELS.indexOf(r.maxEffort);
  return EFFORT_LEVELS[Math.min(hi, Math.max(lo, at))];
}

// Per-model user configuration (t-0e99): whether the model is offered (board selects, the bootstrap
// prompt's model list), the model id its alias resolves to (FB4: `''` = the CLI's own alias) and its
// effort floor/ceiling (FB7). The per-slot `--model`/effort/grooming-cap keys are gone with the
// per-model loops; the orchestrator carries its own.
export interface ModelConfigObject {
  enabled?: boolean; // default true
  modelId?: string; // default '' (the alias as the CLI resolves it)
  minEffort?: string;
  maxEffort?: string;
}
export type ModelsConfig = Record<string, ModelConfigObject | undefined>;

// The env var the Claude Code CLI reads to resolve each alias (verified with 2.1.296: it moves both
// the session's own `--model <alias>` and every Agent-tool spawn with that `model`). The Agent tool
// accepts only the four aliases, so this is the one way a model id reaches a subagent.
export function aliasEnvVar(model: Model): string {
  return `ANTHROPIC_DEFAULT_${model.toUpperCase()}_MODEL`;
}

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

// Build a ModelsConfig from the flattened `models.<id>.*` keys. `get` is a scoped config lookup (a
// vscode WorkspaceConfiguration.get bound to the `loopBoard` section), passed as a plain function so
// this module stays vscode-free and unit-testable. `set` (optional) is the explicit-value lookup:
// while `models.<id>.modelId` is unset, the old per-slot `models.<id>.model` string (the loop's own
// `--model` before t-0e99) is read as the model id (read-both, never a write) until migrated.
export function readModelsConfig(get: <T>(key: string, dflt: T) => T, set?: SetLookup): ModelsConfig {
  const cfg: ModelsConfig = {};
  for (const id of BUILTIN_MODEL_IDS) {
    let modelId = get<string>(`models.${id}.modelId`, '');
    if (!modelId && set) {
      const legacy = set(`models.${id}.model`);
      if (typeof legacy === 'string' && legacy.trim() !== id) modelId = legacy;
    }
    cfg[id] = {
      enabled: get<boolean>(`models.${id}.enabled`, MODEL_DEFAULTS[id].enabled),
      modelId,
      minEffort: get<string>(`models.${id}.minEffort`, MODEL_DEFAULTS[id].minEffort),
      maxEffort: get<string>(`models.${id}.maxEffort`, MODEL_DEFAULTS[id].maxEffort),
    };
  }
  return cfg;
}

// A task model after applying user config. Order follows BUILTIN_MODELS.
export interface ResolvedModel extends EffortRange {
  id: Model;
  label: string;
  enabled: boolean;
  modelId: string; // validated; '' = the CLI's own alias
}

export function resolveModels(config?: ModelsConfig): ResolvedModel[] {
  const cfg = config || {};
  return BUILTIN_MODELS.map((m) => {
    const c = cfg[m.id];
    const id = typeof c?.modelId === 'string' ? c.modelId.trim() : '';
    return {
      id: m.id,
      label: m.label,
      enabled: typeof c?.enabled === 'boolean' ? c.enabled : MODEL_DEFAULTS[m.id].enabled,
      modelId: id && isValidModelString(id) ? id : '',
      ...sanitizeEffortRange(c?.minEffort, c?.maxEffort, MODEL_DEFAULTS[m.id]),
    };
  });
}

// The terminal env that points each overridden alias at its model id. Values never reach a shell
// line (they are process env), and an invalid id was already dropped by resolveModels.
export function aliasEnv(models: readonly ResolvedModel[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const m of models) if (m.modelId) env[aliasEnvVar(m.id)] = m.modelId;
  return env;
}

export function effortRangeOf(models: readonly ResolvedModel[], model: Model): EffortRange {
  const m = models.find((r) => r.id === model);
  return m ? { minEffort: m.minEffort, maxEffort: m.maxEffort } : { ...FULL_EFFORT_RANGE };
}

export function enabledModels(config?: ModelsConfig): ResolvedModel[] {
  return resolveModels(config).filter((m) => m.enabled);
}

// ---- settings resolution with read-both fallbacks (t-0e99) ----
// `set` returns the value a user EXPLICITLY set for a `loopBoard.`-relative key, or undefined when
// it is unset (the host passes an `inspect()`-based lookup, so a manifest default never reads as
// set). Until the human applies the settings migration, the readers fall back to the old keys
// (read-both, never a write), exactly like the legacy `defaultModel`.
export type SetLookup = (key: string) => unknown;

export interface OrchestratorConfig {
  model: Model; // the loop session's `--model` alias (its id override rides the terminal env)
  effort: Effort; // validated loop session `--effort`
  groomConcurrency: number; // validated grooming cap per pass
}

// Haiku by default (owner decision 2026-10-14, gated on the CLI accepting every permission mode for
// a Haiku session: decisions/loops.md).
export const ORCHESTRATOR_DEFAULTS: OrchestratorConfig = { model: 'haiku', effort: 'medium', groomConcurrency: DEFAULT_GROOM_CONCURRENCY };

// The old Opus slot's `.effort|.groomConcurrency` still carry over until migrated (the Sonnet/Fable
// slot keys carry nothing). Its `.model` string is no longer an orchestrator value: it is read as the
// Opus model id instead (readModelsConfig).
export function resolveOrchestrator(set: SetLookup): OrchestratorConfig {
  const pick = (key: string): unknown => {
    const v = set(`orchestrator.${key}`);
    return v !== undefined ? v : set(`models.opus.${key}`);
  };
  const model = set('orchestrator.model');
  const effort = pick('effort');
  return {
    model: isModel(model) ? model : ORCHESTRATOR_DEFAULTS.model,
    effort: isValidEffort(effort) ? effort : ORCHESTRATOR_DEFAULTS.effort,
    groomConcurrency: sanitizeGroomConcurrency(pick('groomConcurrency')),
  };
}

// The five per-task defaults an absent index field resolves to. They ride the bootstrap prompt
// (sync copies LOOP.md byte for byte, so it cannot carry a configured value) and the board's
// selects show them as `default (<value>)`. Nothing ever picks a model or effort on the user's
// behalf (owner decision 2026-10-14): a spawn gets the task's field, else these.
export interface TaskDefaults {
  groomer: Model;
  groomerEffort: Effort;
  worker: Model;
  workerEffort: Effort;
  reviewer: ReviewerValue;
}

export const TASK_DEFAULTS: TaskDefaults = {
  groomer: 'opus',
  groomerEffort: 'medium',
  worker: 'opus',
  workerEffort: 'medium',
  reviewer: 'opus',
};

export function resolveTaskDefaults(set: SetLookup): TaskDefaults {
  // The pre-split `loopBoard.defaultModel` still steers both default models while neither new key
  // is set (decisions/loops.md); an off-list value is ignored rather than spawned.
  const legacy = set('defaultModel');
  const model = (key: string, dflt: Model): Model => {
    const v = set(key);
    if (v !== undefined) return isModel(v) ? v : dflt;
    return isModel(legacy) ? legacy : dflt;
  };
  const effort = (key: string, dflt: Effort): Effort => {
    const v = set(key);
    return isValidEffort(v) ? v : dflt;
  };
  // `loopBoard.delegateReview` was the on/off switch: `true` reads as `opus`, an explicit `false` as
  // `none` (the shipped default reviews now, so an explicit opt-out must survive). Read only while
  // the new key is unset.
  const reviewerSet = set('defaultReviewerModel');
  const legacyReview = set('delegateReview');
  const reviewer: ReviewerValue = reviewerSet !== undefined
    ? (isReviewerValue(reviewerSet) ? reviewerSet : TASK_DEFAULTS.reviewer)
    : legacyReview === true ? 'opus' : legacyReview === false ? NO_REVIEW : TASK_DEFAULTS.reviewer;
  return {
    groomer: model('defaultGroomerModel', TASK_DEFAULTS.groomer),
    groomerEffort: effort('defaultGroomerEffort', TASK_DEFAULTS.groomerEffort),
    worker: model('defaultWorkerModel', TASK_DEFAULTS.worker),
    workerEffort: effort('defaultWorkerEffort', TASK_DEFAULTS.workerEffort),
    reviewer,
  };
}

// A task's worker as the orchestrator will spawn it: its own `model:`/`effort:`, else the defaults,
// the effort clamped into that model's floor/ceiling. What the sidebar's In Progress row shows.
export function resolveWorker(
  entry: { model?: Model; effort?: TaskEffort },
  d: Pick<TaskDefaults, 'worker' | 'workerEffort'>,
  models: readonly ResolvedModel[] = [],
): { model: Model; effort: Effort } {
  const model = entry.model ?? d.worker;
  return { model, effort: clampEffort(entry.effort ?? d.workerEffort, effortRangeOf(models, model)) };
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
  model?: Model; // worker model (absent = default worker)
  effort?: TaskEffort; // worker effort (absent = default worker effort)
  groomer?: GroomerValue; // groomer model (absent = default groomer; 'none' = on hold)
  groomerEffort?: TaskEffort; // `groomer-effort:` (absent = default groomer effort)
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
  // Complexity records (t-0e99), free text `<level> (<signals>)`: written by the orchestrator from
  // the groomer's and the implementer's reports. A record only: nothing routes by them.
  complexityGroomer?: string;
  complexityWorker?: string;
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
