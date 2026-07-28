// Board -> lean webview payload, plus attention/badge computation. No vscode imports
// (takes primitives) so it stays easy to reason about.
import { Board, IndexEntry, Task, Phase, Model } from './model';

export interface WebTask {
  id: string;
  phase: Phase;
  isDraft: boolean;
  title: string;
  checked: boolean;
  hasDetailFile: boolean;
  owner: string | null;
  model: Model | null;
  groomer: Model | null;
  added: string | null;
  started: string | null;
  completed: string | null;
  worklog: string[];
  links: string[];
  dependsOn: { id: string; met: boolean }[];
  description: string;
  note: string | null;
  questions: { text: string; answer: string; answered: boolean }[];
  feedback: string | null;
  delivered: string | null;
  unparsedLines: string[] | null;
}

export interface LoopStatus {
  id: Model;
  name: string;
  running: boolean;
  hint: string;
}

export interface WebBoard {
  todoMissing?: boolean; // set by the controller; offers the scaffold button in the UI
  workspaceName: string;
  defaultWorkerModel: Model; // owns tasks with no model:; labels the board's Model select default
  defaultGroomerModel: Model; // grooms tasks with no groomer:; labels the draft Groom-with default
  models: Model[]; // enabled model slot ids, for the board/composer/draft model selects
  phases: Record<Phase, WebTask[]>;
  loops: LoopStatus[];
  badge: BadgeInfo;
  concurrency: ConcurrencyStatus;
}

// Board-wide view of the GLOBAL SINGLE-TASK LIMIT (LOOP.md Rule 2): at most one task may be
// In Progress across all models. The extension cannot enforce it (loops claim by writing the
// markdown), but it surfaces the state so a human sees when the limit is holding back prepared
// work — or being breached.
export interface ConcurrencyStatus {
  inProgress: { id: string; title: string; model: Model }[]; // tasks currently phase: inprogress (any model)
  skipped: { id: string; title: string }[]; // Backlog tasks a loop would start but the limit blocks
  breached: boolean; // more than one task In Progress at once — the limit is being violated
  message: string | null; // "Active Queue: <id> ($MODEL), ..." — only when >1 relevant task (Rule 2)
}

export interface BadgeInfo {
  count: number;
  newCount: number;
  feedbackUnanswered: number;
  reviewCount: number;
}

function doneIdSet(board: Board): Set<string> {
  const s = new Set<string>();
  for (const e of board.done) if (e.id) s.add(e.id);
  return s;
}

function taskToWeb(t: Task, doneIds: Set<string>): WebTask {
  return {
    id: t.id,
    phase: t.phase,
    isDraft: t.isDraft,
    title: t.title,
    checked: t.checked,
    hasDetailFile: t.hasDetailFile,
    owner: t.owner ?? null,
    model: t.model ?? null,
    groomer: t.groomer ?? null,
    added: t.added ?? null,
    started: t.started ?? null,
    completed: t.completed ?? null,
    worklog: t.worklog,
    links: t.links,
    dependsOn: t.dependsOn.map((id) => ({ id, met: doneIds.has(id) })),
    description: t.description ?? '',
    note: t.notes.length ? t.notes.join('\n') : null,
    questions: t.questions.map((q) => ({ text: q.text, answer: q.answer, answered: q.answer.trim().length > 0 })),
    feedback: t.feedback.length ? t.feedback.join('\n') : null,
    delivered: t.delivered ?? null,
    unparsedLines: t.unknownLines.length ? t.unknownLines.map((l) => l.replace(/^\s*- ?/, '').trim()) : null,
  };
}

// DONE.md entries are index-only (no detail composed): render them from the slim entry alone.
function doneEntryToWeb(e: IndexEntry, doneIds: Set<string>): WebTask {
  return {
    id: e.id,
    phase: 'done',
    isDraft: false,
    title: e.title,
    checked: e.checked,
    hasDetailFile: false,
    owner: null,
    model: e.model ?? null,
    groomer: e.groomer ?? null,
    added: null,
    started: null,
    completed: e.completed ?? null,
    worklog: [],
    links: [],
    dependsOn: [],
    description: '',
    note: null,
    questions: [],
    feedback: null,
    delivered: null,
    unparsedLines: e.unknownLines.length ? e.unknownLines.map((l) => l.replace(/^\s*- ?/, '').trim()) : null,
  };
}

export function computeBadge(board: Board): BadgeInfo {
  const newCount = board.tasks.filter((t) => t.phase === 'new').length; // incl DRAFTs
  const feedbackUnanswered = board.tasks.filter(
    (t) => t.phase === 'feedback' && t.questions.some((q) => q.answer.trim().length === 0)
  ).length;
  const reviewCount = board.tasks.filter((t) => t.phase === 'review').length;
  return {
    count: newCount + feedbackUnanswered + reviewCount,
    newCount,
    feedbackUnanswered,
    reviewCount,
  };
}

export function computeConcurrency(board: Board, defaultModel: Model): ConcurrencyStatus {
  const inProgress = board.tasks
    .filter((t) => t.phase === 'inprogress')
    .map((t) => ({ id: t.id, title: t.title, model: t.model ?? defaultModel }));
  // Prepared work a loop would pick up next: claimable Backlog tasks. Only "skipped" while
  // something is already In Progress (otherwise a loop is free to start them).
  const skipped =
    inProgress.length >= 1
      ? board.tasks.filter((t) => t.phase === 'backlog').map((t) => ({ id: t.id, title: t.title }))
      : [];
  const breached = inProgress.length > 1;
  let message: string | null = null;
  // Only worth surfacing when something else is queued behind the in-progress task(s) — a single
  // task executing with nothing waiting isn't an "Active Queue" worth a line.
  if (inProgress.length >= 1 && skipped.length >= 1) {
    message = `Active Queue: ${inProgress.map((t) => `${t.id} (${t.model})`).join(', ')}`;
  }
  return { inProgress, skipped, breached, message };
}

export function toWebviewBoard(
  board: Board,
  workspaceName: string,
  defaultWorkerModel: Model,
  loops: LoopStatus[],
  models: Model[] = [],
  defaultGroomerModel: Model = defaultWorkerModel
): WebBoard {
  const doneIds = doneIdSet(board);
  const phases: Record<Phase, WebTask[]> = {
    new: [],
    inprogress: [],
    feedback: [],
    backlog: [],
    review: [],
    done: [],
  };
  for (const t of board.tasks) {
    phases[t.phase].push(taskToWeb(t, doneIds));
  }
  phases.done = board.done.slice(0, 50).map((e) => doneEntryToWeb(e, doneIds));

  return {
    workspaceName,
    defaultWorkerModel,
    defaultGroomerModel,
    models,
    phases,
    loops,
    badge: computeBadge(board),
    concurrency: computeConcurrency(board, defaultWorkerModel),
  };
}
