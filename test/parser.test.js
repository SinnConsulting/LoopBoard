'use strict';
// Grammar v4 index parser/writer (`.loopboard/TODO.md` + `.loopboard/DONE.md`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseTodo, parseDone } = require('../out-test/parser.js');
const { serializeTodo, serializeDone } = require('../out-test/writer.js');

const FIX = path.join(process.cwd(), 'test', 'fixtures');
function readFix(name) {
  return fs.readFileSync(path.join(FIX, name), 'utf8');
}

function entryShape(e) {
  const { raw, ...rest } = e;
  return rest;
}
function entries(text) {
  return parseTodo(text).entries.map(entryShape);
}

const FIXTURES = ['index-full.md', 'index-unknown.md'];

for (const name of FIXTURES) {
  test(`text idempotence after normalization: ${name}`, () => {
    const src = readFix(name);
    const once = serializeTodo(parseTodo(src));
    const twice = serializeTodo(parseTodo(once));
    assert.equal(twice, once, 'second serialization must equal the first');
  });

  test(`index fixpoint (parse->write->parse): ${name}`, () => {
    const src = readFix(name);
    const written = serializeTodo(parseTodo(src));
    const a = entries(written);
    const b = entries(serializeTodo(parseTodo(written)));
    assert.deepEqual(b, a);
  });
}

test('canonical index fixtures round-trip byte-for-byte', () => {
  // index-full.md is authored in canonical form, so the first serialization equals the source.
  const src = readFix('index-full.md');
  assert.equal(serializeTodo(parseTodo(src)), src);
});

test('non-canonical (removed) v4 keys land in unknownLines, preserved verbatim', () => {
  const doc = parseTodo(readFix('index-unknown.md'));
  const e = doc.entries.find((x) => x.id === 't-ff01');
  assert.ok(e, 'entry found');
  assert.equal(e.phase, 'inprogress', 'phase is canonical');
  assert.deepEqual(e.unknownLines, [
    '  - owner: @claude',
    '  - added: 2026-07-08',
    '  - description: A normal description.',
    '  - reviewer: @someone',
  ]);
  const out = serializeTodo(doc);
  assert.ok(out.includes('- owner: @claude'));
  assert.ok(out.includes('- description: A normal description.'));
  assert.ok(out.includes('- reviewer: @someone'));
});

test('HTML comment after tasks is not parsed as a task', () => {
  const doc = parseTodo(readFix('index-full.md'));
  // Only the six real entries — not the task-like lines inside the comment template.
  assert.equal(doc.entries.length, 6);
  assert.ok(serializeTodo(doc).includes('Format when a worker parks a task here'), 'comment preserved');
});

test('feedback entry: two questions, one answered', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const e = doc.entries.find((x) => x.id === 't-cc01');
  assert.ok(e);
  assert.equal(e.questions.length, 2);
  assert.ok(e.questions[0].answer.length > 0, 'first answered');
  assert.equal(e.questions[1].answer, '', 'second blank');
});

test('suggestion: sub-sub-bullets parse under their question (repeatable) and round-trip', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const e = doc.entries.find((x) => x.id === 't-cc01');
  assert.deepEqual(e.questions[0].suggestions, [], 'answered question carries no suggestions in this fixture');
  assert.deepEqual(e.questions[1].suggestions, ['Dead-letter to a DB table.', 'Log and drop.']);
  assert.equal(serializeTodo(parseTodo(serializeTodo(doc))), serializeTodo(doc), 'fixpoint');
});

test('orphan suggestion (no preceding question) is dropped, matching the answer guard', () => {
  const src = [
    '## Tasks',
    '',
    '- [ ] Orphan suggestion entry',
    '  - id: t-os01',
    '  - phase: new',
    '    - suggestion: Nothing to attach to.',
    '',
  ].join('\n');
  const doc = parseTodo(src);
  const e = doc.entries.find((x) => x.id === 't-os01');
  assert.deepEqual(e.questions, []);
  assert.deepEqual(e.unknownLines, [], 'matches the pre-existing orphan-answer guard behavior (:96-100)');
});

test('note: sub-bullets parse (repeatable) and round-trip', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const e = doc.entries.find((x) => x.id === 't-bb01');
  assert.deepEqual(e.notes, ['Rebase on main before opening the PR.', 'Add a metric for retry count.']);
  assert.equal(serializeTodo(parseTodo(serializeTodo(doc))), serializeTodo(doc), 'fixpoint');
});

test('feedback: sub-bullets parse (repeatable), strip leading ⚠️, and round-trip', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const e = doc.entries.find((x) => x.id === 't-ee01');
  assert.deepEqual(e.feedback, ['Redact the auth token from the request log fields.']);
  assert.equal(serializeTodo(parseTodo(serializeTodo(doc))), serializeTodo(doc), 'fixpoint');
});

