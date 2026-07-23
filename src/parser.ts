// `.loopboard/TODO.md` / `.loopboard/DONE.md` index parser (tolerant, grammar v4).
// No vscode imports so it runs under `node --test`.
//
// ============================ TODO.md v4 GRAMMAR (index only) ============================
// A file is: <preamble>  <## Tasks section>
//   - preamble: everything above the "## Tasks" heading (title + prose pointing at LOOP.md).
//   - "## Tasks": a single flat section holding EVERY active task; a task's phase is its own
//     `- phase:` field, NOT a heading. Moving a task is a one-line field edit in place.
//   - "_(none)_" placeholders are structural (regenerated on write).
//   - HTML comment blocks and other stray section-level lines are preserved verbatim as extras.
//
// An index entry (starts at "- [ ] " or "- [x] "):
//   - [ ] <Title — single line>
//     - id: t-3f9a               (assigned on write if missing; identity anchor)
//     - phase: new | backlog | inprogress | feedback | review   (omitted for DRAFTs = new)
//     - model: opus | sonnet | fable        (optional)
//     - groomer: opus | sonnet | fable      (optional)
//     - question: ❓ <text>                   (repeatable)
//       - answer: <text or blank>
//   NOTHING else is canonical. owner/dates/worklog/link/depends on/description/note/feedback/
//   DELIVERED are NOT valid index keys in v4 — they land in unknownLines (preserved + flagged).
//   `completed:` is canonical in DONE.md entries only.
// ========================================================================================

import { IndexDoc, IndexEntry, Phase, Question, Model, BUILTIN_MODEL_IDS } from './model';

const TASKS_HEADING_RE = /^##\s+Tasks\b/i;
const TASK_RE = /^- \[([ xX])\]\s?(.*)$/;

const KNOWN_MODELS: Model[] = BUILTIN_MODEL_IDS;
const KNOWN_PHASES: Phase[] = ['new', 'inprogress', 'feedback', 'backlog', 'review', 'done'];

export const EDITABLE_PHASES: Phase[] = ['new', 'inprogress', 'feedback', 'backlog', 'review'];

function stripLeadingEmoji(s: string): string {
  return s.replace(/^\s*(❓|⚠️|⚠)\s*/, '').trim();
}

// Parse the lines of a single index entry block. `allowCompleted` is true only for DONE.md.
function parseEntryBlock(lines: string[], phase: Phase, allowCompleted: boolean): IndexEntry {
  const m = lines[0].match(TASK_RE);
  const checked = m ? m[1].toLowerCase() === 'x' : false;
  const title = (m ? m[2] : lines[0]).trim();

  const entry: IndexEntry = {
    id: '',
    title,
    phase,
    checked,
    isDraft: /^DRAFT:/i.test(title),
    questions: [],
    unknownLines: [],
    raw: lines.join('\n'),
  };

  const applySegment = (key: string, value: string): boolean => {
    const k = key.trim().toLowerCase();
    const v = value.trim();
    switch (k) {
      case 'id':
        entry.id = v;
        return true;
      case 'phase':
        if (KNOWN_PHASES.includes(v as Phase)) {
          entry.phase = v as Phase;
          return true;
        }
        return false;
      case 'model':
        if (KNOWN_MODELS.includes(v as Model)) entry.model = v as Model;
        else return false;
        return true;
      case 'groomer':
        if (KNOWN_MODELS.includes(v as Model)) entry.groomer = v as Model;
        else return false;
        return true;
      case 'completed':
        if (!allowCompleted) return false; // canonical in DONE.md only (§2.1)
        entry.completed = v;
        return true;
      case 'question':
        entry.questions.push({ text: stripLeadingEmoji(v), answer: '' });
        return true;
      case 'answer':
        if (entry.questions.length > 0) {
          entry.questions[entry.questions.length - 1].answer = v;
          return true;
        }
        return false;
      default:
        return false;
    }
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    // answer sub-sub-bullet: "    - answer: ..."
    const answerMatch = line.match(/^ {3,}- answer:\s?(.*)$/i);
    if (answerMatch) {
      applySegment('answer', answerMatch[1]);
      continue;
    }
    // Regular sub-bullet: "  - <key>: <value>"
    const bulletMatch = line.match(/^ {1,}- (.*)$/);
    if (bulletMatch) {
      const kv = bulletMatch[1].match(/^([A-Za-z][A-Za-z ]*?):\s?([\s\S]*)$/);
      if (kv && applySegment(kv[1], kv[2])) continue;
      entry.unknownLines.push(line);
      continue;
    }
    entry.unknownLines.push(line);
  }

  return entry;
}

// Split a section body into entry blocks and preserved extra lines (HTML comments etc).
function parseSection(bodyLines: string[], phase: Phase, allowCompleted: boolean): { entries: IndexEntry[]; extras: string } {
  const entries: IndexEntry[] = [];
  const extras: string[] = [];
  let i = 0;
  while (i < bodyLines.length) {
    const line = bodyLines[i];
    // HTML comment block: preserve verbatim, even if it contains task-like lines.
    if (line.includes('<!--')) {
      const block: string[] = [line];
      i++;
      while (i < bodyLines.length && !block[block.length - 1].includes('-->')) {
        block.push(bodyLines[i]);
        i++;
      }
      extras.push(...block);
      continue;
    }
    if (TASK_RE.test(line)) {
      const block: string[] = [line];
      i++;
      while (i < bodyLines.length && !TASK_RE.test(bodyLines[i]) && !bodyLines[i].includes('<!--')) {
        block.push(bodyLines[i]);
        i++;
      }
      while (block.length > 1 && (block[block.length - 1].trim() === '' || block[block.length - 1].trim() === '---')) {
        block.pop();
      }
      entries.push(parseEntryBlock(block, phase, allowCompleted));
    } else {
      const t = line.trim();
      if (t !== '' && t !== '---' && t !== '_(none)_') {
        extras.push(line);
      }
      i++;
    }
  }
  return { entries, extras: extras.join('\n') };
}

export function parseTodo(text: string): IndexDoc {
  const lines = text.split('\n');

  // Locate the single "## Tasks" heading; everything before it is preamble, everything after is
  // the flat task list.
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (TASKS_HEADING_RE.test(lines[i])) {
      headingIdx = i;
      break;
    }
  }

  if (headingIdx < 0) {
    const doc: IndexDoc = { preamble: text.replace(/\s+$/, ''), entries: [] };
    (doc as any).tasksHeading = undefined;
    (doc as any).tasksExtras = '';
    return doc;
  }

  const preamble = lines.slice(0, headingIdx).join('\n').replace(/\s+$/, '');
  const body = lines.slice(headingIdx + 1);
  const { entries, extras } = parseSection(body, 'new', false);

  const doc: IndexDoc = { preamble, entries };
  (doc as any).tasksHeading = lines[headingIdx];
  (doc as any).tasksExtras = extras;
  return doc;
}

// DONE.md is a flat list of accepted entries (newest first as written). `completed:` is canonical.
export function parseDone(text: string): IndexEntry[] {
  const lines = text.split('\n');
  let start = 0;
  while (start < lines.length && !TASK_RE.test(lines[start])) start++;
  const { entries } = parseSection(lines.slice(start), 'done', true);
  return entries;
}

export function getTasksHeading(doc: IndexDoc): string | undefined {
  return (doc as any).tasksHeading;
}
export function getTasksExtras(doc: IndexDoc): string {
  return (doc as any).tasksExtras ?? '';
}
