'use strict';
// Grammar v4 index parser/writer (`.loopboard/TODO.md` + `.loopboard/DONE.md`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseTodo, parseDone, getTasksExtras } = require('../out-test/parser.js');
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

const FIXTURES = ['index-full.md', 'index-unknown.md', 'index-legacy-note.md'];

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

test('[C7] canonical index fixtures round-trip byte-for-byte', () => {
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

test('[C7] HTML comment after tasks is not parsed as a task', () => {
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

test('feedback: sub-bullets on a non-Review phase parse (repeatable) and round-trip (t-ae10: were note:)', () => {
  const doc = parseTodo(readFix('index-full.md'));
  const e = doc.entries.find((x) => x.id === 't-bb01');
  assert.deepEqual(e.feedback, ['Rebase on main before opening the PR.', 'Add a metric for retry count.']);
  assert.equal(e.notes, undefined, 'the notes field is gone');
  assert.equal(serializeTodo(parseTodo(serializeTodo(doc))), serializeTodo(doc), 'fixpoint');
});

test('[D13] legacy note: lines read as feedback: items in encounter order; the writer emits only feedback: (t-ae10)', () => {
  const src = readFix('index-legacy-note.md');
  const doc = parseTodo(src);
  const e = doc.entries.find((x) => x.id === 't-ln01');
  assert.deepEqual(e.feedback, ['Rebase on main before opening the PR.', 'Keep the retry cap at 3.', 'Add a metric for retry count.']);
  assert.deepEqual(e.unknownLines, [], 'a legacy note: is recognized, never an unparsed line');
  const draft = doc.entries.find((x) => x.id === 't-ln02');
  assert.deepEqual(draft.feedback, ['Include the cursor format in the story.']);
  const once = serializeTodo(doc);
  assert.doesNotMatch(once, /- note:/, 'no note: line survives the first save');
  assert.match(once, /  - feedback: Rebase on main before opening the PR\.\n  - feedback: Keep the retry cap at 3\.\n  - feedback: Add a metric for retry count\./);
  assert.match(once, /  - id: t-ln02\n  - feedback: Include the cursor format in the story\./, 'the draft keeps its item');
  // The canonicalized output is itself a parse→write fixpoint, as text and as entries.
  assert.equal(serializeTodo(parseTodo(once)), once, 'idempotent as text');
  assert.deepEqual(entries(serializeTodo(parseTodo(once))), entries(once));
});

test('a DRAFT carrying feedback: survives parse→write (t-ae10: the draft branch emits it)', () => {
  const src = [
    '## Tasks',
    '',
    '- [ ] DRAFT: raw draft text',
    '  - id: t-df01',
    '  - groomer: sonnet',
    '  - feedback: first item',
    '  - feedback: second item',
    '',
  ].join('\n');
  const doc = parseTodo(src);
  const d = doc.entries.find((x) => x.id === 't-df01');
  assert.equal(d.isDraft, true);
  assert.deepEqual(d.feedback, ['first item', 'second item']);
  const out = serializeTodo(doc);
  assert.match(out, /  - groomer: sonnet\n  - feedback: first item\n  - feedback: second item/);
  assert.doesNotMatch(out, /- phase:/, 'still no phase line on a draft');
  assert.deepEqual(parseTodo(out).entries.find((x) => x.id === 't-df01').feedback, ['first item', 'second item']);
  assert.equal(serializeTodo(parseTodo(out)), out, 'fixpoint');
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
  assert.ok(!('rev' in doc.entries[0]), 'no rev property is set on the entry at all');
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
  assert.ok(!('rev' in doc.entries[0]));
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

// ---- t-c4d1: the writer fold (item 1) and the HTML-comment opener inside a value (item 6) ----
function fixpoint(text) {
  assert.equal(serializeTodo(parseTodo(text)), text, 'the first write is a fixpoint');
}
function handBuilt(br) {
  return {
    id: 't-1', title: `first${br}second`, phase: 'feedback', checked: false, isDraft: false,
    questions: [{ text: `Q one${br}continued?`, answer: `yes${br}- feedback: injected`, suggestions: [`sug${br}- [ ] phantom`] }],
    feedback: [`fb one${br}fb two`], unknownLines: [], raw: '',
  };
}

test('[B1] the writer emits a hand-built multi-line (\\n) entry one line per value; fixpoint', () => {
  const doc = parseTodo('# TODO\n\n## Tasks\n');
  doc.entries.push(handBuilt('\n'));
  const out = serializeTodo(doc);
  const block = out.slice(out.indexOf('- [ ]'));
  assert.deepEqual(block.trimEnd().split('\n'), [
    '- [ ] first second',
    '  - id: t-1',
    '  - phase: feedback',
    '  - question: Q one continued?',
    '    - answer: yes - feedback: injected',
    '    - suggestion: sug - [ ] phantom',
    '  - feedback: fb one fb two',
  ]);
  const back = parseTodo(out);
  assert.equal(back.entries.length, 1, 'entry count unchanged');
  assert.deepEqual(back.entries[0].feedback, ['fb one fb two'], 'no injected feedback item');
  fixpoint(out);
});

test('[B2] the writer folds CRLF and a lone CR too; fixpoint', () => {
  for (const br of ['\r\n', '\r']) {
    const doc = parseTodo('# TODO\n\n## Tasks\n');
    doc.entries.push(handBuilt(br));
    const out = serializeTodo(doc);
    assert.ok(!out.includes('\r'), JSON.stringify(br));
    assert.ok(out.includes('- [ ] first second\n'));
    assert.ok(out.includes('    - answer: yes - feedback: injected\n'));
    assert.equal(parseTodo(out).entries.length, 1);
    fixpoint(out);
  }
});

test('[B3] serializeDone emits a multi-line title on one line; parseDone reads the same entries back', () => {
  const entries = [
    { id: 't-d1', title: 'done\none', phase: 'done', checked: true, isDraft: false, questions: [], feedback: [], unknownLines: [], raw: '', completed: '2026-09-01' },
    { id: 't-d2', title: 'done two', phase: 'done', checked: true, isDraft: false, questions: [], feedback: [], unknownLines: [], raw: '', completed: '2026-09-02' },
  ];
  const out = serializeDone(entries);
  assert.ok(out.includes('- [x] done one\n  - id: t-d1'));
  const back = parseDone(out);
  assert.deepEqual(back.map((e) => [e.id, e.title, e.completed]), [['t-d1', 'done one', '2026-09-01'], ['t-d2', 'done two', '2026-09-02']]);
  assert.equal(serializeDone(back), out);
});

test('[B4] a DRAFT with a multi-line feedback item writes ONE feedback: line; fixpoint', () => {
  const doc = parseTodo('# TODO\n\n## Tasks\n\n- [ ] DRAFT: x\n  - id: t-1\n');
  doc.entries[0].feedback.push('fold\nthis in');
  const out = serializeTodo(doc);
  assert.deepEqual(out.split('\n').filter((l) => l.startsWith('  - feedback:')), ['  - feedback: fold this in']);
  fixpoint(out);
});

const THREE = (first) => [
  '# TODO', '', '## Tasks', '',
  ...first,
  '',
  '- [ ] second', '  - id: t-2', '  - phase: backlog', '  - model: opus',
  '',
  '- [ ] third', '  - id: t-3', '  - phase: review', '  - feedback: ship it',
  '',
].join('\n');

test('[C1] a title containing the comment opener with no closer keeps its entry and every later one', () => {
  const src = THREE(['- [ ] fix the <!-- marker', '  - id: t-1', '  - phase: new', '  - groomer: opus']);
  const doc = parseTodo(src);
  assert.deepEqual(doc.entries.map((e) => [e.id, e.title]), [['t-1', 'fix the <!-- marker'], ['t-2', 'second'], ['t-3', 'third']]);
  assert.equal(doc.entries[0].groomer, 'opus');
  assert.equal(doc.entries[1].model, 'opus');
  assert.deepEqual(doc.entries[2].feedback, ['ship it']);
  assert.equal(getTasksExtras(doc), '', 'no section extras');
  fixpoint(serializeTodo(doc));
});

test('[C2] a title containing a complete <!-- x --> behaves the same', () => {
  const src = THREE(['- [ ] keep <!-- x --> here', '  - id: t-1', '  - phase: new', '  - groomer: opus']);
  const doc = parseTodo(src);
  assert.deepEqual(doc.entries.map((e) => e.id), ['t-1', 't-2', 't-3']);
  assert.equal(doc.entries[0].title, 'keep <!-- x --> here');
  assert.equal(doc.entries[0].groomer, 'opus');
  assert.equal(getTasksExtras(doc), '');
  fixpoint(serializeTodo(doc));
});

test('[C3] a feedback: item containing <!-- x --> keeps the next item in the entry', () => {
  const src = THREE(['- [ ] first', '  - id: t-1', '  - phase: inprogress', '  - feedback: keep the <!-- x --> marker', '  - feedback: second item']);
  const doc = parseTodo(src);
  assert.deepEqual(doc.entries[0].feedback, ['keep the <!-- x --> marker', 'second item']);
  assert.equal(doc.entries.length, 3);
  assert.equal(getTasksExtras(doc), '');
  fixpoint(serializeTodo(doc));
});

test('[C4] an answer: containing the opener keeps the next question and its answer', () => {
  const src = THREE(['- [ ] first', '  - id: t-1', '  - phase: feedback', '  - question: Q1?', '    - answer: use <!-- this', '  - question: Q2?', '    - answer: b']);
  const doc = parseTodo(src);
  assert.deepEqual(doc.entries[0].questions.map((q) => [q.text, q.answer]), [['Q1?', 'use <!-- this'], ['Q2?', 'b']]);
  assert.equal(doc.entries.length, 3);
  fixpoint(serializeTodo(doc));
});

test('[C5] a question: and a suggestion: containing the opener (loop-written) stay intact', () => {
  const src = THREE(['- [ ] first', '  - id: t-1', '  - phase: new', '  - question: keep <!-- or not?', '    - answer:', '    - suggestion: yes <!-- keep', '    - suggestion: no']);
  const doc = parseTodo(src);
  const q = doc.entries[0].questions;
  assert.deepEqual(q.map((x) => [x.text, x.answer, x.suggestions]), [['keep <!-- or not?', '', ['yes <!-- keep', 'no']]]);
  assert.equal(doc.entries.length, 3);
  fixpoint(serializeTodo(doc));
});

test('[C6] a DONE.md title containing the opener keeps all three entries', () => {
  const src = [
    '# DONE', '', 'Accepted tasks, newest first. Detail remains in tasks/<id>.md.', '', '## Tasks', '',
    '- [x] ship the <!-- marker', '  - id: t-1', '  - completed: 2026-09-03', '',
    '- [x] two', '  - id: t-2', '  - completed: 2026-09-02', '',
    '- [x] three', '  - id: t-3', '  - completed: 2026-09-01', '',
  ].join('\n');
  const back = parseDone(src);
  assert.deepEqual(back.map((e) => [e.id, e.title, e.completed]), [['t-1', 'ship the <!-- marker', '2026-09-03'], ['t-2', 'two', '2026-09-02'], ['t-3', 'three', '2026-09-01']]);
  assert.equal(serializeDone(back), src);
});

test('[D8] two adjacent feedback: lines already on disk stay two items after parse→write (no migration)', () => {
  const src = '# TODO\n\n## Tasks\n\n- [ ] T\n  - id: t-1\n  - phase: inprogress\n  - feedback: part one\n  - feedback: part two\n';
  const doc = parseTodo(src);
  assert.deepEqual(doc.entries[0].feedback, ['part one', 'part two']);
  assert.equal(serializeTodo(doc), src);
});
