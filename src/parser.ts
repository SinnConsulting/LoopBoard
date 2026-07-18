// TODO.md / DONE.md parser (tolerant) — no vscode imports so it runs under `node --test`.
//
// ============================ TODO.md v3 GRAMMAR ============================
// A file is: <preamble>  <## Tasks section>  <automation>
//   - preamble: everything above the first section heading (title, Workflow, Rules).
//   - "## Tasks": a single flat section holding EVERY task; a task's phase is its own
//     `- phase:` field (below), NOT which heading it sits under. Moving a task is a one-line
//     field edit in place — no cut/paste between sections, so a task can't be lost mid-move.
//   - automation: from "## Automation" to EOF, preserved verbatim.
//   - "---" dividers and "_(none)_" placeholders are structural (regenerated on write).
//   - HTML comment blocks and other stray section-level lines are preserved verbatim as extras.
//   - BACKWARD COMPAT: the legacy per-phase headings ("## New", "## In Progress", "## Feedback",
//     "## Backlog", "## Review") are still parsed — a task under one gets that phase unless it
//     carries an explicit `phase:` field. The writer always emits the flat "## Tasks" form.
//
// A task block (starts at "- [ ] " or "- [x] "):
//   - [ ] <Title — single line>
//     - id: t-3f9a               (assigned on write if missing; identity anchor)
//     - phase: new | backlog | inprogress | feedback | review   (omitted for DRAFTs = new)
//     - owner: @claude | unassigned
//     - model: opus | sonnet | fable        (optional)
//     - added: YYYY-MM-DD
//     - started: YYYY-MM-DD                  (optional)
//     - promoted: YYYY-MM-DD                 (optional)
//     - worklog: <date>[, <date>]            (optional)
//     - link: <url>[, <url>]                 (optional)
//     - depends on: t-xxxx[, t-yyyy]         (optional)
//     - description: <free text; continuation lines indented 4 spaces>
//     - note: <human instruction to the worker>   (optional)
//     - question: ❓ <text>                   (repeatable)
//       - answer: <text or blank>
//     - feedback: ⚠️ <text>                   (Review only, optional)
//     - DELIVERED: <text; may wrap onto further 4-space-indented lines>   (Review only)
//     - completed: YYYY-MM-DD                 (DONE.md only)
//   One key per line, fixed order. Unknown keys/lines are preserved verbatim at the
//   end of the task (unknownLines) and flagged in the UI.
//   Tolerant extras: a sub-bullet may pack several "key: value" segments separated by
//   " · " (v1 style); each segment is parsed independently.
// ===========================================================================

import { Board, Task, Phase, Question, Model } from './model';

