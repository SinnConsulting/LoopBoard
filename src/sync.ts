// Pure logic for syncing a live `.loopboard/` workspace back onto the shipped templates:
// TODO.md's intro/heading preamble, and LOOP.md's marker-fenced extension-owned sections.
// No vscode imports so it runs under `node --test`.
import { parseTodo } from './parser';
import { serializeTodo } from './writer';

function markerRegex(id: string, tag: 'begin' | 'end'): RegExp {
  return new RegExp(`<!--\\s*loopboard:sync:${id}:${tag}\\s*-->`);
}

// Ids of every marked section present in `text`, in document order.
export function markedSectionIds(text: string): string[] {
  const re = /<!--\s*loopboard:sync:([a-z-]+):begin\s*-->/g;
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) ids.push(m[1]);
  return ids;
}

export function hasMarkers(text: string): boolean {
  return markedSectionIds(text).length > 0;
}

function extractBlock(text: string, id: string): string | null {
  const b = text.match(markerRegex(id, 'begin'));
  const e = text.match(markerRegex(id, 'end'));
  if (!b || !e || b.index === undefined || e.index === undefined) return null;
  return text.slice(b.index, e.index + e[0].length);
}

// Replace each marked section in `current` with the template's version of that same section.
// Ids the template has but `current` doesn't (partial/legacy file) are skipped — the caller
// should route those through the full-overwrite path via `hasMarkers` instead.
export function syncMarkedSections(current: string, template: string): { text: string; changedIds: string[] } {
  let text = current;
  const changedIds: string[] = [];
  for (const id of markedSectionIds(template)) {
    const curBlock = extractBlock(current, id);
    const tplBlock = extractBlock(template, id);
    if (curBlock == null || tplBlock == null) continue;
    if (curBlock !== tplBlock) {
      text = text.replace(curBlock, tplBlock);
      changedIds.push(id);
    }
  }
  return { text, changedIds };
}

// TODO.md's intro paragraph + `## Tasks` heading scaffold is extension-owned; every task entry
// (and any custom heading/HTML-comment extras) round-trips verbatim via the existing
// serializeTodo(parseTodo(x)) fixpoint, so only the preamble needs replacing.
export function syncTodoPreamble(currentText: string, templateText: string): { text: string; changed: boolean } {
  const doc = parseTodo(currentText);
  const templateDoc = parseTodo(templateText);
  const changed = doc.preamble !== templateDoc.preamble;
  if (changed) doc.preamble = templateDoc.preamble;
  return { text: serializeTodo(doc), changed };
}
