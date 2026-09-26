// Pure field-patch application + conflict detection. No vscode imports.
// Used by store.ts (the single IO owner) and exercised directly by unit tests.
//
// v2 routes patches by destination file: index fields patch `.loopboard/TODO.md`, detail fields
// patch `.loopboard/tasks/<id>.md`. Both keep today's base/conflict semantics (disk wins).

import { IndexDoc, IndexEntry, TaskDetail, Model, GroomerValue, GROOMER_HOLD, BUILTIN_MODEL_IDS } from './model';

// Feedback (t-ae10) has no whole-set field: `feedbackAdd` appends one item with no base compare, and
// `feedbackItem` edits or deletes ONE item addressed by `itemIndex` plus that item's own base text.
export type IndexField = 'title' | 'model' | 'groomer' | 'answer' | 'answers' | 'feedbackAdd' | 'feedbackItem';
// The three free-markdown story sections of `tasks/<id>.md` (t-2191). All three patch the SAME
// file through the same generic path — a patch names one section and touches only that one.
export type DetailField = 'description' | 'problem' | 'goals';
export type PatchField = IndexField | DetailField;

export interface FieldPatch {
  taskId: string;
  field: PatchField;
  value: string;
  base: string; // value the webview last rendered — used for conflict detection
  questionIndex?: number;
  itemIndex?: number; // `feedbackItem` only: the item's position when the webview last rendered it
}

export interface MergeResult {
  // `noop` (t-ae10): a feedback patch with nothing to do (an empty add, or a delete whose item is
  // already gone) — nothing to write, no toast.
  // `unsupported` (t-5831): the patch names a field this build does not know — typically a webview
  // newer than the running extension host. Nothing is written, and it is NOT a disk-wins conflict.
  status: 'applied' | 'conflict' | 'notfound' | 'noop' | 'unsupported';
  entry?: IndexEntry;
  removed?: string; // `feedbackItem` only: the line that was replaced or deleted
  // Set only when the single-line rule (t-c4d1) changed the value on its way to disk: the raw
  // patch value and what was stored instead. merge stays logger-free; the store logs it.
  canonicalized?: { raw: string; stored: string };
}

export interface DetailMergeResult {
  status: 'applied' | 'conflict' | 'unsupported';
}

const KNOWN_MODELS: Model[] = BUILTIN_MODEL_IDS;
const INDEX_FIELDS: IndexField[] = ['title', 'model', 'groomer', 'answer', 'answers', 'feedbackAdd', 'feedbackItem'];
const DETAIL_FIELDS: DetailField[] = ['description', 'problem', 'goals'];

// Which file a field patch targets. An unrecognised field falls through to `detail`, where
// applyDetailPatch refuses it as `unsupported` (t-5831) — never as a conflict.
export function patchTarget(field: PatchField): 'index' | 'detail' {
  return (INDEX_FIELDS as string[]).includes(field) ? 'index' : 'detail';
}

export function normalizeModel(value: string): Model | undefined {
  const v = value.trim();
  if (KNOWN_MODELS.includes(v as Model)) return v as Model;
  return undefined; // '', 'default (opus)', 'default' -> no model field
}

// The groomer field additionally accepts the on-hold sentinel (t-65a2); everything else
// normalizes exactly like a model value, so '' / 'default (opus)' still clears the field.
export function normalizeGroomer(value: string): GroomerValue | undefined {
  return value.trim() === GROOMER_HOLD ? GROOMER_HOLD : normalizeModel(value);
}

// Current on-disk value of an index field, as a plain string (matches what the webview renders).
export function currentFieldValue(entry: IndexEntry, field: IndexField, questionIndex?: number): string {
  switch (field) {
    case 'title':
      return entry.title;
    case 'model':
      return entry.model ?? '';
    case 'groomer':
      return entry.groomer ?? '';
    case 'answer':
      return questionIndex !== undefined && entry.questions[questionIndex]
        ? entry.questions[questionIndex].answer
        : '';
    case 'answers':
      // The WHOLE answer set as one value, one line per question in index order (newline-joined).
      // This is what makes the board's batched save (t-5e6d) a single field patch on a single file
      // rather than N writes.
      return entry.questions.map((q) => q.answer).join('\n');
    case 'feedbackAdd':
    case 'feedbackItem':
      // Informational only: applyPatch resolves feedback per ITEM (applyFeedbackPatch), never by
      // comparing the whole set.
      return entry.feedback.join('\n');
  }
}

