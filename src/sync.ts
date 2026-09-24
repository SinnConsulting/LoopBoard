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

// Shared guard: a file is missing (readFile returned undefined) or whitespace-only. Both the
// manual Sync path and the activation auto-heal path route missing/empty files to a full
// template write through this same helper so the two behaviors cannot drift.
export function isEmptyOrMissing(text: string | undefined): boolean {
  return text === undefined || text.trim() === '';
}

function extractBlock(text: string, id: string): string | null {
  const b = text.match(markerRegex(id, 'begin'));
  const e = text.match(markerRegex(id, 'end'));
  if (!b || !e || b.index === undefined || e.index === undefined) return null;
  return text.slice(b.index, e.index + e[0].length);
}

// The template's prose for `id`, without its own begin/end marker lines — used to detect that
// same prose sitting unfenced in a target file that predates this marker id.
function extractInner(text: string, id: string): string | null {
  const re = new RegExp(`<!--\\s*loopboard:sync:${id}:begin\\s*-->\\n?([\\s\\S]*?)\\n?<!--\\s*loopboard:sync:${id}:end\\s*-->`);
  const m = text.match(re);
  return m ? m[1] : null;
}

// Replace each marked section in `current` with the template's version of that same section. A
// template id `current` doesn't have yet (the template introduced a new marked section since
// `current` was last synced) is either (a) WRAPPED in place, if that section's prose already
// exists unfenced in `current` verbatim (the common case: the marker is new but the text it
// fences isn't) — never splice a second copy alongside the pre-existing unfenced one — or (b)
// INSERTED next to its nearest template-order neighbor that `current` already has, when no such
// unfenced match exists. A `current` with NO markers at all (genuinely legacy/pre-marker) gets
// nothing inserted here — the caller should route that case through the full-overwrite path via
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
    const tplInner = extractInner(template, id);
    if (tplInner != null && text.includes(tplInner)) {
      text = text.replace(tplInner, tplBlock);
      changedIds.push(id);
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

// Where a legacy (unmarked) LOOP.md is saved before the one-time full replacement.
export const LOOP_BACKUP_PATH = '.loopboard/LOOP.md.bkp';

// What a sync would do to each file. `legacy` = the file predates the marker format and is
// replaced whole (TODO.md: only the preamble — task entries round-trip verbatim; LOOP.md: the whole
// file, after a backup to LOOP_BACKUP_PATH).
export type TodoChange = 'none' | 'create' | 'intro' | 'legacy';
export type LoopChange = 'none' | 'create' | 'sections' | 'legacy';

export interface SyncPlan {
  summary: string[]; // the manual confirm modal's preview lines
  upToDate: boolean;
  todo: TodoChange;
  loop: LoopChange;
  loopSectionIds: string[]; // `loop: 'sections'` only: the marked blocks that change
  // Exactly what applying the plan writes, in write order: TODO.md, then LOOP.md's backup, then
  // LOOP.md. An absent field is a file left untouched.
  writes: { todo?: string; loopBackup?: string; loop?: string };
}

// The one classification of template drift (t-4dce), shared by the manual preview, the manual
// Sync and activation auto-sync, so what the modal promises, what the popup reports and what gets
// written cannot disagree. `undefined` = the file does not exist.
export function planSync(
  todoText: string | undefined,
  loopText: string | undefined,
  todoTemplate: string,
  loopTemplate: string
): SyncPlan {
  const summary: string[] = [];
  const writes: SyncPlan['writes'] = {};
  let todo: TodoChange = 'none';
  let loop: LoopChange = 'none';
  let loopSectionIds: string[] = [];

  if (isEmptyOrMissing(todoText)) {
    todo = 'create';
    writes.todo = todoTemplate;
    summary.push('TODO.md is missing or empty and will be created from the template.');
  } else {
    const { text, changed, legacy } = syncTodoPreamble(todoText as string, todoTemplate);
    if (changed) {
      todo = legacy ? 'legacy' : 'intro';
      writes.todo = text;
      summary.push(legacy
        ? 'TODO.md predates the current format and will be fully replaced (no markers yet).'
        : 'TODO.md: intro out of date.');
    }
  }

  if (isEmptyOrMissing(loopText)) {
    loop = 'create';
    writes.loop = loopTemplate;
    summary.push('LOOP.md is missing or empty and will be created from the template.');
  } else if (!hasMarkers(loopText as string)) {
    loop = 'legacy';
    writes.loopBackup = loopText as string;
    writes.loop = loopTemplate;
    summary.push('LOOP.md predates the current format and will be fully replaced (a backup will be saved to LOOP.md.bkp).');
  } else {
    const { text, changedIds } = syncMarkedSections(loopText as string, loopTemplate);
    if (changedIds.length) {
      loop = 'sections';
      loopSectionIds = changedIds;
      writes.loop = text;
      summary.push(`LOOP.md: ${changedIds.length} section(s) out of date (${changedIds.join(', ')}).`);
    }
  }

  return { summary, upToDate: summary.length === 0, todo, loop, loopSectionIds, writes };
}

// Activation auto-sync's decision. Legacy replacements are `apply` like any other drift: the
// automatic path has no confirm step, the popup and the backup are the safety net.
export function decideAutoSync(plan: SyncPlan, autoSyncEnabled: boolean): 'none' | 'apply' {
  return autoSyncEnabled && !plan.upToDate ? 'apply' : 'none';
}

// The routine (non-legacy) changes a plan makes, one short phrase each.
function routineParts(plan: SyncPlan): string[] {
  const parts: string[] = [];
  if (plan.todo === 'create') parts.push('TODO.md created from the template');
  if (plan.todo === 'intro') parts.push('TODO.md: intro updated');
  if (plan.loop === 'create') parts.push('LOOP.md created from the template');
  if (plan.loop === 'sections') {
    parts.push(`LOOP.md: ${plan.loopSectionIds.length} section(s) updated (${plan.loopSectionIds.join(', ')})`);
  }
  return parts;
}

// The `template-autosync` debug line's reason for an applied plan: every change, legacy ones
// spelled out with the backup path.
export function describeSyncChanges(plan: SyncPlan): string {
  const parts: string[] = [];
  if (plan.loop === 'legacy') parts.push(`LEGACY: LOOP.md replaced whole, backup ${LOOP_BACKUP_PATH}`);
  if (plan.todo === 'legacy') parts.push('LEGACY: TODO.md preamble replaced whole');
  return [...parts, ...routineParts(plan)].join('; ');
}

// The popup after an auto-sync that wrote something. A legacy replacement is a warning that says
// plainly what was replaced (and, for LOOP.md, where the old text went); anything else is info.
// `undefined` for an up-to-date plan: nothing was written, so nothing is shown.
export function autoSyncPopup(plan: SyncPlan): { level: 'info' | 'warning'; message: string } | undefined {
  if (plan.upToDate) return undefined;
  const routine = routineParts(plan);
  const legacy: string[] = [];
  if (plan.loop === 'legacy') {
    legacy.push(`LOOP.md predated the marker format and was replaced with the current template — your previous LOOP.md is saved as ${LOOP_BACKUP_PATH}.`);
  }
  if (plan.todo === 'legacy') {
    legacy.push("TODO.md's intro predated the marker format and was replaced (task entries untouched).");
  }
  if (legacy.length === 0) return { level: 'info', message: `LoopBoard: synced templates — ${routine.join('; ')}.` };
  const also = routine.length ? ` Also synced: ${routine.join('; ')}.` : '';
  return { level: 'warning', message: `LoopBoard: ${legacy.join(' ')}${also}` };
}
