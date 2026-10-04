// Story tags (t-0b10). Pure — no vscode import, so it runs under `node --test`.
//
// A task's tags live in `tasks/<id>.md` Meta (`- tags: a, b`, parsed by taskfile.ts); this module
// owns the NAME rule and the `.loopboard/tags.md` registry, which only adds a color per tag:
//
//   # Tags
//
//   - bug: red
//   - docs
//
// The registry is parsed tolerantly: every line is kept verbatim, a `- <name>[: <color>]` line is
// interpreted, an unknown color keeps its line but reads as "no color", and any other line is
// simply preserved. serializeRegistry(parseRegistry(x)) is idempotent as text.

import { TAG_COLORS, TagColor, TagEntry, normalizeTag } from './model';

export { TAG_COLORS, TagColor, TagEntry, normalizeTag, normalizeTags } from './model';

export interface TagRegistry {
  lines: string[];
}

function isColor(v: string): v is TagColor {
  return (TAG_COLORS as readonly string[]).includes(v);
}

const TAG_LINE = /^-\s+([^:\s][^:]*?)\s*(?::\s*(\S*))?\s*$/;

function tagLine(line: string): { name: string; rawColor: string } | undefined {
  const m = TAG_LINE.exec(line);
  if (!m) return undefined;
  const name = normalizeTag(m[1]);
  return name ? { name, rawColor: m[2] ?? '' } : undefined;
}

export function parseRegistry(text: string): TagRegistry {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return { lines };
}

export function serializeRegistry(reg: TagRegistry): string {
  return reg.lines.length ? reg.lines.join('\n') + '\n' : '';
}

// One entry per tag, in file order; a later line for an already-listed tag is ignored.
export function registryEntries(reg: TagRegistry): TagEntry[] {
  const out: TagEntry[] = [];
  for (const line of reg.lines) {
    const t = tagLine(line);
    if (!t || out.some((e) => e.name === t.name)) continue;
    out.push(isColor(t.rawColor) ? { name: t.name, color: t.rawColor } : { name: t.name });
  }
  return out;
}

// Lines that are neither blank, a heading nor a tag line — what the parser keeps but cannot read.
export function registryUnparsedCount(reg: TagRegistry): number {
  return reg.lines.filter((l) => l.trim() !== '' && !/^#/.test(l.trim()) && !tagLine(l)).length;
}

export function tagColorOf(reg: TagRegistry, tag: string): TagColor | '' {
  const name = normalizeTag(tag);
  return registryEntries(reg).find((e) => e.name === name)?.color ?? '';
}

// Change or append ONE tag's line; every other line is untouched. '' removes the color.
export function setTagColor(reg: TagRegistry, tag: string, color: TagColor | ''): TagRegistry {
  const name = normalizeTag(tag);
  if (!name) return reg;
  const line = color ? `- ${name}: ${color}` : `- ${name}`;
  const at = reg.lines.findIndex((l) => tagLine(l)?.name === name);
  if (at >= 0) {
    const lines = reg.lines.slice();
    lines[at] = line;
    return { lines };
  }
  return { lines: reg.lines.length ? [...reg.lines, line] : ['# Tags', '', line] };
}

export interface TagColorResult {
  status: 'applied' | 'conflict' | 'unsupported';
  registry: TagRegistry;
  before: TagColor | '';
}

// Same-field conflict rule of merge.ts, for one tag's color: the on-disk color must equal the
// board's base or already be the requested value, otherwise disk wins.
export function applyTagColor(reg: TagRegistry, tag: string, color: string, base: string): TagColorResult {
  const before = tagColorOf(reg, tag);
  if (!normalizeTag(tag) || (color !== '' && !isColor(color))) return { status: 'unsupported', registry: reg, before };
  if (before !== base && before !== color) return { status: 'conflict', registry: reg, before };
  return { status: 'applied', registry: setTagColor(reg, tag, color as TagColor | ''), before };
}

export function tagColorToast(status: string): string | undefined {
  switch (status) {
    case 'conflict':
      return 'Tag color changed on disk — your color edit was not applied.';
    case 'unsupported':
      return 'The board and the extension are out of step — your tag color edit was not applied. Reload the window (Developer: Reload Window).';
    default:
      return undefined;
  }
}
