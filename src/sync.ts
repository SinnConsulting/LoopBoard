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

// Replace each marked section in `current` with the template's version of that same section. A
// template id `current` doesn't have yet (the template introduced a new marked section since
// `current` was last synced) is INSERTED next to its nearest template-order neighbor that
// `current` already has — adjacent to that neighbor's block, on the same side as in the
// template — so template evolution reaches already-marked files instead of being skipped
// forever. A `current` with NO markers at all (genuinely legacy/pre-marker) gets nothing
// inserted here — the caller should route that case through the full-overwrite path via
// `hasMarkers` instead.
export function syncMarkedSections(current: string, template: string): { text: string; changedIds: string[] } {
  let text = current;
  const changedIds: string[] = [];
  if (!hasMarkers(current)) return { text, changedIds };
  const templateIds = markedSectionIds(template);
  for (let i = 0; i < templateIds.length; i++) {
    const id = templateIds[i];
    const tplBlock = extractBlock(template, id);
    if (tplBlock == null) continue;
    const curBlock = extractBlock(text, id);
    if (curBlock != null) {
      if (curBlock !== tplBlock) {
        text = text.replace(curBlock, tplBlock);
        changedIds.push(id);
      }
      continue;
    }
    let before: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      before = extractBlock(text, templateIds[j]);
      if (before != null) break;
    }
    if (before != null) {
      text = text.replace(before, `${before}\n\n${tplBlock}`);
    } else {
      let after: string | null = null;
      for (let j = i + 1; j < templateIds.length; j++) {
        after = extractBlock(text, templateIds[j]);
        if (after != null) break;
      }
      text = after != null ? text.replace(after, `${tplBlock}\n\n${after}`) : `${tplBlock}\n\n${text}`;
    }
    changedIds.push(id);
  }
  return { text, changedIds };
}

// TODO.md's intro paragraph is extension-owned and, like LOOP.md, fenced by a
// `<!-- loopboard:sync:todo-intro:begin/end -->` marker in the shipped template — any prose the
// user adds before/after the marker (inside the preamble, above the `## Tasks` heading) survives
// a sync. A legacy preamble with no marker yet is replaced whole (`legacy: true` on that pass);
// every task entry (and the `## Tasks` heading/HTML-comment extras) round-trips verbatim via the
// existing serializeTodo(parseTodo(x)) fixpoint regardless, so only the preamble is ever touched.
export function syncTodoPreamble(
  currentText: string,
  templateText: string
): { text: string; changed: boolean; legacy: boolean } {
  const doc = parseTodo(currentText);
  const templateDoc = parseTodo(templateText);
  const legacy = !hasMarkers(doc.preamble);
  let changed = false;
  if (legacy) {
    changed = doc.preamble !== templateDoc.preamble;
    if (changed) doc.preamble = templateDoc.preamble;
  } else {
    const { text, changedIds } = syncMarkedSections(doc.preamble, templateDoc.preamble);
    changed = changedIds.length > 0;
    if (changed) doc.preamble = text;
  }
  return { text: serializeTodo(doc), changed, legacy: legacy && changed };
}
