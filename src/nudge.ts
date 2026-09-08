// Loop steering (t-068e): work out which loop — if any — a board change gives something to do,
// so the extension can nudge that one loop immediately instead of leaving the change to sit until
// the loop happens to re-read the board.
//
// Pure module: no vscode, no store, no IO. Delivery (pasting the line into a terminal) lives in
// terminals.ts; the decision of what to send where lives here and is unit-tested.
//
// A nudge is a HINT, never a work order. Loops re-read LOOP.md + TODO.md every pass regardless and
// follow the same rules; a missed nudge costs nothing and changes no correctness property.
import { IndexEntry, Task, Model, GROOMER_HOLD } from './model';

// Why a loop was nudged. Mirrors the Rules the loop will apply once it looks:
//   note     — an unprocessed `note:` sub-bullet (Rule 16)
//   groom    — a DRAFT waiting to be expanded into a story (Rule 14)
//   regroom  — a New task whose questions are ALL answered, not yet folded into the story (Rule 14)
//   backlog  — a claimable Backlog task (Rules 2/15)
//   answers  — a Feedback task whose every question now has an answer (Rule 10)
//   feedback — a Review task carrying an unaddressed `feedback:` sub-bullet (Rule 13)
export type NudgeReason = 'note' | 'groom' | 'regroom' | 'backlog' | 'answers' | 'feedback';

// What the loop is told about one task. There is deliberately NO `title` field (t-f8bd): the nudge
// names the task by id and the FIELDS that moved, never task text. Dropping the field — rather
// than merely not printing it — is what stops a later edit re-introducing the leak.
export interface NudgeItem {
  taskId: string;
  reason: NudgeReason;
  changes: string[]; // content-free field descriptors, see describeChanges
}

export interface NudgeRoute {
  model: Model;
  items: NudgeItem[];
}

export interface NudgeDefaults {
  worker: Model;  // the loop that owns a task with no `model:`
  groomer: Model; // the loop that grooms a task with no `groomer:`
}

// Which loop owns this entry right now, and what it would do with it — or null when the entry
// gives no loop anything to do (nothing pending, on hold, or already being worked).
//
// The split is the one Rules 14/15 draw: New/DRAFT is GROOMING work routed by `groomer:`;
// everything from Backlog onward is WORKER work routed by `model:`. Steering never edits either
// field — routing reads them, only a human moves work between loops.
export function routeEntry(entry: IndexEntry, defaults: NudgeDefaults): { model: Model; reason: NudgeReason } | null {
  const answered = (q: { answer: string }) => q.answer.trim().length > 0;

  if (entry.isDraft || entry.phase === 'new') {
    // `groomer: none` = ON HOLD: the task belongs to NO loop until a human changes it (Rule 14),
    // so it is never nudged, whatever else changed on it.
    if (entry.groomer === GROOMER_HOLD) return null;
    const model = (entry.groomer as Model | undefined) ?? defaults.groomer;
    if (entry.notes.length > 0) return { model, reason: 'note' };
    // Questions must be FULLY answered before the change is pushed into a loop: one blank answer
    // means the human is still filling the form in, and a re-groom on a half-answered story would
    // fold in half a decision and re-ask the rest. Mirrors the Rule 10 gate Feedback already uses.
    if (entry.questions.length > 0 && entry.questions.every(answered)) return { model, reason: 'regroom' };
    if (entry.isDraft) return { model, reason: 'groom' };
    // A groomed New task with open questions is waiting on the HUMAN, not on a loop.
    return null;
  }

  const model = entry.model ?? defaults.worker;
  // A note outranks the phase-specific reasons: it is an explicit human instruction (Rule 16).
  if (entry.notes.length > 0) return { model, reason: 'note' };
  if (entry.phase === 'backlog') return { model, reason: 'backlog' };
  if (entry.phase === 'feedback') {
    // Rule 10: resume only when EVERY question has an answer. One blank answer = still parked.
    if (entry.questions.length > 0 && entry.questions.every(answered)) return { model, reason: 'answers' };
    return null;
  }
  if (entry.phase === 'review' && entry.feedback.length > 0) return { model, reason: 'feedback' };
  // In Progress belongs to a worker that is already on it; Review with no feedback awaits the
  // human's [x].
  return null;
}

