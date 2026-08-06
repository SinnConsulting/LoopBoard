// Pure gate transforms (New -> Backlog promote, Review -> Done accept). No vscode imports.
// The two human gates now span two files; gates.ts stays pure by mutating the in-memory index
// entry / task detail objects it is handed, and store.ts orchestrates the per-file writes.
import { IndexEntry, TaskDetail } from './model';

function addWorklog(detail: TaskDetail, day: string): void {
  if (!detail.worklog.includes(day)) detail.worklog.push(day);
}

// Promote (tick on New) — index side: phase -> backlog, checkbox reset.
export function promoteIndex(entry: IndexEntry): void {
  entry.phase = 'backlog';
  entry.checked = false;
}

// Promote — detail side: record promoted: and log the day in the task file's Meta.
export function promoteDetail(detail: TaskDetail, today: string): void {
  detail.promoted = today;
  addWorklog(detail, today);
}

// Demote (Backlog -> New button) — index side: inverse of promoteIndex. Checkbox stays unticked
// (awaiting the promote gate again).
export function demoteIndex(entry: IndexEntry): void {
  entry.phase = 'new';
  entry.checked = false;
}

// Demote — detail side: inverse of promoteDetail. The task was never really promoted, so clear
// `promoted:` rather than recording a new date; still log the day it was demoted.
export function demoteDetail(detail: TaskDetail, today: string): void {
  detail.promoted = undefined;
  addWorklog(detail, today);
}

// Accept (tick on Review) — detail side: record completed: and log the day.
export function acceptDetail(detail: TaskDetail, today: string): void {
  detail.completed = today;
  addWorklog(detail, today);
}

// Accept — build the slim DONE.md entry (§2.3) from the index entry. The task file stays in place.
export function acceptDoneEntry(entry: IndexEntry, today: string): IndexEntry {
  return {
    id: entry.id,
    title: entry.title,
    phase: 'done',
    checked: true,
    isDraft: false,
    model: entry.model,
    groomer: entry.groomer,
    questions: [],
    notes: [], // notes are transient/unprocessed — dropped on accept
    feedback: [], // feedback is addressed-and-removed before Review->Done — dropped on accept
    completed: today,
    unknownLines: [],
    raw: '',
  };
}