test('question/feedback markers are tolerated on read but never re-emitted on write', () => {
  const src = [
    '## Tasks',
    '',
    '- [ ] Marked entry',
    '  - id: t-mk01',
    '  - phase: feedback',
    '  - question: ❓ Marked question?',
    '    - answer:',
    '  - feedback: ⚠️ Marked feedback.',
    '',
  ].join('\n');
  const doc = parseTodo(src);
  const e = doc.entries.find((x) => x.id === 't-mk01');
  assert.deepEqual(e.questions.map((q) => q.text), ['Marked question?']);
  assert.deepEqual(e.feedback, ['Marked feedback.']);
  const out = serializeTodo(doc);
  assert.ok(!/❓|⚠️|⚠/.test(out), 'serialized output must not re-add the marker');
  assert.match(out, /- question: Marked question\?/);
  assert.match(out, /- feedback: Marked feedback\./);
});

test('DRAFT entries serialize minimally (id, no phase)', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const draft = doc.entries.find((x) => x.isDraft);
  assert.ok(draft);
  assert.equal(draft.phase, 'new', 'drafts are implicitly new');
  const lines = serializeTodo(doc).split('\n');
  const idx = lines.findIndex((l) => l.startsWith('- [ ] DRAFT:'));
  assert.ok(idx >= 0);
  assert.match(lines[idx + 1], /- id:/);
  assert.doesNotMatch(lines[idx + 2] || '', /- phase:/, 'no phase line on drafts');
});

test('model + groomer serialize on drafts (model before groomer) and round-trip', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const draft = doc.entries.find((x) => x.isDraft);
  draft.model = 'sonnet';
  draft.groomer = 'fable';

  const text = serializeTodo(doc);
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.startsWith('- [ ] DRAFT:'));
  assert.match(lines[idx + 1], /- id:/);
  assert.match(lines[idx + 2], /- model: sonnet/);
  assert.match(lines[idx + 3], /- groomer: fable/);

  const doc2 = parseTodo(text);
  const d2 = doc2.entries.find((x) => x.isDraft);
  assert.equal(d2.model, 'sonnet');
  assert.equal(d2.groomer, 'fable');
  assert.equal(serializeTodo(doc2), text, 'fixpoint');
});

// t-65a2: `groomer: none` is the explicit on-hold sentinel. It must parse as a VALUE (not fall
// through to unknownLines, which reads as absent = default groomer — the opposite of hold).
test('groomer: none parses as the on-hold sentinel and round-trips verbatim', () => {
  const src = ['# TODO', '', '## Tasks', '', '- [ ] Held story', '  - id: t-hold', '  - phase: new', '  - groomer: none'].join('\n');
  const doc = parseTodo(src);
  assert.equal(doc.entries[0].groomer, 'none');
  assert.deepEqual(doc.entries[0].unknownLines, [], 'not treated as an unknown line');

  const text = serializeTodo(doc);
  assert.match(text, /- groomer: none/);
  const doc2 = parseTodo(text);
  assert.equal(doc2.entries[0].groomer, 'none', 'survives a second parse');
  assert.equal(serializeTodo(doc2), text, 'fixpoint');
});

test('groomer: none round-trips on a DRAFT too', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const draft = doc.entries.find((x) => x.isDraft);
  draft.groomer = 'none';
  const text = serializeTodo(doc);
  const doc2 = parseTodo(text);
  assert.equal(doc2.entries.find((x) => x.isDraft).groomer, 'none');
  assert.equal(serializeTodo(doc2), text, 'fixpoint');
});

test('an unrecognized model: (e.g. the removed haiku slot) lands in unknownLines, not entry.model', () => {
  const src = ['# TODO', '', '## Tasks', '', '- [ ] Haiku task', '  - id: t-hk01', '  - phase: backlog', '  - model: haiku', '  - groomer: haiku'].join('\n');
  const doc = parseTodo(src);
  assert.equal(doc.entries[0].model, undefined);
  assert.equal(doc.entries[0].groomer, undefined);
  assert.deepEqual(doc.entries[0].unknownLines, ['  - model: haiku', '  - groomer: haiku']);
  assert.equal(serializeTodo(parseTodo(serializeTodo(doc))), serializeTodo(doc), 'fixpoint');
});

test('ids assigned to id-less entries on write', () => {
  const src = ['# TODO', '', '## Tasks', '', '- [ ] A task with no id', '  - phase: new'].join('\n');
  const doc = parseTodo(src);
  assert.equal(doc.entries[0].id, '');
  assert.match(serializeTodo(doc), /- id: t-[0-9a-f]{4}/);
});

