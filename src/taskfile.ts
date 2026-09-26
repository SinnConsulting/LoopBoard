// `.loopboard/tasks/<id>.md` parser/writer (tolerant, §2.2). Pure — no vscode imports so it runs
// under `node --test`.
//
// Pure content, no frontmatter: the index owns title/phase/model/groomer/questions/feedback.
// Fixed headings (Meta, Problem, Description, Goals, Worklog, Delivered), all optional; the writer
// emits canonical order, omits empty sections, and rewrites the H1 from the index title. Problem
// and Goals (t-2191) are groomer-owned free markdown — the parser validates NEITHER their length
// nor their bullet shape, so a Goals section written as prose still round-trips; "short and
// factual" / "a bullet list" is LOOP.md rule text, not a grammar. Unknown headings/keys
// (including a legacy `## Feedback` section — feedback now lives in the index, not migrated) are
// preserved verbatim and flagged. Inside Problem, Description and Goals an unknown `## ` line is
// story text and stays in place; only a known heading ends those three (t-c4d1, not fence-aware).
// Fixpoint: serializeTaskFile(parseTaskFile(x)) is idempotent.

import { TaskDetail } from './model';

const META_KEYS = ['added', 'started', 'promoted', 'completed', 'link', 'depends on'];
// Removed key (t-33cb): a stale `- owner:` line from a pre-removal task file is recognized and
// silently dropped on parse, never landing in unknownLines/re-emitted — so it can't reintroduce
// the flagged "unparsed line" chip or get relocated to the bottom of the file.
const DROPPED_META_KEYS = ['owner'];

function splitList(v: string): string[] {
  return v
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function emptyDetail(raw: string): TaskDetail {
  return {
    worklog: [],
    links: [],
    dependsOn: [],
    unknownLines: [],
    raw,
  };
}

// Drop leading/trailing blank lines from a section body.
function trimBlankEdges(lines: string[]): string[] {
  const out = lines.slice();
  while (out.length && out[0].trim() === '') out.shift();
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out;
}

// The six headings the writer emits, and the three free-markdown story sections among them.
const KNOWN_SECTIONS = ['meta', 'problem', 'description', 'goals', 'worklog', 'delivered'];
const STORY_SECTIONS = ['problem', 'description', 'goals'];

// `## Goals `, `##  goals` → `goals`: case-insensitive, surrounding spaces ignored.
function headingName(line: string): string {
  return line.replace(/^##\s+/, '').trim().toLowerCase();
}

// The New Story composer's copy for a fresh draft's ## Description (t-c4d1). The draft title is the
// text flattened to one line; a text with more than one line is also kept here verbatim, so a
// pasted list or paragraph break survives. Pending-attachment placeholders
// (`[name](loopboard-pending:N)`, only ever rewritten in the title) and `.loopboard/cache/` links
// (they stay in the title, and a second copy would draw a second chip) are stripped; blank edge
// lines are trimmed, inner blank lines and indentation stay. Returns undefined — no copy — when
// what is left is a single line (the title already says it) or nothing at all.
export function draftDescription(text: string): string | undefined {
  const stripped = String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]*\[[^\]\n]*\]\(loopboard-pending:[^)\s]*\)/g, '')
    .replace(/[ \t]*\[[^\]\n]*\]\(\.loopboard\/cache\/[^)\s]*\)/g, '');
  const lines = trimBlankEdges(stripped.split('\n'));
  return lines.length > 1 ? lines.join('\n') : undefined;
}

