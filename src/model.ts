// Data model for the LoopBoard. Pure types — no vscode imports.
//
// v2 storage split: an index entry (`.loopboard/TODO.md`) carries only the slim metadata the
// board needs to route/columnize a task; everything else lives in the per-task detail file
// (`.loopboard/tasks/<id>.md`). The composed `Task` view type stitches the two back together for
// view.ts / the webview.

export type Phase = 'new' | 'inprogress' | 'feedback' | 'backlog' | 'review' | 'done';

// Logical model slots. These are the ids that appear in TODO.md `model:`/`groomer:` fields, name
// the loop terminals, and identify a worker for claiming — a FIXED set. What actually gets passed
// as `claude --model <string>` is resolved per slot from settings (see resolveModels): each slot's
// `--model` string is overridable, and each slot can be enabled/disabled.
export type Model = 'opus' | 'sonnet' | 'fable';

// Built-in model slots in display order. `id` is the logical slot; `label` is the display name;
// `model` is the DEFAULT `--model` string spawned for that slot (identity by default).
export const BUILTIN_MODELS: { id: Model; label: string; model: string }[] = [
  { id: 'opus', label: 'Opus', model: 'opus' },
  { id: 'sonnet', label: 'Sonnet', model: 'sonnet' },
  { id: 'fable', label: 'Fable', model: 'fable' },
];

export const BUILTIN_MODEL_IDS: Model[] = BUILTIN_MODELS.map((m) => m.id);

// "On hold" sentinel for the `groomer:` field (t-65a2). Absent still means "default groomer";
// this explicit value means NO groomer — no loop may groom, re-groom or answer-fold the task
// until the human picks a real groomer again. It is a value of the existing routing field rather
// than a new key, so a task can never be held and routed at the same time.
export const GROOMER_HOLD = 'none';
export type GroomerValue = Model | typeof GROOMER_HOLD;

// Strict allowlist for any `--model` string that reaches the loop terminal shell line; admits the
// `[1m]` 1M-context suffix (e.g. `opus[1m]`). A configured override failing this is ignored and the
// built-in default is used instead — the shell line never carries an unvalidated value.
const MODEL_STRING_RE = /^[A-Za-z0-9._[\]-]+$/;
export function isValidModelString(s: string): boolean {
  return MODEL_STRING_RE.test(s);
}

// Grooming-subagent reasoning-effort ceiling (Rule 14): the worker picks low..this ceiling by
// story complexity, reserving xhigh/max for when the ceiling allows it and the story explicitly
// asks for deep reasoning. Order matters (Faster -> Smarter).
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];
export function isValidEffort(s: string): s is Effort {
  return (EFFORT_LEVELS as readonly string[]).includes(s);
}

// Per-slot user configuration, read from the `loopBoard.models` setting (keyed by slot id). Two
// accepted shapes: the object form `{ enabled, model, effort }` for full control, or a bare string
// as a shorthand for just the `--model` override (e.g. `"sonnet": "sonnet[1m]"`).
export interface ModelConfigObject {
  enabled?: boolean; // default true; false hides the slot from the Loops overview + board selects
  model?: string; // custom `--model` string; empty/invalid => the built-in default (REPLACE when set)
  effort?: string; // grooming effort ceiling for this slot; invalid/absent => 'high'
  groomConcurrency?: number; // max grooming subagents per pass; invalid/absent => 3
}
export type ModelConfigEntry = string | ModelConfigObject;
export type ModelsConfig = Record<string, ModelConfigEntry | undefined>;

// Cap on grooming subagents one loop pass may run in parallel (t-23ce). There is deliberately NO
// `0 = unlimited` sentinel: unbounded fan-out is the defect this cap exists to remove, so it must
// not stay reachable through configuration. The value is spliced into the bootstrap prompt's shell
// line, so anything non-integer, below the minimum or out of range falls back to the default rather
// than reaching the terminal raw.
export const DEFAULT_GROOM_CONCURRENCY = 3;
export const MAX_GROOM_CONCURRENCY = 99;
export function sanitizeGroomConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return DEFAULT_GROOM_CONCURRENCY;
  if (value < 1 || value > MAX_GROOM_CONCURRENCY) return DEFAULT_GROOM_CONCURRENCY;
  return value;
}

