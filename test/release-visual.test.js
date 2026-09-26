'use strict';
// Release visuals (t-7e1a): the pure builder behind release.yml's "Append release visuals" step.
// It is required straight from scripts/ — no process is spawned; the git/gh wrapper around it is
// CI-only and its live run is VERIFICATION.md item 55.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildReleaseNotes, MARKER } = require('../scripts/release-visual.js');

const REPO = 'owner/repo';
const TAG = 'v3.26.0';

// A docs/showcase/README.md fixture in the real page's shape: <a><img src="gifs/…" … alt="…"></a>.
const README = [
  '<!-- loopboard:showcase:begin -->',
  '<p align="center">',
  '  <a href="gifs/01-the-loop.gif"><img src="gifs/01-the-loop.gif" width="860" alt="One story travels the whole loop" /></a>',
  '</p>',
  '<td width="33%" valign="top">',
  '  <a href="gifs/11-auto-promote.gif"><img src="gifs/11-auto-promote.gif" width="100%" alt="Right-click Promote arms an automatic promote" /></a>',
  '</td>',
  '<!-- loopboard:showcase:end -->',
  '',
].join('\n');

// What semantic-release's release-notes-generator writes.
const BODY = [
  '## [3.26.0](https://github.com/owner/repo/compare/v3.25.0...v3.26.0) (2026-09-26)',
  '',
  '',
  '### Features',
  '',
  '* **board:** right-click Promote arms an automatic promote ([#181](https://github.com/owner/repo/issues/181)) ([57ad932](https://github.com/owner/repo/commit/57ad932))',
  '',
  '### Bug Fixes',
  '',
  '* **sidebar:** loop-row click toggles the real panel state ([#178](https://github.com/owner/repo/issues/178)) ([5400a87](https://github.com/owner/repo/commit/5400a87))',
  '',
].join('\n');

// A squash commit as GitHub writes it with COMMIT_MESSAGES: the trailer sits mid-body.
const DESIGNATED = [
  'feat(board): right-click Promote arms an automatic promote (t-39e2) (#181)',
  '',
  '* feat(board): right-click Promote arms an automatic promote',
  '',
  'Release-Visual: 11-auto-promote.gif',
  '',
  '* docs(showcase): record the auto-promote scene',
].join('\n');

const build = (over) => buildReleaseNotes({ readme: README, repo: REPO, tag: TAG, body: BODY, ...over });
const images = (text) => text.match(/!\[/g) || [];

test('one Release-Visual trailer yields exactly one tag-pinned image captioned with its alt', () => {
  const out = build({ messages: ['fix: something unrelated', DESIGNATED] });
  assert.equal(typeof out, 'string');
  assert.equal(images(out).length, 1, 'exactly one image');
  const url = 'https://raw.githubusercontent.com/owner/repo/v3.26.0/docs/showcase/gifs/11-auto-promote.gif';
  assert.ok(
    out.includes(`![Right-click Promote arms an automatic promote](${url})`),
    'image URL is pinned to the tag and the caption is the README alt text',
  );
  assert.ok(!out.includes('01-the-loop.gif'), 'an undesignated GIF from the README is not added');
});

test('a trailer repeated across commits still adds its GIF once', () => {
  const out = build({ messages: [DESIGNATED, 'chore: re-record\n\nRelease-Visual: 11-auto-promote.gif'] });
  assert.equal(images(out).length, 1);
});

test('a GIF changed in the range without a trailer contributes nothing; no trailer means no edit', () => {
  const messages = [
    'docs(showcase): re-record 01-the-loop.gif\n\nUpdates docs/showcase/gifs/01-the-loop.gif.',
    'fix(sidebar): loop-row click toggles the real panel state (t-9c3f) (#178)',
  ];
  assert.equal(build({ messages }), null, 'no designated GIF → null (no edit), not an empty section');
  // Mixed with a designated one, the undesignated re-recording still adds nothing.
  const out = build({ messages: [...messages, DESIGNATED] });
  assert.equal(images(out).length, 1);
  assert.ok(!out.includes('01-the-loop.gif'));
});

test('a trailer naming a GIF with no <img> in the README is skipped, not thrown', () => {
  const log = [];
  const messages = ['feat: x\n\nRelease-Visual: 99-missing.gif'];
  assert.doesNotThrow(() => build({ messages, log: (l) => log.push(l) }));
  assert.equal(build({ messages }), null, 'the only designated GIF was skipped → no edit');
  assert.ok(log.some((l) => /skip 99-missing\.gif/.test(l)), 'the skip is logged with its reason');
  // Next to a valid one, only the valid one lands.
  const out = build({ messages: [...messages, DESIGNATED] });
  assert.equal(images(out).length, 1);
  assert.ok(!out.includes('99-missing.gif'));
});

test('a malformed trailer value is skipped, not thrown', () => {
  const messages = ['feat: x\n\nRelease-Visual: docs/showcase/gifs/../../secret.gif'];
  assert.equal(build({ messages }), null);
});

test('the section is appended after Features / Bug Fixes with the existing body byte-for-byte', () => {
  const out = build({ messages: [DESIGNATED] });
  assert.ok(out.startsWith(BODY), 'the existing body is an untouched prefix');
  const section = out.slice(BODY.length);
  assert.ok(section.trimStart().startsWith(MARKER), 'the section starts with its fixed marker');
  assert.ok(out.indexOf(MARKER) > out.indexOf('### Bug Fixes'), 'the section comes last');
  assert.ok(out.indexOf(MARKER) > out.indexOf('### Features'));
  // A body without a trailing newline is kept as is, too.
  const bare = BODY.trimEnd();
  assert.ok(build({ messages: [DESIGNATED], body: bare }).startsWith(bare + '\n\n' + MARKER));
});

test('a body that already carries the marker is left untouched (idempotent re-run)', () => {
  const once = build({ messages: [DESIGNATED] });
  assert.equal(build({ messages: [DESIGNATED], body: once }), null);
});
