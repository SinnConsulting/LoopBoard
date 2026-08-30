// Workspace-local custom loop rules (t-4a04) — pure logic only. NEVER import `vscode` or node
// typings here: this module is compiled by tsconfig.test.json (`types: []`) into out-test/ and
// unit-tested.
//
// `loopBoard.customRules` (an array of single-line instructions) is rendered into an
// extension-delimited section of `.loopboard/LOOP.md`. Workers re-read that file every pass, so a
// rule placed there reaches every running loop with no terminal recycle.
//
// The block uses the `loopboard:custom:` namespace, NOT `loopboard:sync:` — that is what makes
// "Sync never overwrites it" true by construction: sync.ts's scanner matches only the literal
// `sync:` segment and only ever rewrites blocks whose id it matched from the TEMPLATE, so this
// block is invisible to it.
//
// Ownership is per LINE, not per block: the setting owns the lines it wrote (each carries an
// inline provenance marker holding a hash of its own text), and everything else inside the block —
// heading, lead-in prose, blank lines, hand-added rules — belongs to the human and is preserved
// verbatim and in place.

export const BLOCK_BEGIN = '<!-- loopboard:custom:begin -->';
export const BLOCK_END = '<!-- loopboard:custom:end -->';

const RULE_MARKER = /\s*<!--\s*loopboard:custom-rule:([0-9a-z]+)\s*-->\s*$/;
// A rendered rule line: an ordered-list item. Numbers are positional and re-derived every pass.
const LIST_ITEM = /^(\s*)(\d+)\.\s+(.*)$/;

export const CUSTOM_HEADING = '## Custom rules (workspace)';

export const CUSTOM_LEAD_IN = [
  'Additional standing instructions for THIS workspace. They are numbered separately from the',
  'predefined Rules above: refer to them as "Custom Rule 1", "Custom Rule 2", … and to the rules',
  'under `## Rules` as "Rule 1" … "Rule 17". Custom Rules never renumber, replace or extend the',
  'predefined sequence. Where a Custom Rule contradicts a predefined Rule, the Custom Rule takes',
  'precedence in this workspace; predefined Rules otherwise apply unchanged.',
  'Lines ending in a `loopboard:custom-rule:` marker come from the',
  '`loopBoard.customRules` setting and are kept in step with it; add your own rules as plain',
  'unmarked list items — the extension never touches those. Editing a marked line by hand makes it',
  'yours (its marker is dropped on the next pass).',
].join('\n');

// Trim + collapse internal whitespace, so an id is stable across reflowing and incidental spacing.
export function normalizeRule(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

// FNV-1a (32-bit) → base36. Written inline because the pure module may not import node's crypto.
// A handful of rules makes collision risk negligible, and the blast radius is one line of a
// git-tracked file.
export function ruleId(text: string): string {
  const s = normalizeRule(text);
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    // >>> 0 keeps it an unsigned 32-bit value; Math.imul does the 32-bit multiply.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export interface ReconcileResult {
  text: string;
  added: string[];
  removed: string[];
  adopted: string[];
}

// One list item inside the block, already classified by provenance.
interface RuleLine {
  text: string; // visible text, marker stripped
  id: string | null; // the marker's id, or null once hand-owned
}

function renderRule(line: RuleLine, index: number): string {
  const marker = line.id === null ? '' : ` <!-- loopboard:custom-rule:${line.id} -->`;
  return `${index + 1}. ${line.text}${marker}`;
}

// Locates the block's begin/end marker lines. Returns null when there is no complete pair.
function findBlock(lines: string[]): { begin: number; end: number } | null {
  const begin = lines.findIndex((l) => l.trim() === BLOCK_BEGIN);
  if (begin === -1) return null;
  const end = lines.findIndex((l, i) => i > begin && l.trim() === BLOCK_END);
  return end === -1 ? null : { begin, end };
}

// The four-way per-line classification, applied to the block's body.
//
//   1. no marker                      -> hand-owned; left untouched, in place
//   2. marker, id !== hash(own text)  -> the human edited an extension-written line: ADOPTED
//                                        (marker stripped, text kept verbatim, never deleted)
//   3. marker, self-consistent, id in the setting     -> kept in place
//   4. marker, self-consistent, id not in the setting -> removed from the setting: DELETED
//
// Everything that is not a list item (prose, blank lines, sub-bullets) passes through verbatim.
function reconcileBody(
  body: string[],
  wantedIds: Set<string>,
  result: { removed: string[]; adopted: string[] }
): (string | RuleLine)[] {
  const out: (string | RuleLine)[] = [];
  for (const raw of body) {
    const item = LIST_ITEM.exec(raw);
    if (!item) {
      out.push(raw);
      continue;
    }
    const content = item[3];
    const marked = RULE_MARKER.exec(content);
    if (!marked) {
      out.push({ text: content.trim(), id: null }); // (1) hand-owned
      continue;
    }
    const visible = content.replace(RULE_MARKER, '').trim();
    const id = marked[1];
    if (ruleId(visible) !== id) {
      result.adopted.push(visible); // (2) hand-edited -> adopt
      out.push({ text: visible, id: null });
      continue;
    }
    if (wantedIds.has(id)) {
      out.push({ text: visible, id }); // (3) still in the setting
    } else {
      result.removed.push(visible); // (4) gone from the setting
    }
  }
  return out;
}

// Renders the block's body back to lines, renumbering every list item contiguously from 1.
function renderBody(entries: (string | RuleLine)[]): string[] {
  let n = 0;
  return entries.map((e) => (typeof e === 'string' ? e : renderRule(e, n++)));
}

// Insertion point for a brand-new block: after the LAST `loopboard:sync:*:end` marker, so the
// block sits below every template-owned section and a future template section spliced next to its
// neighbour can never land inside it.
function insertionPoint(lines: string[]): number {
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/<!--\s*loopboard:sync:[a-z-]+:end\s*-->/.test(lines[i])) last = i;
  }
  return last === -1 ? -1 : last + 1;
}