// True when this entry's content moved since the previous board. `rev:` is the writer-managed
// change marker (Rule 17) and is the primary signal; `raw` is the fallback for a pre-existing
// tracker whose entries carry no `rev:` at all.
function changed(prev: IndexEntry, next: IndexEntry): boolean {
  return (prev.rev ?? 0) !== (next.rev ?? 0) || prev.raw !== next.raw;
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : `${n} ${many}`);

// What moved on this task, as short descriptors carrying NO task text (t-f8bd). Free text is never
// echoed — title, question, answer, note, feedback, description, worklog, delivered. Metadata ENUM
// values (`phase`/`model`/`groomer`) are board state, not task content, and ARE named verbatim so
// the loop is saved a lookup; counts and 1-based question positions carry no text either.
//
// Both boards already carry index AND detail content (store.load composes every task on every
// refresh), so this is a pure computation over data in hand.
export function describeChanges(prev: Task | undefined, next: Task): string[] {
  if (!prev) return ['new entry'];
  const out: string[] = [];

  if (prev.title !== next.title) out.push('title edited');
  if (prev.phase !== next.phase) out.push(`phase → ${next.phase}`);
  if (prev.model !== next.model) out.push(`model → ${next.model ?? 'default'}`);
  if (prev.groomer !== next.groomer) out.push(`groomer → ${next.groomer ?? 'default'}`);
  if (prev.checked !== next.checked) out.push(next.checked ? 'ticked' : 'unticked');

  const pq = prev.questions;
  const nq = next.questions;
  if (nq.length > pq.length) out.push(`${plural(nq.length - pq.length, 'question')} added`);
  if (nq.length < pq.length) out.push(`${plural(pq.length - nq.length, 'question')} removed`);
  // Question-level descriptors are POSITIONAL and 1-based, in index order: pinpointing which
  // question moved without quoting it is the whole point of the story.
  for (let i = 0; i < Math.min(pq.length, nq.length); i++) {
    const at = `(question ${i + 1})`;
    const was = pq[i].answer.trim().length > 0;
    const is = nq[i].answer.trim().length > 0;
    if (!was && is) out.push(`answer filled ${at}`);
    else if (was && !is) out.push(`answer cleared ${at}`);
    else if (pq[i].answer !== nq[i].answer) out.push(`answer edited ${at}`);
    if (nq[i].suggestions.length > pq[i].suggestions.length) out.push(`suggestions added ${at}`);
    else if (nq[i].suggestions.length < pq[i].suggestions.length) out.push(`suggestions removed ${at}`);
  }

  for (const [one, many, before, after] of [
    ['note', 'notes', prev.notes, next.notes],
    ['feedback', 'feedback', prev.feedback, next.feedback],
  ] as [string, string, string[], string[]][]) {
    if (after.length > before.length) out.push(`${plural(after.length - before.length, one, many)} added`);
    else if (after.length < before.length) out.push(`${plural(before.length - after.length, one, many)} removed`);
  }

  // Detail changes are named per SECTION, never collapsed to a bare "detail changed".
  if ((prev.description ?? '') !== (next.description ?? '')) out.push('description edited');
  if ((prev.delivered ?? '') !== (next.delivered ?? '')) out.push('delivered edited');
  if (next.worklog.length > prev.worklog.length) out.push('worklog appended');
  else if (prev.worklog.join('\n') !== next.worklog.join('\n')) out.push('worklog edited');
  for (const key of ['added', 'started', 'promoted', 'completed'] as const) {
    if ((prev[key] ?? '') !== (next[key] ?? '')) out.push(`meta ${key} ${next[key] ? 'set' : 'cleared'}`);
  }
  if (prev.links.join(',') !== next.links.join(',')) out.push(`meta link ${next.links.length ? 'set' : 'cleared'}`);
  if (prev.dependsOn.join(',') !== next.dependsOn.join(',')) out.push('depends on edited');

  // `rev:` moved but no field above differs — a canonicalizing rewrite, or edits coalesced into one
  // refresh. The nudge is still sent (never dropped); the loop falls back to its ordinary re-read.
  return out.length ? out : ['changed'];
}

