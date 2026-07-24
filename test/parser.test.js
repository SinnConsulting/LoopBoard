'use strict';
// Grammar v4 index parser/writer (`.loopboard/TODO.md` + `.loopboard/DONE.md`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseTodo, parseDone } = require('../out-test/parser.js');
const { serializeTodo, serializeDone, serializeEntry } = require('../out-test/writer.js');

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

test('haiku is accepted as a model:/groomer: value and round-trips', () => {
  const src = ['# TODO', '', '## Tasks', '', '- [ ] Haiku task', '  - id: t-hk01', '  - phase: backlog', '  - model: haiku', '  - groomer: haiku'].join('\n');
  const doc = parseTodo(src);
  assert.equal(doc.entries[0].model, 'haiku');
  assert.equal(doc.entries[0].groomer, 'haiku');
  assert.equal(doc.entries[0].unknownLines.length, 0, 'not dropped to unknownLines');
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

// ------------------------------------------------------------------ rev: change marker (t-9d5c)

const REV_SRC = [
  '# TODO',
  '',
  '## Tasks',
  '',
  '- [ ] Task with a rev marker',
  '  - id: t-rv01',
  '  - phase: backlog',
  '  - model: opus',
  '  - rev: 3',
].join('\n');

test('rev: parses as an integer and serializes after groomer', () => {
  const doc = parseTodo(REV_SRC);
  assert.equal(doc.entries[0].rev, 3);
  const lines = serializeTodo(doc).split('\n');
  const modelIdx = lines.findIndex((l) => l.trim() === '- model: opus');
  assert.match(lines[modelIdx + 1], /- rev: 3/, 'rev follows model/groomer');
});

test('rev: is fixpoint-stable and round-trips (parse->write->parse)', () => {
  const once = serializeTodo(parseTodo(REV_SRC));
  const twice = serializeTodo(parseTodo(once));
  assert.equal(twice, once, 'idempotent as text');
  assert.equal(parseTodo(once).entries[0].rev, 3, 'value preserved');
});

test('missing rev: tolerated (undefined), never emitted', () => {
  const src = ['# TODO', '', '## Tasks', '', '- [ ] No rev', '  - id: t-rv02', '  - phase: new'].join('\n');
  const doc = parseTodo(src);
  assert.equal(doc.entries[0].rev, undefined);
  assert.doesNotMatch(serializeTodo(doc), /- rev:/);
});

test('non-integer rev: lands in unknownLines (preserved, not parsed)', () => {
  const src = ['# TODO', '', '## Tasks', '', '- [ ] Bad rev', '  - id: t-rv03', '  - phase: new', '  - rev: abc'].join('\n');
  const doc = parseTodo(src);
  assert.equal(doc.entries[0].rev, undefined);
  assert.deepEqual(doc.entries[0].unknownLines, ['  - rev: abc']);
});

test('serializeEntry differs ONLY in the rev line when rev changes (fingerprint excludes rev)', () => {
  // The store bumps rev iff the entry serialized WITHOUT rev changes; this proves re-emitting a
  // bumped rev is the sole textual delta on an otherwise-unchanged entry (no self-perpetuating bump).
  const base = parseTodo(REV_SRC).entries[0];
  const a = serializeEntry({ ...base, rev: 3 }).join('\n');
  const b = serializeEntry({ ...base, rev: 4 }).join('\n');
  assert.notEqual(a, b);
  assert.equal(a.replace('- rev: 3', ''), b.replace('- rev: 4', ''), 'only the rev line differs');
  // And with rev excluded entirely, the two fingerprints are identical.
  assert.equal(
    serializeEntry({ ...base, rev: undefined }).join('\n'),
    serializeEntry({ ...base, rev: 99 }).join('\n').replace('\n  - rev: 99', ''),
  );
});
