// Right-click Promote: an armed, deferred New -> Backlog promote (t-39e2) — pure logic only. NEVER
// import `vscode` or node typings here: this module is compiled by tsconfig.test.json (`types: []`)
// into out-test/ and unit-tested.
//
// The human arms a task from the board (right-click on Promote); the controller keeps the arm in
// memory for the window session only — nothing in `.loopboard/`, globalState or workspaceState, so a
// reload clears every arm, like the t-77d1 loop schedules. Everything about WHETHER an armed task
// may be promoted, and WHEN, is decided here so it can be tested without a host. The promote itself
// stays the human's gate: the right-click is consent given in advance, and the extension (never a
// loop) performs it.

import { IndexEntry } from './model';

// The quiet period the ready predicate must hold, with the entry unchanged, before an arm fires.
// The groomer edits TODO.md with ordinary file edits, so between "delete the resolved pairs" and
// "file the new questions" the index can briefly look ready; 30 s outlasts that window.
export const AUTO_PROMOTE_SETTLE_MS = 30000;

// Ready to auto-promote: a groomed New story with nothing left open. Stricter than confirmPromote's
// no-modal case (zero questions) — a DRAFT has no questions only because nobody has groomed it yet,
// and a pending `feedback:` is still owed a groom (Rule 14). Zero questions also excludes a filled
// answer whose pair is still present: that answer is not folded in yet.
export function readyToAutoPromote(entry: Pick<IndexEntry, 'phase' | 'isDraft' | 'questions' | 'feedback'>): boolean {
  return entry.phase === 'new' && !entry.isDraft && entry.questions.length === 0 && entry.feedback.length === 0;
}

// What the decision reads off a board task: the predicate's fields plus the two texts whose change
// restarts the quiet period — the entry's index block and its task file.
export type ArmSubject = Pick<IndexEntry, 'phase' | 'isDraft' | 'questions' | 'feedback' | 'raw'> & { detailRaw: string };

export function armFingerprint(task: ArmSubject): string {
  return task.raw + '\u0000' + task.detailRaw;
}

export interface AutoPromoteArm {
  armedAt: number;
  // The fingerprint last seen, and when it was first seen (never earlier than `armedAt`). null until
  // the first evaluation — any first sighting starts the window.
  fingerprint: string | null;
  since: number;
}

export function createArm(now: number): AutoPromoteArm {
  return { armedAt: now, fingerprint: null, since: now };
}

export type HoldReason = 'draft' | 'questions' | 'feedback' | 'settling';
export type DropReason = 'gone' | 'left-new';

export type ArmDecision =
  | { kind: 'fire' }
  // `detail` is the human-readable half of the debug line; `wakeAt` (settling only) is when the
  // quiet period ends, so the controller can re-evaluate without waiting for another disk write.
  | { kind: 'hold'; reason: HoldReason; detail: string; wakeAt?: number }
  | { kind: 'drop'; reason: DropReason };

// One evaluation of one arm against the task as the board now shows it (undefined = not on the
// board). Returns the decision and the arm to keep. HOLD NEVER DISARMS (human decision 2,
// 2026-09-25): a re-groom that files new questions only holds the arm for another round. Only the
// task disappearing or leaving New drops it. A DRAFT -> New groom keeps the id and the implicit
// `phase: new`, so it is a fingerprint change (window restarts), never a drop.
export function evaluateArm(arm: AutoPromoteArm, task: ArmSubject | undefined, now: number): { decision: ArmDecision; arm: AutoPromoteArm } {
  if (!task) return { decision: { kind: 'drop', reason: 'gone' }, arm };
  if (task.phase !== 'new') return { decision: { kind: 'drop', reason: 'left-new' }, arm };
  const fp = armFingerprint(task);
  const next = fp === arm.fingerprint ? arm : { armedAt: arm.armedAt, fingerprint: fp, since: Math.max(now, arm.armedAt) };
  if (task.isDraft) return { decision: { kind: 'hold', reason: 'draft', detail: 'not groomed yet' }, arm: next };
  if (task.questions.length > 0) {
    const blank = task.questions.filter((q) => q.answer.trim().length === 0).length;
    const detail = blank > 0
      ? `${task.questions.length} question(s), ${blank} unanswered`
      : `${task.questions.length} question(s) answered, not folded in yet`;
    return { decision: { kind: 'hold', reason: 'questions', detail }, arm: next };
  }
  if (task.feedback.length > 0) {
    return { decision: { kind: 'hold', reason: 'feedback', detail: `${task.feedback.length} feedback item(s) not folded in yet` }, arm: next };
  }
  const wakeAt = next.since + AUTO_PROMOTE_SETTLE_MS;
  if (now < wakeAt) {
    return { decision: { kind: 'hold', reason: 'settling', detail: `ready, quiet for ${Math.ceil((wakeAt - now) / 1000)}s more`, wakeAt }, arm: next };
  }
  return { decision: { kind: 'fire' }, arm: next };
}