// Fold newly routed items into the ones held for a downed terminal, de-duped by task id: the newest
// reason wins, but the change descriptors UNION so nothing a loop missed while it was down is lost.
export function mergeNudgeItems(held: NudgeItem[], incoming: NudgeItem[]): NudgeItem[] {
  const out = held.map((h) => ({ ...h, changes: [...h.changes] }));
  for (const item of incoming) {
    const existing = out.find((h) => h.taskId === item.taskId);
    if (!existing) {
      out.push({ ...item, changes: [...item.changes] });
      continue;
    }
    existing.reason = item.reason;
    for (const c of item.changes) if (!existing.changes.includes(c)) existing.changes.push(c);
  }
  return out;
}

// Route every CHANGED entry to the one loop that now has something to do, grouped per loop.
//
// `prev === undefined` (the first board load of a session) yields nothing: everything would look
// new and every loop would be nudged about a board it is about to read anyway.
export function computeNudges(
  prev: Task[] | undefined,
  next: Task[],
  defaults: NudgeDefaults,
): NudgeRoute[] {
  if (!prev) return [];
  const before = new Map(prev.map((e) => [e.id, e]));
  // Rule 2's GLOBAL SINGLE-TASK LIMIT: while any task is In Progress board-wide, no loop may claim
  // a Backlog task, so a "claim this" nudge would be an instruction to do nothing. Grooming and
  // notes are unaffected — those never set `inprogress`.
  const busy = next.some((e) => e.phase === 'inprogress');
  const routes = new Map<Model, NudgeItem[]>();

  for (const entry of next) {
    const was = before.get(entry.id);
    if (was && !changed(was, entry)) continue;
    const route = routeEntry(entry, defaults);
    if (!route) continue;
    if (route.reason === 'backlog' && busy) continue;
    const items = routes.get(route.model) ?? [];
    items.push({ taskId: entry.id, reason: route.reason, changes: describeChanges(was, entry) });
    routes.set(route.model, items);
  }

  return [...routes.entries()].map(([model, items]) => ({ model, items }));
}

const REASON_TEXT: Record<NudgeReason, string> = {
  note: 'has a note to apply',
  groom: 'is a draft to groom',
  regroom: 'has answers to fold in',
  backlog: 'is claimable in Backlog',
  answers: 'has all its questions answered',
  feedback: 'has review feedback to address',
};

// How many tasks a single nudge names before it summarises the rest. The line is pasted into a
// REPL input, so it stays short and on ONE line — a newline would submit it mid-sentence.
const MAX_NAMED = 5;

// The nudge line itself. It names the SPECIFIC tasks by id and which fields moved (so the loop
// skips a rediscovery scan and the debug log shows exactly what was routed where) and restates that
// the rules still gate the work. The reason phrase says what the loop MAY do, the change list says
// where to look; neither carries task text.
export function formatNudge(items: NudgeItem[]): string {
  const named = items.slice(0, MAX_NAMED)
    .map((i) => `${i.taskId}: ${(i.changes.length ? i.changes : ['changed']).join(', ')} — ${REASON_TEXT[i.reason]}`)
    .join('; ');
  const rest = items.length > MAX_NAMED ? `, and ${items.length - MAX_NAMED} more` : '';
  return `LoopBoard: the board changed — ${named}${rest}. Re-read .loopboard/LOOP.md and .loopboard/TODO.md and act per the rules as on any pass.`
    .replace(/\s+/g, ' ');
}
