// Pure gate transforms (New -> Backlog promote, Review -> Done accept). No vscode imports.
// The two human gates now span two files; gates.ts stays pure by mutating the in-memory index
// entry / task detail objects it is handed, and store.ts orchestrates the per-file writes.
import { IndexDoc, IndexEntry, Phase, TaskDetail } from './model';
import { readyToAutoPromote } from './autopromote';

function addWorklog(detail: TaskDetail, day: string): void {
  if (!detail.worklog.includes(day)) detail.worklog.push(day);
}

// Promote (tick on New) — index side: phase -> backlog, checkbox reset.
export function promoteIndex(entry: IndexEntry): void {
  entry.phase = 'backlog';
  entry.checked = false;
}

// Guarded promote for the armed auto-promote (t-39e2) — index side. The store re-parses the index
// under its write lock and calls this on the FRESH entry: it promotes exactly like promoteIndex only
// while the entry is still ready (a loop may have filed a question since the board last looked);
// otherwise it leaves the entry untouched and reports `conflict`, so the arm stays held.
export function promoteIndexIfReady(entry: IndexEntry): 'applied' | 'conflict' {
  if (!readyToAutoPromote(entry)) return 'conflict';
  promoteIndex(entry);
  return 'applied';
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

// Reorder (t-81a0, the fourth human board action): move one entry within the index so it lands
// directly before `beforeId`, or after the last entry of its phase when `beforeId` is null. Only
// New and Backlog are reorderable — the two tabs whose order a loop reads (grooming takes New top
// down, a worker claims the top Backlog task). `phase` is the tab the board rendered: if the entry
// or the anchor has since left it on disk (a missing anchor included), it is a `conflict` and
// `doc.entries` stays untouched. Only the same-phase order is visible, so a move that leaves it
// unchanged is a `noop`, never a write; entries of other phases keep their relative order.
export type MoveOutcome = 'applied' | 'noop' | 'conflict' | 'notfound' | 'unsupported';
export const REORDERABLE_PHASES: readonly Phase[] = ['new', 'backlog'];

export function moveEntry(doc: IndexDoc, taskId: string, phase: string, beforeId: string | null): MoveOutcome {
  if (!(REORDERABLE_PHASES as readonly string[]).includes(phase)) return 'unsupported';
  const moved = doc.entries.find((e) => e.id === taskId);
  if (!moved) return 'notfound';
  if (moved.phase !== phase) return 'conflict';
  if (beforeId !== null) {
    const anchor = doc.entries.find((e) => e.id === beforeId);
    if (!anchor || anchor.phase !== phase) return 'conflict';
    if (anchor === moved) return 'noop';
  }

  const rest = doc.entries.filter((e) => e !== moved);
  let at: number;
  if (beforeId !== null) {
    at = rest.findIndex((e) => e.id === beforeId);
  } else {
    let last = -1;
    rest.forEach((e, i) => { if (e.phase === phase) last = i; });
    at = last + 1;
  }
  const next = [...rest.slice(0, at), moved, ...rest.slice(at)];
  const samePhase = (list: IndexEntry[]) => list.filter((e) => e.phase === phase);
  const before = samePhase(doc.entries);
  if (samePhase(next).every((e, i) => e === before[i])) return 'noop';
  doc.entries.splice(0, doc.entries.length, ...next);
  return 'applied';
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
    feedback: [], // pending feedback is transient — dropped on accept
    completed: today,
    unknownLines: [],
    raw: '',
  };
}
