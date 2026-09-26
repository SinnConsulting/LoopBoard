'use strict';
// Release visuals (t-7e1a). Appends the showcase GIFs that a commit in the release range
// explicitly designated — with a `Release-Visual: <file>.gif` trailer — to that release's GitHub
// Release body, in one section at the end. Run by release.yml's `release` job right after
// semantic-release, behind `continue-on-error: true`: a failure costs only this section, never the
// release, the .vsix or the Marketplace publish.
//
// Two halves. `buildReleaseNotes` is pure (strings in, string or null out) and is what
// test/release-visual.test.js requires. `main` is the thin I/O wrapper CI runs with Node 22:
// `git log` over the range, `gh release view` for the current body, `gh release edit
// --notes-file` to write it back. Its stdout is the trace (CI-only, so no store.debugLog).

// Fixed first line of the section. A body that already carries it is left untouched, so a manual
// re-run of this script is a no-op.
const MARKER = '<!-- loopboard:release-visual -->';
const GIF_DIR = 'docs/showcase/gifs';
// Matched on any line, not only a final trailer block: the repo squashes with COMMIT_MESSAGES, so a
// PR's trailers land mid-body in the squash commit, between the listed commit messages.
const TRAILER = /^[ \t]*Release-Visual:[ \t]*(.*?)[ \t]*$/gim;
const FILE_NAME = /^[\w.-]+\.gif$/;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeMarkdown = (s) => s.replace(/[\\`*_[\]<>]/g, '\\$&');

// The `alt` of the GIF's `<img src="gifs/<file>" … alt="…">` in docs/showcase/README.md, or null.
function captionFor(readme, file) {
  const tag = new RegExp(`<img\\b[^>]*\\bsrc="gifs/${escapeRegExp(file)}"[^>]*>`).exec(readme);
  if (!tag) return null;
  const alt = /\balt="([^"]*)"/.exec(tag[0]);
  return alt ? alt[1] : null;
}

// messages: the full commit messages in the range; readme: docs/showcase/README.md's text;
// repo: `owner/repo`; tag: the new release's tag (`vX`); body: the release's current body.
// Returns the new body, or null for "do not edit".
function buildReleaseNotes({ messages, readme, repo, tag, body, log = () => {} }) {
  if (body.includes(MARKER)) {
    log(`${tag}: body already carries the release-visual section — leaving it untouched.`);
    return null;
  }
  const designated = [];
  for (const message of messages) {
    for (const m of message.matchAll(TRAILER)) {
      const file = m[1];
      if (!FILE_NAME.test(file)) {
        log(`skip "${file}": a Release-Visual trailer names one bare <file>.gif under ${GIF_DIR}/.`);
      } else if (designated.includes(file)) {
        log(`trailer ${file} (already designated earlier in the range)`);
      } else {
        log(`trailer ${file}`);
        designated.push(file);
      }
    }
  }
  const images = [];
  for (const file of designated) {
    const caption = captionFor(readme, file);
    if (caption === null) {
      log(`skip ${file}: no <img src="gifs/${file}" alt="…"> in docs/showcase/README.md.`);
      continue;
    }
    const url = `https://raw.githubusercontent.com/${repo}/${tag}/${GIF_DIR}/${file}`;
    log(`add ${file} -> ${url}`);
    images.push(`**${escapeMarkdown(caption)}**\n\n![${escapeMarkdown(caption)}](${url})\n`);
  }
  if (images.length === 0) {
    log(`${tag}: no designated GIF to add — body not edited.`);
    return null;
  }
  const section = `${MARKER}\n### Showcase\n\n${images.join('\n')}`;
  if (body === '') return section;
  return body + (body.endsWith('\n') ? '\n' : '\n\n') + section;
}

function main() {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  const last = process.env.LAST_RELEASE_VERSION || '';
  const next = process.env.NEW_RELEASE_VERSION || '';
  const repo = process.env.GITHUB_REPOSITORY || '';
  if (!next || !repo) throw new Error('NEW_RELEASE_VERSION and GITHUB_REPOSITORY are required.');
  const tag = `v${next}`;
  // semantic-release's tagFormat is the default v{version}; no previous release = whole history.
  const range = last ? `v${last}..${tag}` : tag;
  console.log(`range ${range}`);

  const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20 });
  const messages = run('git', ['log', '--reverse', '--format=%B%x00', range])
    .split('\0')
    .filter((m) => m.trim());
  console.log(`${messages.length} commit(s) in range`);
  const readme = fs.readFileSync(path.join('docs', 'showcase', 'README.md'), 'utf8');
  const { body } = JSON.parse(run('gh', ['release', 'view', tag, '--json', 'body']));

  const newBody = buildReleaseNotes({ messages, readme, repo, tag, body: body || '', log: console.log });
  if (newBody === null) return;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'release-visual-')), 'notes.md');
  fs.writeFileSync(file, newBody);
  run('gh', ['release', 'edit', tag, '--notes-file', file]);
  console.log(`${tag}: release body edited — showcase section appended.`);
}

module.exports = { buildReleaseNotes, MARKER };

if (require.main === module) main();