// Normalize either accepted shape to the object form.
function asConfigObject(entry: ModelConfigEntry | undefined): ModelConfigObject {
  if (typeof entry === 'string') return { model: entry };
  return entry || {};
}

// Build a ModelsConfig from the flattened per-slot settings keys (`models.<slot>.enabled` /
// `models.<slot>.model`). `get` is a scoped config lookup (e.g. a vscode WorkspaceConfiguration.get
// bound to the `loopBoard` section); passed as a plain function so this module stays vscode-free and
// unit-testable. A legacy `loopBoard.models` object resolves through the same dotted lookups, so
// pre-flatten configs keep working. The result feeds resolveModels() unchanged.
export function readModelsConfig(get: <T>(key: string, dflt: T) => T): ModelsConfig {
  const cfg: ModelsConfig = {};
  for (const id of BUILTIN_MODEL_IDS) {
    cfg[id] = {
      enabled: get<boolean>(`models.${id}.enabled`, true),
      model: get<string>(`models.${id}.model`, ''),
      effort: get<string>(`models.${id}.effort`, 'high'),
      groomConcurrency: get<number>(`models.${id}.groomConcurrency`, DEFAULT_GROOM_CONCURRENCY),
    };
  }
  return cfg;
}

// A model slot after applying user config: the actual spawn string + whether it is active.
export interface ResolvedModel {
  id: Model;
  label: string;
  model: string; // validated `--model` string to spawn
  enabled: boolean;
  effort: Effort; // validated grooming effort ceiling (Rule 14); defaults to 'high'
  groomConcurrency: number; // validated cap on grooming subagents per pass; defaults to 3
}

// Merge the built-in slots with user config: a slot may be disabled, and its `--model` string may
// be replaced by a valid custom override. Order follows BUILTIN_MODELS.
export function resolveModels(config?: ModelsConfig): ResolvedModel[] {
  const cfg = config || {};
  return BUILTIN_MODELS.map((m) => {
    const c = asConfigObject(cfg[m.id]);
    const override = typeof c.model === 'string' ? c.model.trim() : '';
    const model = override && isValidModelString(override) ? override : m.model;
    const effort = typeof c.effort === 'string' && isValidEffort(c.effort) ? c.effort : 'high';
    const groomConcurrency = sanitizeGroomConcurrency(c.groomConcurrency);
    return { id: m.id, label: m.label, model, enabled: c.enabled !== false, effort, groomConcurrency };
  });
}

export function enabledModels(config?: ModelsConfig): ResolvedModel[] {
  return resolveModels(config).filter((m) => m.enabled);
}

// The `--model` string to spawn for a slot id (built-in default for an unknown id, validated by
// the caller before it reaches the shell line).
export function resolveModelString(id: Model, config?: ModelsConfig): string {
  const r = resolveModels(config).find((m) => m.id === id);
  return r ? r.model : id;
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
  model?: Model;
  groomer?: GroomerValue; // which model grooms this task (absent = default model; 'none' = on hold)
  rev?: number; // monotonic per-task change marker; bumped by the writer only when content changes
  questions: Question[];
  notes: string[]; // unprocessed human worker-notes (Rule 16): applied then deleted, index-only
  feedback: string[]; // Review change requests (Rule 13): index-only, removed when addressed
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
  description?: string;
  delivered?: string;
  unknownLines: string[]; // preserved verbatim, flagged in UI
  raw: string;
}

// Composed view used by view.ts / the webview: index metadata + detail content.
export type Task = IndexEntry & TaskDetail & { hasDetailFile: boolean };

// The parsed index file (`.loopboard/TODO.md`).
export interface IndexDoc {
  preamble: string; // everything above the "## Tasks" heading
  entries: IndexEntry[];
}

// DONE.md entries, each carrying its task file's description/delivered for the Done-tab card
// expansion (t-628b) — everything else about a done task stays index-only.
export type DoneEntry = IndexEntry & Pick<TaskDetail, 'description' | 'delivered'>;

export interface Board {
  preamble: string; // index preamble (round-tripped verbatim)
  tasks: Task[]; // all active (non-done) tasks, in file order
  done: DoneEntry[]; // from DONE.md + tasks/<id>.md, read-only, newest first
}