const PHASE_HEADINGS: { re: RegExp; phase: Phase }[] = [
  { re: /^##\s+New\b/i, phase: 'new' },
  { re: /^##\s+In Progress\b/i, phase: 'inprogress' },
  { re: /^##\s+Feedback\b/i, phase: 'feedback' },
  { re: /^##\s+Backlog\b/i, phase: 'backlog' },
  { re: /^##\s+Review\b/i, phase: 'review' },
];
const AUTOMATION_RE = /^##\s+Automation\b/i;
// v3 flat format: a single "## Tasks" section holds every task; each task's phase is a `- phase:`
// field rather than being implied by which heading it sits under. The old per-phase headings above
// are still recognized so old files keep parsing (backward compatible).
const TASKS_HEADING_RE = /^##\s+Tasks\b/i;
const TASK_RE = /^- \[([ xX])\]\s?(.*)$/;

const KNOWN_MODELS: Model[] = ['opus', 'sonnet', 'fable'];
const KNOWN_PHASES: Phase[] = ['new', 'inprogress', 'feedback', 'backlog', 'review', 'done'];

export const EDITABLE_PHASES: Phase[] = ['new', 'inprogress', 'feedback', 'backlog', 'review'];

function stripLeadingEmoji(s: string): string {
  return s.replace(/^\s*(❓|⚠️|⚠)\s*/, '').trim();
}

function splitList(v: string): string[] {
  return v
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

// Parse the lines of a single task block into a Task.
function parseTaskBlock(lines: string[], phase: Phase): Task {
  const m = lines[0].match(TASK_RE);
  const checked = m ? m[1].toLowerCase() === 'x' : false;
  const title = (m ? m[2] : lines[0]).trim();

  const task: Task = {
    id: '',
    title,
    phase,
    checked,
    isDraft: /^DRAFT:/i.test(title),
    worklog: [],
    links: [],
    dependsOn: [],
    questions: [],
    unknownLines: [],
    raw: lines.join('\n'),
  };

  // Handlers keyed by lowercased key name.
  const applySegment = (key: string, value: string): boolean => {
    const k = key.trim().toLowerCase();
    const v = value.trim();
    switch (k) {
      case 'id':
        task.id = v;
        return true;
      case 'phase':
        if (KNOWN_PHASES.includes(v as Phase)) {
          task.phase = v as Phase;
          return true;
        }
        return false;
      case 'owner':
        task.owner = v;
        return true;
      case 'model':
        if (KNOWN_MODELS.includes(v as Model)) task.model = v as Model;
        else return false;
        return true;
      case 'groomer':
        if (KNOWN_MODELS.includes(v as Model)) task.groomer = v as Model;
        else return false;
        return true;
      case 'added':
        task.added = v;
        return true;
      case 'started':
        task.started = v;
        return true;
      case 'promoted':
        task.promoted = v;
        return true;
      case 'completed':
        task.completed = v;
        return true;
      case 'worklog':
        task.worklog = splitList(v);
        return true;
      case 'link':
        task.links = splitList(v);
        return true;
      case 'depends on':
        task.dependsOn = splitList(v);
        return true;
      case 'description':
        task.description = v;
        return true;
      case 'note':
        task.note = v;
        return true;
      case 'feedback':
        task.feedback = stripLeadingEmoji(v);
        return true;
      case 'delivered':
        task.delivered = v;
        return true;
      case 'question':
        task.questions.push({ text: stripLeadingEmoji(v), answer: '' });
        return true;
      case 'answer':
        if (task.questions.length > 0) {
          task.questions[task.questions.length - 1].answer = v;
          return true;
        }
        return false;
      default:
        return false;
    }
  };

  let lastKey: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      lastKey = null;
      continue;
    }
    // Description/DELIVERED continuation: indented 4+ spaces, not a sub-bullet.
    if (
      (lastKey === 'description' || lastKey === 'delivered') &&
      /^ {4,}\S/.test(line) &&
      !/^ {4,}- /.test(line)
    ) {
      if (lastKey === 'description') task.description = (task.description ?? '') + '\n' + line.trim();
      else task.delivered = (task.delivered ?? '') + '\n' + line.trim();
      continue;
    }
    // answer sub-sub-bullet: "    - answer: ..."
    const answerMatch = line.match(/^ {3,}- answer:\s?(.*)$/i);
    if (answerMatch) {
      applySegment('answer', answerMatch[1]);
      lastKey = 'answer';
      continue;
    }
    // Regular sub-bullet: "  - <content>"
    const bulletMatch = line.match(/^ {1,}- (.*)$/);
    if (bulletMatch) {
      const content = bulletMatch[1];
      // Split into " · "-separated segments (v1 packed metadata).
      const segments = content.split('·').map((s) => s.trim());
      let allParsed = true;
      let handledAsKey = false;
      for (const seg of segments) {
        const kv = seg.match(/^([A-Za-z][A-Za-z ]*?):\s?([\s\S]*)$/);
        if (kv && applySegment(kv[1], kv[2])) {
          handledAsKey = true;
          lastKey = kv[1].trim().toLowerCase();
        } else {
          allParsed = false;
        }
      }
      if (!handledAsKey || !allParsed) {
        // Preserve the whole original line verbatim if anything was unrecognized.
        task.unknownLines.push(line);
        if (!handledAsKey) lastKey = null;
      }
      continue;
    }
    // Anything else under a task: preserve verbatim.
    task.unknownLines.push(line);
    lastKey = null;
  }

  return task;
}

// Split a section body into task blocks and preserved extra lines (HTML comments etc).
function parseSection(bodyLines: string[], phase: Phase): { tasks: Task[]; extras: string } {
  const tasks: Task[] = [];
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
      // Trim trailing blank lines / dividers from the block.
      while (block.length > 1 && (block[block.length - 1].trim() === '' || block[block.length - 1].trim() === '---')) {
        block.pop();
      }
      tasks.push(parseTaskBlock(block, phase));
    } else {
      const t = line.trim();
      if (t !== '' && t !== '---' && t !== '_(none)_') {
        extras.push(line);
      }
      i++;
    }
  }
  return { tasks, extras: extras.join('\n') };
}

export function parseTodo(text: string): Board {
  const lines = text.split('\n');

  // Locate section headings: the flat "## Tasks" section, the legacy per-phase headings (backward
  // compat), and "## Automation".
  const marks: { index: number; phase?: Phase; tasks?: boolean; automation?: boolean }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const hit = PHASE_HEADINGS.find((p) => p.re.test(lines[i]));
    if (hit) {
      marks.push({ index: i, phase: hit.phase });
      continue;
    }
    if (TASKS_HEADING_RE.test(lines[i])) {
      marks.push({ index: i, tasks: true });
      continue;
    }
    if (AUTOMATION_RE.test(lines[i])) {
      marks.push({ index: i, automation: true });
    }
  }

  const firstMark = marks.length > 0 ? marks[0].index : lines.length;
  const preamble = lines.slice(0, firstMark).join('\n').replace(/\s+$/, '');

  const board: Board = {
    preamble,
    tasks: [],
    automation: '',
    done: [],
  };
  // Structural extras (HTML-comment templates etc.) are consolidated into one blob for the flat
  // "## Tasks" section; the heading text (if the file already uses "## Tasks") round-trips verbatim.
  let tasksHeading: string | undefined;
  const extrasAccum: string[] = [];

  for (let mi = 0; mi < marks.length; mi++) {
    const mark = marks[mi];
    const start = mark.index;
    const end = mi + 1 < marks.length ? marks[mi + 1].index : lines.length;
    if (mark.automation) {
      board.automation = lines.slice(start, end).join('\n').replace(/\s+$/, '');
      continue;
    }
    const body = lines.slice(start + 1, end);
    // Flat "## Tasks": phase comes from each task's `phase:` field (default 'new'). Legacy heading:
    // phase is implied by the heading but a per-task `phase:` field still wins (parseTaskBlock).
    const sectionPhase: Phase = mark.tasks ? 'new' : mark.phase!;
    if (mark.tasks) tasksHeading = lines[start];
    const { tasks, extras } = parseSection(body, sectionPhase);
    board.tasks.push(...tasks);
    if (extras) extrasAccum.push(extras);
  }

  (board as any).tasksHeading = tasksHeading;
  // Join with a single newline: parseSection re-joins extras with '\n' (blank lines between comment
  // blocks are structural and dropped), so consolidating with '\n' keeps serialize a fixpoint.
  (board as any).tasksExtras = extrasAccum.join('\n');
  return board;
}

// DONE.md is a flat list of completed tasks (newest first as written).
export function parseDone(text: string): Task[] {
  const lines = text.split('\n');
  // Skip any leading heading/preamble; parse from the first task line onward.
  let start = 0;
  while (start < lines.length && !TASK_RE.test(lines[start])) start++;
  const { tasks } = parseSection(lines.slice(start), 'done');
  return tasks;
}

export function getTasksHeading(board: Board): string | undefined {
  return (board as any).tasksHeading;
}
export function getTasksExtras(board: Board): string {
  return (board as any).tasksExtras ?? '';
}