test('DONE.md round-trips: [x], id/model/groomer/completed', () => {
  const src = [
    '# DONE',
    '',
    'Accepted tasks, newest first.',
    '',
    '## Tasks',
    '',
    '- [x] Upgrade TypeScript to 5.6',
    '  - id: t-135',
    '  - model: sonnet',
    '  - groomer: opus',
    '  - completed: 2026-07-07',
  ].join('\n');
  const done = parseDone(src);
  assert.equal(done.length, 1);
  assert.equal(done[0].completed, '2026-07-07');
  assert.equal(done[0].model, 'sonnet');
  assert.equal(done[0].groomer, 'opus');
  const out = serializeDone(done);
  assert.ok(out.includes('- [x] Upgrade TypeScript to 5.6'));
  assert.ok(out.includes('- completed: 2026-07-07'));
  assert.ok(out.includes('- model: sonnet'));
  // completed is NOT canonical in the TODO index — it would be an unknown line there.
  const idxEntry = parseTodo(['# TODO', '', '## Tasks', '', '- [ ] X', '  - id: t-1', '  - phase: review', '  - completed: 2026-07-07'].join('\n')).entries[0];
  assert.equal(idxEntry.completed, undefined);
  assert.deepEqual(idxEntry.unknownLines, ['  - completed: 2026-07-07']);
});

test('empty index (no ## Tasks) parses to zero entries', () => {
  const doc = parseTodo('# TODO\n\nNothing here yet.\n');
  assert.equal(doc.entries.length, 0);
});

// -------------------------------------------- rev: removed from the grammar, dropped on parse (t-f1b0)

const REV_SRC = [
  '# TODO',
  '',
  '## Tasks',
  '',
  '- [ ] Task from a tracker that still has rev markers',
  '  - id: t-rv01',
  '  - phase: backlog',
  '  - model: opus',
  '  - rev: 3',
  '',
  '- [ ] DRAFT: a draft with one too',
  '  - id: t-rv02',
  '  - groomer: fable',
  '  - rev: 12',
].join('\n');

test('a stale rev: line is recognized and dropped — never parsed, never an unknown line', () => {
  const doc = parseTodo(REV_SRC);
  assert.equal(doc.entries[0].rev, undefined, 'no rev field survives on the entry');
  assert.deepEqual(doc.entries[0].unknownLines, [], 'not preserved as an unparsed line');
  assert.deepEqual(doc.entries[1].unknownLines, [], 'same on a DRAFT entry');
  const out = serializeTodo(doc);
  assert.doesNotMatch(out, /- rev:/, 'the line is gone from the canonical write');
  // The whole point of recognize-and-drop: no flagged chip on any card, on any entry.
  assert.deepEqual(parseTodo(out).entries.map((e) => e.unknownLines), [[], []]);
});

test('an index arriving WITH rev: lines is still a fixpoint after the first canonical write', () => {
  const once = serializeTodo(parseTodo(REV_SRC));
  const twice = serializeTodo(parseTodo(once));
  assert.equal(twice, once, 'idempotent as text');
  assert.equal(parseTodo(once).entries.length, 2, 'both entries survive the drop');
});

test('any rev: value is dropped, integer or not — the key means nothing now', () => {
  const src = ['# TODO', '', '## Tasks', '', '- [ ] Bad rev', '  - id: t-rv03', '  - phase: new', '  - rev: abc'].join('\n');
  const doc = parseTodo(src);
  assert.equal(doc.entries[0].rev, undefined);
  assert.deepEqual(doc.entries[0].unknownLines, []);
  assert.doesNotMatch(serializeTodo(doc), /- rev:/);
});

// ---------------------------------------------------- delete: removal round-trips (t-d58a)

test('removing a task and re-serializing round-trips the remaining tasks and extras verbatim', () => {
  // Deletion in the store is a whole-entry splice from doc.entries followed by serializeTodo; this
  // proves the survivors (and the HTML-comment template extra) are untouched and the result is a
  // stable fixpoint.
  const doc = parseTodo(readFix('index-full.md'));
  const before = doc.entries.map((e) => e.id);
  const removeIdx = doc.entries.findIndex((e) => e.id === 't-cc01');
  assert.ok(removeIdx >= 0, 'target present before removal');

  doc.entries.splice(removeIdx, 1);
  const out = serializeTodo(doc);
  const reparsed = parseTodo(out);

  assert.deepEqual(reparsed.entries.map((e) => e.id), before.filter((id) => id !== 't-cc01'),
    'exactly the removed id is gone; order preserved');
  assert.ok(out.includes('Format when a worker parks a task here'), 'section extras (HTML comment) preserved');
  assert.equal(serializeTodo(parseTodo(out)), out, 'fixpoint after removal');
});

test('removing a DONE entry round-trips the remaining accepted rows', () => {
  const done = parseDone([
    '# DONE', '', '## Tasks', '',
    '- [x] First accepted', '  - id: t-dn01', '  - completed: 2026-07-20',
    '', '- [x] Second accepted', '  - id: t-dn02', '  - model: opus', '  - completed: 2026-07-21',
  ].join('\n'));
  assert.equal(done.length, 2);

  const remaining = done.filter((e) => e.id !== 't-dn01');
  const out = serializeDone(remaining);
  const reparsed = parseDone(out);

  assert.deepEqual(reparsed.map((e) => e.id), ['t-dn02'], 'only the removed row is gone');
  assert.equal(reparsed[0].completed, '2026-07-21', 'survivor fields intact');
  assert.equal(serializeDone(parseDone(out)), out, 'fixpoint after removal');
});
