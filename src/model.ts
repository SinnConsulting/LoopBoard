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
export type Model = 'opus' | 'sonnet' | 'fable' | 'haiku';

// Built-in model slots in display order. `id` is the logical slot; `label` is the display name;
// `model` is the DEFAULT `--model` string spawned for that slot (identity by default).
export const BUILTIN_MODELS: { id: Model; label: string; model: string }[] = [
  { id: 'opus', label: 'Opus', model: 'opus' },
  { id: 'sonnet', label: 'Sonnet', model: 'sonnet' },
  { id: 'fable', label: 'Fable', model: 'fable' },
  { id: 'haiku', label: 'Haiku', model: 'haiku' },
];

export const BUILTIN_MODEL_IDS: Model[] = BUILTIN_MODELS.map((m) => m.id);

// Strict allowlist for any `--model` string that reaches the loop terminal shell line; admits the
// `[1m]` 1M-context suffix (e.g. `opus[1m]`). A configured override failing this is ignored and the
// built-in default is used instead — the shell line never carries an unvalidated value.
const MODEL_STRING_RE = /^[A-Za-z0-9._[\]-]+$/;
export function isValidModelString(s: string): boolean {
  return MODEL_STRING_RE.test(s);
}

// Per-slot user configuration, read from the `loopBoard.models` setting (keyed by slot id). Two
// accepted shapes: the object form `{ enabled, model }` for full control, or a bare string as a
// shorthand for just the `--model` override (e.g. `"haiku": "haiku[1m]"`).
export interface ModelConfigObject {
  enabled?: boolean; // default true; false hides the slot from the Loops overview + board selects
  model?: string; // custom `--model` string; empty/invalid => the built-in default (REPLACE when set)
}
export type ModelConfigEntry = string | ModelConfigObject;
export type ModelsConfig = Record<string, ModelConfigEntry | undefined>;

// Normalize either accepted shape to the object form.
function asConfigObject(entry: ModelConfigEntry | undefined): ModelConfigObject {
  if (typeof entry === 'string') return { model: entry };
  return entry || {};
}

// A model slot after applying user config: the actual spawn string + whether it is active.
export interface ResolvedModel {
  id: Model;
  label: string;
  model: string; // validated `--model` string to spawn
  enabled: boolean;
}

// Merge the built-in slots with user config: a slot may be disabled, and its `--model` string may
// be replaced by a valid custom override. Order follows BUILTIN_MODELS.
export function resolveModels(config?: ModelsConfig): ResolvedModel[] {
  const cfg = config || {};
  return BUILTIN_MODELS.map((m) => {
    const c = asConfigObject(cfg[m.id]);
    const override = typeof c.model === 'string' ? c.model.trim() : '';
    const model = override && isValidModelString(override) ? override : m.model;
    return { id: m.id, label: m.label, model, enabled: c.enabled !== false };
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
}

// One `.loopboard/TODO.md` (or DONE.md) entry — grammar v4. Nothing beyond these keys is canonical.
export interface IndexEntry {
  id: string;
  title: string;
  phase: Phase;
  checked: boolean;
  isDraft: boolean;
  model?: Model;
  groomer?: Model; // which model grooms this task (absent = default model)
  rev?: number; // monotonic per-task change marker; bumped by the writer only when content changes
  questions: Question[];
  completed?: string; // DONE.md entries only
  unknownLines: string[]; // preserved verbatim, flagged in UI
  raw: string; // original block text, for conflict detection
}

// One `.loopboard/tasks/<id>.md` file — pure content, no frontmatter (§2.2).
export interface TaskDetail {
  owner?: string;
  added?: string;
  started?: string;
  promoted?: string;
  completed?: string;
  worklog: string[];
  links: string[];
  dependsOn: string[];
  description?: string;
  notes: string[]; // one bullet per note under `## Notes`
  feedback?: string;
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

export interface Board {
  preamble: string; // index preamble (round-tripped verbatim)
  tasks: Task[]; // all active (non-done) tasks, in file order
  done: IndexEntry[]; // from DONE.md, read-only, newest first
}
