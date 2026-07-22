// Data model for the LoopBoard. Pure types — no vscode imports.
//
// v2 storage split: an index entry (`.loopboard/TODO.md`) carries only the slim metadata the
// board needs to route/columnize a task; everything else lives in the per-task detail file
// (`.loopboard/tasks/<id>.md`). The composed `Task` view type stitches the two back together for
// view.ts / the webview.

export type Phase = 'new' | 'inprogress' | 'feedback' | 'backlog' | 'review' | 'done';

export type Model = 'opus' | 'sonnet' | 'fable';

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
