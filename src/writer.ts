// IndexDoc -> canonical markdown (strict), grammar v4. Pure — no vscode imports.
// Assigns missing ids; preserves unknown lines and section extras verbatim.

import { IndexDoc, IndexEntry } from './model';
import { getTasksHeading, getTasksExtras } from './parser';

const DEFAULT_TASKS_HEADING = '## Tasks';

export function assignId(existing: Set<string>): string {
  let id = '';
  do {
    id = 't-' + Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  } while (existing.has(id));
  existing.add(id);
  return id;
}

function ensureIds(entries: IndexEntry[]): void {
  const ids = new Set<string>();
  for (const e of entries) if (e.id) ids.add(e.id);
  for (const e of entries) if (!e.id) e.id = assignId(ids);
}

// Serialize one active index entry (TODO.md). Fixed key order per §2.1.
export function serializeEntry(entry: IndexEntry): string[] {
  const box = entry.checked ? '[x]' : '[ ]';
  const out: string[] = [`- ${box} ${entry.title}`];

  if (entry.id) out.push(`  - id: ${entry.id}`);

  if (entry.isDraft) {
    // Drafts carry no phase line (implicitly new); only optional model/groomer.
    if (entry.model) out.push(`  - model: ${entry.model}`);
    if (entry.groomer) out.push(`  - groomer: ${entry.groomer}`);
    for (const u of entry.unknownLines) out.push(u);
    return out;
  }

  out.push(`  - phase: ${entry.phase}`);
  if (entry.model) out.push(`  - model: ${entry.model}`);
  if (entry.groomer) out.push(`  - groomer: ${entry.groomer}`);
  for (const q of entry.questions) {
    out.push(`  - question: ❓ ${q.text}`);
    out.push(`    - answer: ${q.answer}`.replace(/\s+$/, ''));
  }
  for (const u of entry.unknownLines) out.push(u);
  return out;
}

// Serialize one accepted entry (DONE.md). Fixed key order per §2.3: id, model, groomer, completed.
function serializeDoneEntry(entry: IndexEntry): string[] {
  const out: string[] = [`- [x] ${entry.title}`];
  if (entry.id) out.push(`  - id: ${entry.id}`);
  if (entry.model) out.push(`  - model: ${entry.model}`);
  if (entry.groomer) out.push(`  - groomer: ${entry.groomer}`);
  if (entry.completed) out.push(`  - completed: ${entry.completed}`);
  for (const u of entry.unknownLines) out.push(u);
  return out;
}

export function serializeTodo(doc: IndexDoc): string {
  ensureIds(doc.entries);
  const heading = getTasksHeading(doc) ?? DEFAULT_TASKS_HEADING;
  const extras = getTasksExtras(doc);

  const parts: string[] = [];
  parts.push(doc.preamble.replace(/\s+$/, ''));

  const section: string[] = [heading, ''];
  if (doc.entries.length === 0) {
    section.push('_(none)_');
  } else {
    section.push(doc.entries.map((e) => serializeEntry(e).join('\n')).join('\n\n'));
  }
  if (extras) {
    section.push('');
    section.push(extras);
  }
  parts.push(section.join('\n'));

  return parts.join('\n\n').replace(/\s+$/, '') + '\n';
}

export function serializeDone(entries: IndexEntry[]): string {
  const ids = new Set<string>();
  for (const e of entries) if (e.id) ids.add(e.id);
  for (const e of entries) if (!e.id) e.id = assignId(ids);
  const body = entries.map((e) => serializeDoneEntry(e).join('\n')).join('\n\n');
  return `# DONE\n\nAccepted tasks, newest first. Detail remains in tasks/<id>.md.\n\n## Tasks\n\n${body}\n`;
}
