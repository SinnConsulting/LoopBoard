// Pure gate transforms (New -> Backlog promote, Review -> Done accept). No vscode imports.
// store.ts applies these to a fresh parse, then serializes + writes atomically.
import { Board, Task } from './model';

function addWorklog(t: Task, day: string): void {
  if (!t.worklog.includes(day)) t.worklog.push(day);
}

// Promote a New task to Backlog: record promoted:, reset checkbox, log the day.
export function promote(board: Board, taskId: string, today: string): boolean {
  const t = board.tasks.find((x) => x.id === taskId);
  if (!t) return false;
  t.phase = 'backlog';
  t.checked = false;
  t.promoted = today;
  addWorklog(t, today);
  return true;
}

// Accept a Review task: remove it from the board and return the completed Task for DONE.md.
// Never deletes anything else — the caller prepends the returned task to the done list.
export function accept(board: Board, taskId: string, today: string): Task | undefined {
  const idx = board.tasks.findIndex((x) => x.id === taskId);
  if (idx < 0) return undefined;
  const [t] = board.tasks.splice(idx, 1);
  t.phase = 'done';
  t.checked = true;
  t.completed = today;
  addWorklog(t, today);
  return t;
}
