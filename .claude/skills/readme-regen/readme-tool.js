'use strict';
// README settings generator + feature-coverage check (t-158b).
//
// Dependency-free plain Node, run inside Docker (node:22) via the Makefile's $(DOCKER) wrapper —
// never on the host. It does NOT import `vscode` and is NOT part of the extension's compiled
// modules: it lives under `.claude/skills/` and never ships in the .vsix (`.vscodeignore` excludes
// `.claude/**`; `make package` asserts it).
//
// Two jobs, deliberately different in kind:
//   generate — two MACHINE-OWNED regions, rewritten in place between their sentinels: settings from
//              `contributes.configuration`, the feature showcase from docs/showcase/README.md.
//   check    — the feature prose is HAND-WRITTEN. Coverage is validated against the real
//              contribution points and drift is FLAGGED, never rewritten.

const fs = require('fs');
const path = require('path');

const BEGIN = '<!-- loopboard:settings:begin -->';
const END = '<!-- loopboard:settings:end -->';

// The feature showcase is hand-written ONCE, in docs/showcase/README.md (next to its GIFs), and
// copied into README.md between the same sentinels it carries there. Relative links are resolved
// against docs/showcase/ and made absolute, because README.md also renders on the Marketplace page,
// where a repo-relative path means nothing.
const SHOWCASE_SRC = 'docs/showcase/README.md';
const SHOWCASE_BEGIN = '<!-- loopboard:showcase:begin -->';
const SHOWCASE_END = '<!-- loopboard:showcase:end -->';
const RAW_BASE = 'https://raw.githubusercontent.com/SinnConsulting/LoopBoard/main/';

// Behaviours that are documented prose rather than a manifest entry, so coverage cannot be derived
// from package.json alone. Each is a feature the README must keep describing; the regex is matched
// against the whole file, case-insensitively.
const DOCUMENTED_BEHAVIOURS = [
  ['three human actions (promote / accept / demote)', /promote[\s\S]{0,80}accept[\s\S]{0,80}demote/i],
  ['markdown is the source of truth', /source of truth/i],
  ['groom + work loops', /groom/i],
  ['multi-model slots (opus/sonnet/fable)', /opus[\s\S]{0,40}sonnet[\s\S]{0,40}fable/i],
  ['loop terminals', /loop terminal/i],
  ['image attachments under .loopboard/cache/', /\.loopboard\/cache\//],
  ['sidebar summary', /sidebar/i],
  ['DONE.md archival', /DONE\.md/],
  ['field-level atomic saves', /atomic|field-level/i],
  ['zero runtime dependencies', /zero runtime dep/i],
];

function repoRoot() {
  // The tool lives at .claude/skills/readme-regen/, three levels below the repo root.
  return path.resolve(__dirname, '..', '..', '..');
}

function readManifest(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
}

// One table cell: single line, pipes escaped, so a multi-line description can never break the row.
function cell(text) {
  return String(text).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

function describe(prop) {
  const deprecation = prop.markdownDeprecationMessage || prop.deprecationMessage;
  const body = prop.markdownDescription || prop.description || '';
  return deprecation ? `**Deprecated.** ${cell(deprecation)}` : cell(body);
}

function formatDefault(prop) {
  if (!('default' in prop)) return '—';
  const d = prop.default;
  if (Array.isArray(d)) return `\`${JSON.stringify(d)}\``;
  // Strings render bare (`sonnet`, not `"sonnet"`) — that is how they are typed into settings.json's
  // value field and how the hand-written table always read. Empty string keeps its quotes so the
  // cell is not blank.
  if (typeof d === 'string') return d === '' ? '`""`' : `\`${d}\``;
  return `\`${JSON.stringify(d)}\``;
}

// Manifest order for the groups; `order` then manifest order within a group — the same sequence
// VSCode's own settings page renders, so the table reads in the order a user scrolls past.
function orderedProperties(group) {
  return Object.entries(group.properties)
    .map(([id, prop], i) => ({ id, prop, i }))
    .sort((a, b) => (a.prop.order ?? 1e9) - (b.prop.order ?? 1e9) || a.i - b.i);
}

function renderSettings(manifest) {
  const out = [BEGIN, ''];
  for (const group of manifest.contributes.configuration) {
    out.push(`### ${group.title}`, '');
    out.push('| Setting | Default | Description |', '|---|---|---|');
    for (const { id, prop } of orderedProperties(group)) {
      out.push(`| \`${id}\` | ${formatDefault(prop)} | ${describe(prop)} |`);
    }
    out.push('');
  }
  out.push(END);
  return out.join('\n');
}

function splitReadme(text, begin = BEGIN, end = END, file = 'README.md') {
  const b = text.indexOf(begin);
  const e = text.indexOf(end);
  if (b === -1 || e === -1) {
    throw new Error(`${file} is missing the ${begin} / ${end} sentinels — add them around the region first.`);
  }
  if (e < b) throw new Error(`${file} has the ${begin} / ${end} sentinels in the wrong order.`);
  return { head: text.slice(0, b), inner: text.slice(b + begin.length, e), tail: text.slice(e + end.length) };
}

// A relative URL in `src="…"`, `href="…"` or a markdown `](…)` becomes an absolute raw URL on main.
// Absolute URLs, anchors and root-relative paths are left alone.
function absolutizeLinks(text, fromDir) {
  const abs = (url) => (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(url) ? url : RAW_BASE + path.posix.normalize(path.posix.join(fromDir, url)));
  return text
    .replace(/\b(src|href)="([^"]+)"/g, (_, attr, url) => `${attr}="${abs(url)}"`)
    .replace(/\]\(([^)\s]+)\)/g, (_, url) => `](${abs(url)})`);
}

