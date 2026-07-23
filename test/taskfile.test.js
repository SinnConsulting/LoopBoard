'use strict';
// `.loopboard/tasks/<id>.md` parser/writer (§2.2).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseTaskFile, serializeTaskFile } = require('../out-test/taskfile.js');

const FIX = path.join(process.cwd(), 'test', 'fixtures');
function readFix(name) {
  return fs.readFileSync(path.join(FIX, name), 'utf8');
}

test('parses every canonical section', () => {
  const d = parseTaskFile(readFix('taskfile-full.md'));
  assert.equal(d.owner, '@claude');
  assert.equal(d.added, '2026-07-07');
  assert.equal(d.started, '2026-07-08');
  assert.deepEqual(d.links, ['https://example.com/pr/141']);
  assert.deepEqual(d.dependsOn, ['t-9c2e', 't-dd01']);
  assert.ok(d.description.startsWith('Retries for failed webhook deliveries.'));
  assert.ok(d.description.includes('Second paragraph'), 'multi-line description preserved');
  assert.deepEqual(d.worklog, ['2026-07-08', '2026-07-09']);
  assert.equal(d.feedback, 'Please redact the auth token from the request log fields.');
  assert.ok(d.delivered.startsWith('Added exponential backoff'));
  assert.equal(d.unknownLines.length, 0);
});

test('fixpoint: serialize(parse(x)) is idempotent', () => {
  const src = readFix('taskfile-full.md');
  const once = serializeTaskFile(parseTaskFile(src), 'Add retry logic to the webhook dispatcher', 't-cc01');
  const twice = serializeTaskFile(parseTaskFile(once), 'Add retry logic to the webhook dispatcher', 't-cc01');
  assert.equal(twice, once);
});

test('canonical fixture round-trips byte-for-byte', () => {
  const src = readFix('taskfile-full.md');
  assert.equal(serializeTaskFile(parseTaskFile(src), 'Add retry logic to the webhook dispatcher', 't-cc01'), src);
});

test('empty file -> empty detail; serialize is just the H1', () => {
  const d = parseTaskFile('');
  assert.equal(d.description, undefined);
  assert.deepEqual(d.worklog, []);
  assert.equal(serializeTaskFile(d, 'Fresh task', 't-0001'), '# Fresh task (t-0001)\n');
});

test('missing sections are omitted on write', () => {
  const d = parseTaskFile('# X (t-1)\n\n## Description\n\nJust a description.\n');
  const out = serializeTaskFile(d, 'X', 't-1');
  assert.ok(out.includes('## Description'));
  assert.ok(!out.includes('## Meta'));
  assert.ok(!out.includes('## Worklog'));
});

test('H1 is rewritten from the index title on save', () => {
  const d = parseTaskFile('# Stale title (t-1)\n\n## Description\n\nBody.\n');
  const out = serializeTaskFile(d, 'Fresh index title', 't-1');
  assert.ok(out.startsWith('# Fresh index title (t-1)'));
  assert.ok(!out.includes('Stale title'));
});

test('meta keys emit in canonical order regardless of input order', () => {
  const d = parseTaskFile(['# X (t-1)', '', '## Meta', '- completed: 2026-07-10', '- owner: @claude', '- added: 2026-07-01'].join('\n'));
  const out = serializeTaskFile(d, 'X', 't-1');
  const metaLines = out.split('\n').filter((l) => l.startsWith('- '));
  assert.deepEqual(metaLines, ['- owner: @claude', '- added: 2026-07-01', '- completed: 2026-07-10']);
});

test('unknown headings and unknown meta keys are preserved verbatim + flagged', () => {
  const src = ['# X (t-1)', '', '## Meta', '- owner: @claude', '- priority: high', '', '## Random Section', '', 'freeform content'].join('\n');
  const d = parseTaskFile(src);
  assert.equal(d.owner, '@claude');
  assert.ok(d.unknownLines.includes('- priority: high'), 'unknown meta key flagged');
  assert.ok(d.unknownLines.includes('## Random Section'), 'unknown heading flagged');
  assert.ok(d.unknownLines.includes('freeform content'));
  // Fixpoint holds even with unknown content (it lands at the end on write).
  const once = serializeTaskFile(d, 'X', 't-1');
  const twice = serializeTaskFile(parseTaskFile(once), 'X', 't-1');
  assert.equal(twice, once);
});

test('⚠️ canonicalization: parser strips, writer re-adds a single leading warning', () => {
  const d = parseTaskFile('# X (t-1)\n\n## Feedback\n\nNo emoji here.\n');
  assert.equal(d.feedback, 'No emoji here.');
  const out = serializeTaskFile(d, 'X', 't-1');
  assert.ok(out.includes('⚠️ No emoji here.'));
  // Re-parse does not double the emoji.
  assert.equal(parseTaskFile(out).feedback, 'No emoji here.');
});
