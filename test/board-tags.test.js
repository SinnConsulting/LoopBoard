'use strict';
// Tags in the webview (t-0b10). media/board.js is a webview asset the Docker suite never loads, so
// the pure helpers (`taskMatches`, `normTag`) run for real via vm extraction — the pattern of
// test/board-review-feedback.test.js — and the rest is pinned as source-text invariants. The live
// behaviour is VERIFICATION.md item 67 (untested).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { normalizeTag } = require('../out-test/tags.js');

const media = path.resolve(__dirname, '..', 'media');
const source = fs.readFileSync(path.join(media, 'board.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(media, 'sidebar.js'), 'utf8');

function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'media/board.js must define ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}
const code = (text) => text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(extractFunction('taskMatches') + '\n' + extractFunction('normTag'), ctx);
const { taskMatches, normTag } = ctx;

const T = (over) => Object.assign({ id: 't-1', title: 'Fix it', isDraft: false, questions: [], tags: [], problem: '', description: '', goals: '' }, over);

test('tag:<name> keeps only tasks carrying that tag, case-insensitively', () => {
  const bug = T({ id: 't-1', tags: ['bug', 'ui'] });
  const feat = T({ id: 't-2', tags: ['feature'] });
  const none = T({ id: 't-3', tags: [] });
  assert.equal(taskMatches(bug, 'tag:bug'), true);
  assert.equal(taskMatches(bug, 'TAG:Bug'), true);
  assert.equal(taskMatches(feat, 'tag:bug'), false);
  assert.equal(taskMatches(none, 'tag:bug'), false);
  assert.equal(taskMatches(T({ tags: ['bugfix'] }), 'tag:bug'), false, 'exact, not a prefix');
  assert.equal(taskMatches(T({ tags: undefined }), 'tag:bug'), false);
});

test('tag:<name> ANDs with free text, is:draft and task:<id>', () => {
  const draft = T({ id: 't-1', title: 'Reload banner', isDraft: true, tags: ['bug'] });
  const card = T({ id: 't-2', title: 'Reload banner', tags: ['bug'] });
  assert.equal(taskMatches(card, 'tag:bug reload'), true);
  assert.equal(taskMatches(card, 'tag:bug nothing-like-this'), false);
  assert.equal(taskMatches(draft, 'tag:bug is:draft'), true);
  assert.equal(taskMatches(card, 'tag:bug is:draft'), false);
  assert.equal(taskMatches(card, 'tag:bug task:t-2'), true);
  assert.equal(taskMatches(card, 'tag:bug task:t-9'), false);
  assert.equal(taskMatches(card, 'tag:feature task:t-2'), false);
});

test('the existing tokens and an empty query are unchanged', () => {
  assert.equal(taskMatches(T(), ''), true);
  assert.equal(taskMatches(T({ title: 'Hello' }), 'hello'), true);
  assert.equal(taskMatches(T({ isDraft: true }), 'is:proposal'), false);
  assert.equal(taskMatches(T({ questions: [{ answered: false }] }), 'is:unanswered'), true);
  assert.match(code(source), /function matchesQuery\(t\) \{ return taskMatches\(t, effectiveQuery\(\)\); \}/);
});

test('the webview name rule agrees with the host normalizeTag', () => {
  for (const s of ['bug', '  Bug ', 'Two  Words', 'a,b', 'a:b', '--x--', '', '   ', 'UI/UX', 'ÄÖ Ü']) {
    assert.equal(normTag(s), normalizeTag(s), JSON.stringify(s));
  }
});

test('tag chips: name opens the overview, dot sets the color, x removes; Done chips are read-only', () => {
  const chip = extractFunction('tagChip');
  assert.match(code(chip), /openTagOverview\(name\)/);
  assert.match(code(chip), /commitTags\(t, \(t\.tags \|\| \[\]\)\.filter\(/);
  assert.match(code(chip), /if \(editable\) \{/);
  const done = extractFunction('renderDone');
  assert.match(code(done), /tagNodes\(t, false\)/, 'Done rows draw read-only chips');
  assert.match(code(extractFunction('renderChips')), /chips\.append\(\.\.\.tagNodes\(t, true\)\)/, 'every active card, collapsed too');
  assert.match(code(extractFunction('renderDraft')), /tagNodes\(t, true\)/, 'drafts too');
});

test('a tag edit is one `tags` field patch with the comma-joined list; a color goes to the registry', () => {
  const commit = extractFunction('commitTags');
  assert.match(code(commit), /sendPatch\(t\.id, 'tags', value, base\)/);
  assert.match(code(commit), /next\.join\(', '\)/);
  const color = extractFunction('setTagColorLocal');
  assert.match(code(color), /post\(\{ type: 'setTagColor', tag: name, color, base \}\)/);
});

test('the palette offers exactly the six charts colors plus none, mapped to the charts theme variables', () => {
  assert.match(source, /const TAG_COLORS = \['red', 'orange', 'yellow', 'green', 'blue', 'purple'\];/);
  const css = fs.readFileSync(path.join(media, 'board.css'), 'utf8');
  for (const c of ['red', 'orange', 'yellow', 'green', 'blue', 'purple']) {
    assert.match(css, new RegExp('\\.tagc-' + c + ' \\{ --tc: var\\(--vscode-charts-' + c + ','));
  }
});

test('the overview is a closable tab persisted in the webview state, opened by a reveal carrying `tag`', () => {
  assert.match(code(extractFunction('saveState')), /overviewTag, overviewSelected, lastTag, tagGroups/);
  assert.match(source, /if \(typeof msg\.tag === 'string'\) openTagOverview\(msg\.tag\);/);
  const render = extractFunction('renderTagOverview');
  assert.match(code(render), /revealTask\(r\.id, p\.key, false, 'task:' \+ r\.id\)/, 'a row reveals the task on its own tab');
  assert.match(code(render), /openTagOverview\(g\.name\)/, 'the picker switches tags');
  assert.match(code(extractFunction('renderTopbar')), /closeTagOverview/);
});

test('the sidebar has ONE Tags entry, only while tags are in use, and no per-tag row', () => {
  assert.match(sidebar, /const inUse = board\.tagsInUse \|\| \[\];\s*\n\s*if \(inUse\.length\) \{/);
  assert.equal(sidebar.split("type: 'reveal', tag: ''").length - 1, 1, 'one entry that opens the overview');
  assert.doesNotMatch(code(sidebar), /board\.tags\b/, 'the sidebar never iterates the tag list');
  assert.doesNotMatch(code(sidebar), /inUse\.(map|forEach)|for \(const \w+ of inUse\)/, 'no row per tag');
});