function renderShowcase(root) {
  const source = fs.readFileSync(path.join(root, SHOWCASE_SRC), 'utf8');
  const { inner } = splitReadme(source, SHOWCASE_BEGIN, SHOWCASE_END, SHOWCASE_SRC);
  return SHOWCASE_BEGIN + absolutizeLinks(inner, path.posix.dirname(SHOWCASE_SRC)) + SHOWCASE_END;
}

// Both machine-owned regions, rebuilt from their sources. Pure: returns the text, writes nothing.
function render(root, current) {
  const s = splitReadme(current);
  const withSettings = s.head + renderSettings(readManifest(root)) + s.tail;
  const w = splitReadme(withSettings, SHOWCASE_BEGIN, SHOWCASE_END);
  return w.head + renderShowcase(root) + w.tail;
}

// Idempotent: each region is fully replaced from its source, so running twice is a no-op.
function generate(root = repoRoot()) {
  const readmePath = path.join(root, 'README.md');
  const current = fs.readFileSync(readmePath, 'utf8');
  const next = render(root, current);
  if (next === current) return { changed: false };
  fs.writeFileSync(readmePath, next);
  return { changed: true };
}

// Every problem found, as one flat list of human-readable strings. Empty = no drift.
function check(root = repoRoot()) {
  const manifest = readManifest(root);
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const problems = [];

  // 1. The machine-owned regions must already equal what generate() would write.
  try {
    const { head, tail } = splitReadme(readme);
    if (head + renderSettings(manifest) + tail !== readme) {
      problems.push('settings region is stale — run `generate` (a setting was added, removed or reworded in package.json)');
    }
  } catch (err) {
    problems.push(err.message);
  }
  try {
    const { head, tail } = splitReadme(readme, SHOWCASE_BEGIN, SHOWCASE_END);
    if (head + renderShowcase(root) + tail !== readme) {
      problems.push(`showcase region is stale — run \`generate\` (${SHOWCASE_SRC} changed)`);
    }
  } catch (err) {
    problems.push(err.message);
  }

  // 2. Commands: every palette entry a user can run should be findable by its title.
  for (const cmd of manifest.contributes.commands || []) {
    if (!readme.includes(cmd.title)) problems.push(`command not documented: ${cmd.title} (${cmd.command})`);
  }

  // 3. Views: the activity-bar container and its view must both be described.
  for (const container of (manifest.contributes.viewsContainers || {}).activitybar || []) {
    if (!readme.includes(container.title)) problems.push(`view container not documented: ${container.title}`);
  }
  for (const views of Object.values(manifest.contributes.views || {})) {
    for (const view of views) {
      if (!readme.toLowerCase().includes(view.name.toLowerCase())) problems.push(`view not documented: ${view.name} (${view.id})`);
    }
  }

  // 4. Hand-written feature prose: coverage only. Nothing here is rewritten.
  for (const [label, re] of DOCUMENTED_BEHAVIOURS) {
    if (!re.test(readme)) problems.push(`documented behaviour missing from the feature prose: ${label}`);
  }

  return problems;
}

module.exports = { BEGIN, END, SHOWCASE_BEGIN, SHOWCASE_END, RAW_BASE, renderSettings, absolutizeLinks, generate, check, repoRoot };

if (require.main === module) {
  const mode = process.argv[2];
  if (mode === 'generate') {
    const { changed } = generate();
    console.log(changed ? 'README.md regions regenerated.' : 'README.md regions already up to date.');
  } else if (mode === 'check') {
    const problems = check();
    if (problems.length === 0) {
      console.log('README.md: no drift.');
    } else {
      for (const p of problems) console.error(`  - ${p}`);
      console.error(`README.md: ${problems.length} problem(s).`);
      process.exitCode = 1;
    }
  } else {
    console.error('usage: node .claude/skills/readme-regen/readme-tool.js generate|check');
    process.exitCode = 2;
  }
}
