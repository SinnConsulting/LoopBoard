// Board -> canonical markdown (strict). Pure — no vscode imports.
// Assigns missing ids; preserves unknown lines and section extras verbatim.

import { Board, Task } from './model';
import { getTasksHeading, getTasksExtras } from './parser';

const DEFAULT_TASKS_HEADING = '## Tasks';

const usedIds = new Set<string>();

export function assignId(existing: Set<string>): string {
  let id = '';
  do {
    id = 't-' + Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  } while (existing.has(id));
  existing.add(id);
  return id;
}

function ensureIds(tasks: Task[]): void {
  const ids = new Set<string>();
  for (const t of tasks) if (t.id) ids.add(t.id);
  for (const t of tasks) if (!t.id) t.id = assignId(ids);
}

// Serialize one task block. `phase` controls which optional blocks are emitted.
export function serializeTask(task: Task): string[] {
  const box = task.checked ? '[x]' : '[ ]';
  const out: string[] = [`- ${box} ${task.title}`];

  if (task.id) out.push(`  - id: ${task.id}`);

  if (task.isDraft) {
    if (task.model) out.push(`  - model: ${task.model}`);
    if (task.groomer) out.push(`  - groomer: ${task.groomer}`);
    if (task.added) out.push(`  - added: ${task.added}`);
    for (const u of task.unknownLines) out.push(u);
    return out;
  }

  out.push(`  - phase: ${task.phase}`);
  if (task.owner) out.push(`  - owner: ${task.owner}`);
  if (task.model) out.push(`  - model: ${task.model}`);
  if (task.groomer) out.push(`  - groomer: ${task.groomer}`);
  if (task.added) out.push(`  - added: ${task.added}`);
  if (task.started) out.push(`  - started: ${task.started}`);
  if (task.promoted) out.push(`  - promoted: ${task.promoted}`);
  if (task.completed) out.push(`  - completed: ${task.completed}`);
  if (task.worklog.length) out.push(`  - worklog: ${task.worklog.join(', ')}`);
  if (task.links.length) out.push(`  - link: ${task.links.join(', ')}`);
  if (task.dependsOn.length) out.push(`  - depends on: ${task.dependsOn.join(', ')}`);
  if (task.description) {
    const [first, ...rest] = task.description.split('\n');
    out.push(`  - description: ${first}`);
    for (const line of rest) out.push(`    ${line}`);
  }
  if (task.note) out.push(`  - note: ${task.note}`);
  for (const q of task.questions) {
    out.push(`  - question: ❓ ${q.text}`);
    out.push(`    - answer: ${q.answer}`.replace(/\s+$/, ''));
  }
  if (task.feedback) out.push(`  - feedback: ⚠️ ${task.feedback}`);
  if (task.delivered) {
    const [first, ...rest] = task.delivered.split('\n');
    out.push(`  - DELIVERED: ${first}`);
    for (const line of rest) out.push(`    ${line}`);
  }
  for (const u of task.unknownLines) out.push(u);
  return out;
}

export function serializeTodo(board: Board): string {
  ensureIds(board.tasks);
  const heading = getTasksHeading(board) ?? DEFAULT_TASKS_HEADING;
  const extras = getTasksExtras(board);

  const parts: string[] = [];
  parts.push(board.preamble.replace(/\s+$/, ''));

  // One flat section: every task in file order, each carrying its own `phase:` field.
  const section: string[] = [heading, ''];
  if (board.tasks.length === 0) {
    section.push('_(none)_');
  } else {
    section.push(board.tasks.map((t) => serializeTask(t).join('\n')).join('\n\n'));
  }
  if (extras) {
    section.push('');
    section.push(extras);
  }
  parts.push(section.join('\n'));
  parts.push('---');

  if (board.automation) {
    parts.push(board.automation.replace(/\s+$/, ''));
  }

  return parts.join('\n\n').replace(/\s+$/, '') + '\n';
}

export function serializeDone(tasks: Task[]): string {
  const ids = new Set<string>();
  for (const t of tasks) if (t.id) ids.add(t.id);
  for (const t of tasks) if (!t.id) t.id = assignId(ids);
  const body = tasks.map((t) => serializeTask(t).join('\n')).join('\n\n');
  return `# DONE\n\nAccepted tasks, newest first.\n\n${body}\n`;
}

// silence unused warning for the shared id set helper
void usedIds;
