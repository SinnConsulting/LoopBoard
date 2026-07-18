// Data model for the LoopBoard. Pure types — no vscode imports.

export type Phase = 'new' | 'inprogress' | 'feedback' | 'backlog' | 'review' | 'done';

export type Model = 'opus' | 'sonnet' | 'fable';

export interface Question {
  text: string;
  answer: string;
}

export interface Task {
  id: string;
  title: string;
  phase: Phase;
  checked: boolean;
  isDraft: boolean;
  owner?: string;
  model?: Model;
  groomer?: Model; // which model grooms this task (absent = default model)
  added?: string;
  started?: string;
  promoted?: string;
  worklog: string[];
  links: string[];
  dependsOn: string[];
  description?: string;
  note?: string;
  questions: Question[];
  feedback?: string;
  delivered?: string;
  completed?: string; // DONE.md only
  unknownLines: string[]; // preserved verbatim, flagged in UI
  raw: string; // original block text, for conflict detection
}

export interface Board {
  preamble: string; // everything above the first phase heading (incl. Rules)
  tasks: Task[]; // all non-done tasks, in file order
  automation: string; // the Automation section text (after phases)
  done: Task[]; // from DONE.md, read-only, newest first
}