// The host single-line rule (t-c4d1). Every index value is ONE line (grammar v5), so a value on its
// way into a title, an answer or a feedback item is folded: each run of CR/LF, together with the
// whitespace around it, becomes one space, then both ends are trimmed — exactly what parse→write
// makes of a single-line value. Inner tabs and runs of spaces stay. The board's `canonAnswer`
// (media/board.js) is the same expression; test/single-line.test.js checks the two agree.
export function canonicalLine(value: string): string {
  return String(value).replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

// The `answers` set is positional and newline-joined, so it is split on the RAW value first and
// each answer is folded on its own — folding the whole value would merge the answers.
function canonicalAnswers(value: string): string {
  return value.split('\n').map(canonicalLine).join('\n');
}

// The canonical form of a value for the fields the single-line rule covers; any other field is
// returned untouched.
function canonicalFieldValue(field: IndexField, value: string): string {
  if (field === 'title' || field === 'answer') return canonicalLine(value);
  if (field === 'answers') return canonicalAnswers(value);
  return value;
}

function setFieldValue(entry: IndexEntry, field: IndexField, value: string, questionIndex?: number): void {
  switch (field) {
    case 'title':
      entry.title = canonicalLine(value);
      break;
    case 'model':
      entry.model = normalizeModel(value);
      break;
    case 'groomer':
      entry.groomer = normalizeGroomer(value);
      break;
    case 'answer':
      if (questionIndex !== undefined && entry.questions[questionIndex]) {
        entry.questions[questionIndex].answer = canonicalLine(value);
        // Answering (typed or via a suggestion's accept button) settles the question — its
        // suggestions no longer apply and would otherwise linger until the groomer re-grooms.
        entry.questions[questionIndex].suggestions = [];
      }
      break;
    case 'answers': {
      // Positional, so empties are NOT dropped: line i is question i's answer. applyPatch has
      // already rejected a line-count mismatch, so this cannot silently shift answers. Each answer
      // is folded on its own AFTER the positional split (t-c4d1), never the whole value.
      const lines = value.split('\n').map(canonicalLine);
      entry.questions.forEach((q, i) => {
        q.answer = lines[i] ?? '';
        // Same settling rule as the single-answer patch: an answered question's suggestions no
        // longer apply.
        q.suggestions = [];
      });
      break;
    }
  }
}

// Current on-disk value of a detail field.
export function currentDetailFieldValue(detail: TaskDetail, field: DetailField): string {
  switch (field) {
    case 'description':
      return detail.description ?? '';
    case 'problem':
      return detail.problem ?? '';
    case 'goals':
      return detail.goals ?? '';
  }
}

function setDetailFieldValue(detail: TaskDetail, field: DetailField, value: string): void {
  switch (field) {
    case 'description':
      detail.description = value.trim() ? value : undefined;
      break;
    case 'problem':
      detail.problem = value.trim() ? value : undefined;
      break;
    case 'goals':
      detail.goals = value.trim() ? value : undefined;
      break;
  }
}

// One composer entry → feedback items: the entry folded to ONE single-line item, or none when it is
// blank (t-c4d1, amending t-ae10's per-line split — which saved one pasted message as one item per
// line, a hard-wrapped sentence as two).
export function feedbackLines(value: string): string[] {
  const item = canonicalLine(value);
  return item ? [item] : [];
}

// Per-item feedback patches (t-ae10). Neither compares the WHOLE set, so a loop deleting an
// addressed item while the board's refresh is deferred can never turn a human's add or edit of a
// DIFFERENT item into a disk-wins conflict.
//   feedbackAdd  — pure append to the re-read disk list; no base at all.
//   feedbackItem — ONE item, found by `itemIndex` when the line there still equals `base`, else by
//                  the first line equal to `base` (an earlier item was removed and indices shifted).
//                  Non-empty value = replace that line; empty value = remove it. Base found nowhere
//                  = the loop addressed or changed that item: an edit is a conflict (disk wins), a
//                  delete a `noop` (the item is already gone). `removed` carries the old line text
//                  so the store can clean up attachments only that line linked.
function applyFeedbackPatch(entry: IndexEntry, patch: FieldPatch): MergeResult {
  const lines = feedbackLines(patch.value);
  const canonicalized = lines.length && lines[0] !== patch.value ? { raw: patch.value, stored: lines[0] } : undefined;
  if (patch.field === 'feedbackAdd') {
    if (lines.length === 0) return { status: 'noop', entry };
    entry.feedback.push(...lines);
    return { status: 'applied', entry, canonicalized };
  }
  const i = patch.itemIndex;
  const at = i !== undefined && entry.feedback[i] === patch.base ? i : entry.feedback.indexOf(patch.base);
  if (at < 0) {
    if (lines.length === 0) return { status: 'noop', entry };
    return { status: 'conflict', entry };
  }
  const removed = entry.feedback[at];
  entry.feedback.splice(at, 1, ...lines);
  return { status: 'applied', entry, removed, canonicalized };
}

// Apply an index field patch to a freshly-parsed index doc (mutating it). Disk wins on conflict.
export function applyPatch(doc: IndexDoc, patch: FieldPatch): MergeResult {
  // An unknown field has no on-disk value to compare, so the base test below would call it a
  // conflict every time (the t-5831 incident) — refuse it honestly instead.
  if (!(INDEX_FIELDS as string[]).includes(patch.field)) return { status: 'unsupported' };
  const entry = doc.entries.find((e) => e.id === patch.taskId);
  if (!entry) return { status: 'notfound' };
  if (patch.field === 'feedbackAdd' || patch.field === 'feedbackItem') return applyFeedbackPatch(entry, patch);

  const field = patch.field as IndexField;
  // Conflicts compare CANONICAL values (t-c4d1): disk only ever holds the folded, trimmed form, so a
  // raw base or value that folds to what is on disk is the same value — an idempotent re-save is
  // not a false conflict. A real same-field change on disk still differs from both, and conflicts.
  const current = canonicalFieldValue(field, currentFieldValue(entry, field, patch.questionIndex));
  const value = canonicalFieldValue(field, patch.value);
  if (current !== canonicalFieldValue(field, patch.base) && current !== value) {
    return { status: 'conflict', entry };
  }
  // A batched `answers` patch is positional, so a value whose line count no longer matches the
  // entry's questions cannot be applied without shifting answers onto the wrong questions — that
  // means the questions changed underneath the board (a re-groom), so disk wins. Counted on the RAW
  // value: a line break inside one answer is exactly the shift this guards against.
  if (field === 'answers' && patch.value.split('\n').length !== entry.questions.length) {
    return { status: 'conflict', entry };
  }
  setFieldValue(entry, field, patch.value, patch.questionIndex);
  const canonicalized = value !== patch.value ? { raw: patch.value, stored: value } : undefined;
  return { status: 'applied', entry, canonicalized };
}

// Apply a detail field patch to a freshly-parsed task detail (mutating it). Disk wins on conflict.
export function applyDetailPatch(detail: TaskDetail, patch: FieldPatch): DetailMergeResult {
  if (!(DETAIL_FIELDS as string[]).includes(patch.field)) return { status: 'unsupported' };
  const current = currentDetailFieldValue(detail, patch.field as DetailField);
  if (current !== patch.base && current !== patch.value) {
    return { status: 'conflict' };
  }
  setDetailFieldValue(detail, patch.field as DetailField, patch.value);
  return { status: 'applied' };
}

// ---- refusal toast (t-5831) ----
// Human label for a patch field: what the toast names — never the internal patch kind
// (`feedbackAdd`, `feedbackItem`, `answers`), which means nothing to the human reading it.
export function fieldLabel(field: string): string {
  switch (field) {
    case 'title':
      return 'title';
    case 'model':
      return 'worker model';
    case 'groomer':
      return 'groomer';
    case 'answer':
    case 'answers':
      return 'answer';
    case 'feedbackAdd':
    case 'feedbackItem':
      return 'feedback';
    case 'description':
    case 'problem':
    case 'goals':
      return field;
    default:
      return ''; // a field this build does not know — the text simply says "your edit"
  }
}

// The fields whose refused text the board gives back in an editor (media/board.js `rescueTarget`
// for answers/feedback; a conflicted `answers` flush keeps its rows held). Titles and the story
// sections are a follow-up story, so their toast must not promise it.
const RESCUED_FIELDS = ['answer', 'answers', 'feedbackAdd', 'feedbackItem'];

// The warning toast for a field patch the host did not apply, built from the outcome status and a
// human field label. `undefined` = nothing to say (applied, or a no-op).
//   conflict    — disk changed under the edit (disk wins, non-negotiable 4);
//   unsupported — the board and the extension host run different builds;
//   notfound    — the task is gone.
export function refusalToast(status: string, field: string): string | undefined {
  const label = fieldLabel(field);
  const edit = label ? `your ${label} edit` : 'your edit';
  const kept = RESCUED_FIELDS.includes(field) ? ' Your text was kept on the card — save it again.' : '';
  switch (status) {
    case 'conflict':
      return `Task changed on disk — ${edit} was not applied.${kept}`;
    case 'unsupported':
      return `The board and the extension are out of step — ${edit} was not applied. Reload the window (Developer: Reload Window).${kept}`;
    case 'notfound':
      return 'That task no longer exists on disk — the board was refreshed.';
    default:
      return undefined;
  }
}