export function parseTaskFile(text: string): TaskDetail {
  const detail = emptyDetail(text);
  const lines = text.split('\n');

  // Group into sections keyed by "## Heading"; everything before the first heading (the H1) is
  // display-only and dropped (the index title wins on serialize).
  let i = 0;
  while (i < lines.length && !/^##\s+/.test(lines[i])) i++;

  while (i < lines.length) {
    const heading = lines[i];
    const name = headingName(heading);
    const body: string[] = [];
    // The three story sections are free markdown (t-c4d1): a `## ` line inside them is story text,
    // and only one of the six known headings ends them. Every other section ends at any `## `.
    const story = STORY_SECTIONS.includes(name);
    i++;
    while (i < lines.length && !(/^##\s+/.test(lines[i]) && (!story || KNOWN_SECTIONS.includes(headingName(lines[i]))))) {
      body.push(lines[i]);
      i++;
    }

    switch (name) {
      case 'meta': {
        for (const line of body) {
          if (line.trim() === '') continue;
          const kv = line.match(/^\s*-\s+([A-Za-z][A-Za-z ]*?):\s?([\s\S]*)$/);
          const key = kv ? kv[1].trim().toLowerCase() : '';
          if (kv && DROPPED_META_KEYS.includes(key)) {
            // silently discarded — see DROPPED_META_KEYS
          } else if (kv && META_KEYS.includes(key)) {
            const v = kv[2].trim();
            switch (key) {
              case 'added': detail.added = v; break;
              case 'started': detail.started = v; break;
              case 'promoted': detail.promoted = v; break;
              case 'completed': detail.completed = v; break;
              case 'link': detail.links = splitList(v); break;
              case 'depends on': detail.dependsOn = splitList(v); break;
            }
          } else {
            detail.unknownLines.push(line);
          }
        }
        break;
      }
      case 'problem': {
        const b = trimBlankEdges(body);
        if (b.length) detail.problem = b.join('\n');
        break;
      }
      case 'description': {
        const b = trimBlankEdges(body);
        if (b.length) detail.description = b.join('\n');
        break;
      }
      case 'goals': {
        const b = trimBlankEdges(body);
        if (b.length) detail.goals = b.join('\n');
        break;
      }
      case 'worklog': {
        let current: string[] | null = null;
        for (const line of body) {
          if (line.trim() === '') continue;
          const m = line.match(/^\s*-\s+(.*)$/);
          if (m) {
            if (current) detail.worklog.push(current.join('\n'));
            current = [m[1].trim()];
          } else if (current) {
            current.push(line);
          } else {
            detail.unknownLines.push(line);
          }
        }
        if (current) detail.worklog.push(current.join('\n'));
        break;
      }
      case 'delivered': {
        const b = trimBlankEdges(body);
        if (b.length) detail.delivered = b.join('\n');
        break;
      }
      default: {
        // Unknown section: preserve heading + body verbatim (flagged in UI).
        detail.unknownLines.push(heading, ...body);
        break;
      }
    }
  }

  return detail;
}

export function serializeTaskFile(detail: TaskDetail, title: string, id: string): string {
  const blocks: string[] = [`# ${title} (${id})`];

  const meta: string[] = [];
  if (detail.added) meta.push(`- added: ${detail.added}`);
  if (detail.started) meta.push(`- started: ${detail.started}`);
  if (detail.promoted) meta.push(`- promoted: ${detail.promoted}`);
  if (detail.completed) meta.push(`- completed: ${detail.completed}`);
  if (detail.links.length) meta.push(`- link: ${detail.links.join(', ')}`);
  if (detail.dependsOn.length) meta.push(`- depends on: ${detail.dependsOn.join(', ')}`);
  if (meta.length) blocks.push(['## Meta', ...meta].join('\n'));

  // Canonical order (t-2191): Problem frames the story, Description tells it, Goals close it.
  if (detail.problem) blocks.push(`## Problem\n\n${detail.problem}`);
  if (detail.description) blocks.push(`## Description\n\n${detail.description}`);
  if (detail.goals) blocks.push(`## Goals\n\n${detail.goals}`);
  if (detail.worklog.length) {
    const worklogLines = detail.worklog.flatMap((d) => {
      const [first, ...rest] = d.split('\n');
      return [`- ${first}`, ...rest];
    });
    blocks.push(['## Worklog', ...worklogLines].join('\n'));
  }
  if (detail.delivered) blocks.push(`## Delivered\n\n${detail.delivered}`);

  // Unknown headings/content, preserved verbatim at the end.
  const unknown = trimBlankEdges(detail.unknownLines);
  if (unknown.length) blocks.push(unknown.join('\n'));

  return blocks.join('\n\n').replace(/\s+$/, '') + '\n';
}
