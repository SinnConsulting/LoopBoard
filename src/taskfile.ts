// `.loopboard/tasks/<id>.md` parser/writer (tolerant, §2.2). Pure — no vscode imports so it runs
// under `node --test`.
//
// Pure content, no frontmatter: the index owns title/phase/model/groomer/questions. Fixed headings
// (Meta, Description, Notes, Worklog, Feedback, Delivered), all optional; the writer emits canonical
// order, omits empty sections, and rewrites the H1 from the index title. Unknown headings/keys are
// preserved verbatim and flagged. Fixpoint: serializeTaskFile(parseTaskFile(x)) is idempotent.

import { TaskDetail } from './model';

const META_KEYS = ['owner', 'added', 'started', 'promoted', 'completed', 'link', 'depends on'];

function stripLeadingEmoji(s: string): string {
  return s.replace(/^\s*(❓|⚠️|⚠)\s*/, '').trim();
}

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
    notes: [],
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

export function parseTaskFile(text: string): TaskDetail {
  const detail = emptyDetail(text);
  const lines = text.split('\n');

  // Group into sections keyed by "## Heading"; everything before the first heading (the H1) is
  // display-only and dropped (the index title wins on serialize).
  let i = 0;
  while (i < lines.length && !/^##\s+/.test(lines[i])) i++;

  while (i < lines.length) {
    const heading = lines[i];
    const name = heading.replace(/^##\s+/, '').trim().toLowerCase();
    const body: string[] = [];
    i++;
    while (i < lines.length && !/^##\s+/.test(lines[i])) {
      body.push(lines[i]);
      i++;
    }

    switch (name) {
      case 'meta': {
        for (const line of body) {
          if (line.trim() === '') continue;
          const kv = line.match(/^\s*-\s+([A-Za-z][A-Za-z ]*?):\s?([\s\S]*)$/);
          const key = kv ? kv[1].trim().toLowerCase() : '';
          if (kv && META_KEYS.includes(key)) {
            const v = kv[2].trim();
            switch (key) {
              case 'owner': detail.owner = v; break;
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
      case 'description': {
        const b = trimBlankEdges(body);
        if (b.length) detail.description = b.join('\n');
        break;
      }
      case 'notes': {
        for (const line of body) {
          if (line.trim() === '') continue;
          const m = line.match(/^\s*-\s+(.*)$/);
          if (m) detail.notes.push(m[1].trim());
          else detail.unknownLines.push(line);
        }
        break;
      }
      case 'worklog': {
        for (const line of body) {
          if (line.trim() === '') continue;
          const m = line.match(/^\s*-\s+(.*)$/);
          if (m) detail.worklog.push(m[1].trim());
          else detail.unknownLines.push(line);
        }
        break;
      }
      case 'feedback': {
        const b = trimBlankEdges(body);
        if (b.length) detail.feedback = stripLeadingEmoji(b.join('\n'));
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
  if (detail.owner) meta.push(`- owner: ${detail.owner}`);
  if (detail.added) meta.push(`- added: ${detail.added}`);
  if (detail.started) meta.push(`- started: ${detail.started}`);
  if (detail.promoted) meta.push(`- promoted: ${detail.promoted}`);
  if (detail.completed) meta.push(`- completed: ${detail.completed}`);
  if (detail.links.length) meta.push(`- link: ${detail.links.join(', ')}`);
  if (detail.dependsOn.length) meta.push(`- depends on: ${detail.dependsOn.join(', ')}`);
  if (meta.length) blocks.push(['## Meta', ...meta].join('\n'));

  if (detail.description) blocks.push(`## Description\n\n${detail.description}`);
  if (detail.notes.length) blocks.push(['## Notes', ...detail.notes.map((n) => `- ${n}`)].join('\n'));
  if (detail.worklog.length) blocks.push(['## Worklog', ...detail.worklog.map((d) => `- ${d}`)].join('\n'));
  if (detail.feedback) blocks.push(`## Feedback\n\n⚠️ ${detail.feedback}`);
  if (detail.delivered) blocks.push(`## Delivered\n\n${detail.delivered}`);

  // Unknown headings/content, preserved verbatim at the end.
  const unknown = trimBlankEdges(detail.unknownLines);
  if (unknown.length) blocks.push(unknown.join('\n'));

  return blocks.join('\n\n').replace(/\s+$/, '') + '\n';
}