/**
 * Reconciles the custom-rules block in `loopText` against `rules` (the `loopBoard.customRules`
 * setting), returning the new text plus what changed.
 *
 * Byte-identical output (`text === loopText`) is the caller's signal not to write — a no-op pass
 * must never touch disk, or the `.loopboard/**\/*.md` watcher turns every activation into a
 * refresh storm. Callers compare the text rather than trusting the lists.
 *
 * Guard: a LOOP.md carrying no `loopboard:sync:` markers is returned untouched. Such a file is
 * what store.syncTemplates' legacy full-replace path overwrites wholesale, so a custom block must
 * never come to exist in one.
 */
export function reconcileCustomRules(loopText: string, rules: string[]): ReconcileResult {
  const unchanged: ReconcileResult = { text: loopText, added: [], removed: [], adopted: [] };
  if (!/<!--\s*loopboard:sync:[a-z-]+:begin\s*-->/.test(loopText)) return unchanged;

  // Blank and whitespace-only entries are not rules; they would render as empty numbered items.
  // Duplicates collapse: two entries that normalize the same share an id, so they are one rule.
  const seen = new Set<string>();
  const wanted = rules
    .map((r) => normalizeRule(r))
    .filter((r) => r !== '' && !seen.has(r) && (seen.add(r), true));
  const lines = loopText.split('\n');
  const block = findBlock(lines);

  // No block yet: create one only when there is something to put in it. An empty setting on a
  // file with no block is a no-op — the extension never creates an empty block.
  if (!block) {
    if (wanted.length === 0) return unchanged;
    const at = insertionPoint(lines);
    if (at === -1) return unchanged;
    const rendered = wanted.map((text, i) => renderRule({ text, id: ruleId(text) }, i));
    const blockLines = ['', BLOCK_BEGIN, CUSTOM_HEADING, '', CUSTOM_LEAD_IN, '', ...rendered, BLOCK_END];
    const next = [...lines.slice(0, at), ...blockLines, ...lines.slice(at)];
    return { text: next.join('\n'), added: [...wanted], removed: [], adopted: [] };
  }

  const result = { removed: [] as string[], adopted: [] as string[] };
  const wantedIds = new Set(wanted.map((r) => ruleId(r)));
  const body = lines.slice(block.begin + 1, block.end);
  const entries = reconcileBody(body, wantedIds, result);

  // Append, in setting order, every rule the block does not already carry.
  const present = new Set(
    entries.filter((e): e is RuleLine => typeof e !== 'string' && e.id !== null).map((e) => e.id as string)
  );
  const added: string[] = [];
  for (const text of wanted) {
    const id = ruleId(text);
    if (present.has(id)) continue;
    present.add(id);
    entries.push({ text, id });
    added.push(text);
  }

  const next = [
    ...lines.slice(0, block.begin + 1),
    ...renderBody(entries),
    ...lines.slice(block.end),
  ];
  const text = next.join('\n');
  return { text, added, removed: result.removed, adopted: result.adopted };
}

// Workspace-only value selection (t-22ad). `loopBoard.customRules` writes files INTO the
// workspace, so a User-level (global) value must never apply — it would rewrite every open
// LoopBoard workspace's LOOP.md at once. Mirrors the shape of vscode's
// `WorkspaceConfiguration.inspect()` without importing vscode (pure module).
export interface CustomRulesInspect {
  globalValue?: string[];
  workspaceValue?: string[];
  workspaceFolderValue?: string[];
}

export interface WorkspaceRulesSelection {
  rules: string[];
  // True when a User-level value exists — it is never applied, only logged by the caller.
  ignoredGlobal: boolean;
}

export function selectWorkspaceRules(inspect: CustomRulesInspect | undefined): WorkspaceRulesSelection {
  return {
    rules: inspect?.workspaceFolderValue ?? inspect?.workspaceValue ?? [],
    ignoredGlobal: inspect?.globalValue !== undefined,
  };
}
