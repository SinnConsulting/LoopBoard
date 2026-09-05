// Pure field-patch application + conflict detection. No vscode imports.
// Used by store.ts (the single IO owner) and exercised directly by unit tests.
//
// v2 routes patches by destination file: index fields patch `.loopboard/TODO.md`, detail fields
// patch `.loopboard/tasks/<id>.md`. Both keep today's base/conflict semantics (disk wins).

import { IndexDoc, IndexEntry, TaskDetail, Model, GroomerValue, GROOMER_HOLD, BUILTIN_MODEL_IDS } from './model';

export type IndexField = 'title' | 'model' | 'groomer' | 'answer' | 'answers' | 'note' | 'feedback';
export type DetailField = 'description';
export type PatchField = IndexField | DetailField;

export interface FieldPatch {
  taskId: string;
  field: PatchField;
  value: string;
  base: string; // value the webview last rendered — used for conflict detection
  questionIndex?: number;
}

export interface MergeResult {
  status: 'applied' | 'conflict' | 'notfound';
  entry?: IndexEntry;
}

export interface DetailMergeResult {
  status: 'applied' | 'conflict';
}

const KNOWN_MODELS: Model[] = BUILTIN_MODEL_IDS;
const INDEX_FIELDS: IndexField[] = ['title', 'model', 'groomer', 'answer', 'answers', 'note', 'feedback'];

// Which file a field patch targets.
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
      // The WHOLE answer set as one value, one line per question in index order (the same
      // newline-joined idiom `note:`/`feedback:` use). This is what makes the board's batched
      // save (t-5e6d) a single field patch on a single file rather than N writes.
      return entry.questions.map((q) => q.answer).join('\n');
    case 'note':
      return entry.notes.join('\n');
    case 'feedback':
      return entry.feedback.join('\n');
  }
}

function setFieldValue(entry: IndexEntry, field: IndexField, value: string, questionIndex?: number): void {
  switch (field) {
    case 'title':
      entry.title = value.trim();
      break;
    case 'model':
      entry.model = normalizeModel(value);
      break;
    case 'groomer':
      entry.groomer = normalizeGroomer(value);
      break;
    case 'answer':
      if (questionIndex !== undefined && entry.questions[questionIndex]) {
        entry.questions[questionIndex].answer = value;
        // Answering (typed or via a suggestion's accept button) settles the question — its
        // suggestions no longer apply and would otherwise linger until the groomer re-grooms.
        entry.questions[questionIndex].suggestions = [];
      }
      break;
    case 'answers': {
      // Positional, so empties are NOT dropped: line i is question i's answer. applyPatch has
      // already rejected a line-count mismatch, so this cannot silently shift answers.
      const lines = value.split('\n');
      entry.questions.forEach((q, i) => {
        q.answer = lines[i] ?? '';
        // Same settling rule as the single-answer patch: an answered question's suggestions no
        // longer apply.
        q.suggestions = [];
      });
      break;
    }
    case 'note':
      // The board's note field edits the whole set as one value: split on newlines, drop empties.
      entry.notes = value
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      break;
    case 'feedback':
      entry.feedback = value
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      break;
  }
}

// Current on-disk value of a detail field.
export function currentDetailFieldValue(detail: TaskDetail, field: DetailField): string {
  switch (field) {
    case 'description':
      return detail.description ?? '';
  }
}

function setDetailFieldValue(detail: TaskDetail, field: DetailField, value: string): void {
  switch (field) {
    case 'description':
      detail.description = value.trim() ? value : undefined;
      break;
  }
}

// Apply an index field patch to a freshly-parsed index doc (mutating it). Disk wins on conflict.
export function applyPatch(doc: IndexDoc, patch: FieldPatch): MergeResult {
  const entry = doc.entries.find((e) => e.id === patch.taskId);
  if (!entry) return { status: 'notfound' };

  const current = currentFieldValue(entry, patch.field as IndexField, patch.questionIndex);
  if (current !== patch.base && current !== patch.value) {
    return { status: 'conflict', entry };
  }
  // A batched `answers` patch is positional, so a value whose line count no longer matches the
  // entry's questions cannot be applied without shifting answers onto the wrong questions — that
  // means the questions changed underneath the board (a re-groom), so disk wins.
  if (patch.field === 'answers' && patch.value.split('\n').length !== entry.questions.length) {
    return { status: 'conflict', entry };
  }
  setFieldValue(entry, patch.field as IndexField, patch.value, patch.questionIndex);
  return { status: 'applied', entry };
}

// Apply a detail field patch to a freshly-parsed task detail (mutating it). Disk wins on conflict.
export function applyDetailPatch(detail: TaskDetail, patch: FieldPatch): DetailMergeResult {
  const current = currentDetailFieldValue(detail, patch.field as DetailField);
  if (current !== patch.base && current !== patch.value) {
    return { status: 'conflict' };
  }
  setDetailFieldValue(detail, patch.field as DetailField, patch.value);
  return { status: 'applied' };
}
