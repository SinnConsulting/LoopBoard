// Pure attachment-link helpers (t-ae10). No vscode imports: the store does the file IO, these only
// decide which staged `.loopboard/cache/<id>/<file>` links a text holds and which files are safe
// to delete.

// A staged attachment link: `[any label](.loopboard/cache/...)`. The label is ignored everywhere —
// dedupe may have renamed the file (`[image.png](…/image-2.png)`), so the PATH is the only key.
const LINK_RE = /\[[^\]]*\]\((\.loopboard\/cache\/[^)\s]+)\)/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Paths of the staged attachments a text links, in order, de-duplicated — only those inside THIS
// task's own cache dir with a bare filename (the same guard `store.removeAttachment` applies), so a
// path quoted from another task can never be selected for deletion.
export function attachmentPaths(text: string, taskId: string): string[] {
  const prefix = `.loopboard/cache/${taskId}/`;
  const out: string[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    const path = m[1];
    const name = path.startsWith(prefix) ? path.slice(prefix.length) : '';
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) continue;
    if (!out.includes(path)) out.push(path);
  }
  return out;
}

// Remove every link to `path` from a text, whatever its label, plus the whitespace run before it.
// A text that does not link `path` comes back untouched (byte-identical).
export function stripAttachmentLink(text: string, path: string): string {
  const re = new RegExp(`[ \\t]*\\[[^\\]]*\\]\\(${escapeRe(path)}\\)`, 'g');
  const stripped = text.replace(re, '');
  return stripped === text ? text : stripped.replace(/[ \t]{2,}/g, ' ').trim();
}

// Which attachments of a removed text may be deleted from the cache: every path it links that no
// remaining text of the same task still mentions (title, story sections, other feedback items,
// answers — the caller passes them). A plain substring check, deliberately conservative: any
// mention keeps the file.
export function unreferencedAttachments(removedText: string, remaining: string[], taskId: string): string[] {
  return attachmentPaths(removedText, taskId).filter((p) => !remaining.some((t) => t.includes(p)));
}
