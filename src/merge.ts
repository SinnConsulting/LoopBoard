// Pure field-patch application + conflict detection. No vscode imports.
// Used by store.ts (the single IO owner) and exercised directly by unit tests.

import { Board, Task, Model } from './model';

export type PatchField = 'title' | 'model' | 'groomer' | 'description' | 'note' | 'answer' | 'feedback';

export interface FieldPatch {
  taskId: string;
  field: PatchField;
  value: string;
  base: string; // value the webview last rendered — used for conflict detection
  questionIndex?: number;
}

export interface MergeResult {
  status: 'applied' | 'conflict' | 'notfound';
  task?: Task;
}

const KNOWN_MODELS: Model[] = ['opus', 'sonnet', 'fable'];

export function normalizeModel(value: string): Model | undefined {
  const v = value.trim();
  if (KNOWN_MODELS.includes(v as Model)) return v as Model;
  return undefined; // '', 'default (opus)', 'default' -> no model field
}

// Current on-disk value of a field, as a plain string (matches what the webview renders).
export function currentFieldValue(task: Task, field: PatchField, questionIndex?: number): string {
  switch (field) {
    case 'title':
      return task.title;
    case 'model':
      return task.model ?? '';
    case 'groomer':
      return task.groomer ?? '';
    case 'description':
      return task.description ?? '';
    case 'note':
      return task.note ?? '';
    case 'feedback':
      return task.feedback ?? '';
    case 'answer':
      return questionIndex !== undefined && task.questions[questionIndex]
        ? task.questions[questionIndex].answer
        : '';
  }
}

function setFieldValue(task: Task, field: PatchField, value: string, questionIndex?: number): void {
  switch (field) {
    case 'title':
      task.title = value.trim();
      break;
    case 'model':
      task.model = normalizeModel(value);
      break;
    case 'groomer':
      task.groomer = normalizeModel(value);
      break;
    case 'description':
      task.description = value.trim() ? value : undefined;
      break;
    case 'note':
      task.note = value.trim() ? value.trim() : undefined;
      break;
    case 'feedback':
      task.feedback = value.trim() ? value.trim() : undefined;
      break;
    case 'answer':
      if (questionIndex !== undefined && task.questions[questionIndex]) {
        task.questions[questionIndex].answer = value;
      }
      break;
  }
}

// Apply a field patch to a freshly-parsed board (mutating it). Returns the outcome.
// Conflict: the same field of the same task on disk differs from what the webview
// rendered (base) — disk wins, patch rejected.
export function applyPatch(board: Board, patch: FieldPatch): MergeResult {
  const task = board.tasks.find((t) => t.id === patch.taskId);
  if (!task) return { status: 'notfound' };

  const current = currentFieldValue(task, patch.field, patch.questionIndex);
  if (current !== patch.base && current !== patch.value) {
    return { status: 'conflict', task };
  }
  setFieldValue(task, patch.field, patch.value, patch.questionIndex);
  return { status: 'applied', task };
}
