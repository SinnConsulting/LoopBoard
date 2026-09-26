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
  assert.equal(d.added, '2026-07-07');
  assert.equal(d.started, '2026-07-08');
  assert.deepEqual(d.links, ['https://example.com/pr/141']);
  assert.deepEqual(d.dependsOn, ['t-9c2e', 't-dd01']);
  assert.ok(d.problem.startsWith('Failed webhook deliveries are dropped'));
  assert.ok(d.description.startsWith('Retries for failed webhook deliveries.'));
  assert.ok(d.description.includes('Second paragraph'), 'multi-line description preserved');
  assert.equal(
    d.goals,
    '- A failed delivery is retried with exponential backoff before it is dropped.\n- The retry count is visible in the dispatcher\'s metrics.',
    'Goals is free markdown, kept verbatim — never parsed into a list',
  );
  assert.deepEqual(d.worklog, [
    '2026-07-08',
    '2026-07-09 (opus): claim blocked\n  continuation line one\n  continuation line two',
  ]);
  assert.ok(d.delivered.startsWith('Added exponential backoff'));
  assert.equal(d.unknownLines.length, 0);
});

test('wrapped worklog continuation lines attach to their entry, not unknownLines', () => {
  const src = readFix('taskfile-full.md');
  const d = parseTaskFile(src);
  assert.equal(d.worklog.length, 2, 'continuation lines must not become extra worklog entries');
  assert.equal(d.unknownLines.length, 0, 'continuation lines must not land in unknownLines');
});

test('fixpoint: serialize(parse(x)) is idempotent', () => {
  const src = readFix('taskfile-full.md');
  const once = serializeTaskFile(parseTaskFile(src), 'Add retry logic to the webhook dispatcher', 't-cc01');
  const twice = serializeTaskFile(parseTaskFile(once), 'Add retry logic to the webhook dispatcher', 't-cc01');
  assert.equal(twice, once);
});

test('[H12] canonical fixture round-trips byte-for-byte', () => {
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
  // t-2191: Problem/Goals are optional — a task file that predates them stays exactly as it was.
  assert.ok(!out.includes('## Problem'));
  assert.ok(!out.includes('## Goals'));
});

// ---- Problem / Goals (t-2191) ----

test('Problem and Goals are emitted in canonical order however the input ordered them', () => {
  const src = [
    '# X (t-1)', '',
    '## Goals', '', '- Ships.', '',
    '## Delivered', '', 'Shipped.', '',
    '## Description', '', 'Story.', '',
    '## Problem', '', 'It is broken.', '',
    '## Meta', '- added: 2026-09-20',
  ].join('\n');
  const out = serializeTaskFile(parseTaskFile(src), 'X', 't-1');
  const headings = out.split('\n').filter((l) => l.startsWith('## '));
  assert.deepEqual(headings, ['## Meta', '## Problem', '## Description', '## Goals', '## Delivered']);
});

test('an empty Problem/Goals section is dropped, not written back as a bare heading', () => {
  const d = parseTaskFile('# X (t-1)\n\n## Problem\n\n\n## Goals\n\n## Description\n\nStory.\n');
  assert.equal(d.problem, undefined);
  assert.equal(d.goals, undefined);
  const out = serializeTaskFile(d, 'X', 't-1');
  assert.ok(!out.includes('## Problem'));
  assert.ok(!out.includes('## Goals'));
  assert.ok(!d.unknownLines.length, 'an empty known section is not unknown content');
});

test('Problem and Goals are free markdown: prose Goals and a multi-paragraph Problem round-trip', () => {
  const src = [
    '# X (t-1)', '',
    '## Problem', '', 'First sentence.', '', 'Second paragraph.', '',
    '## Goals', '', 'Written as prose rather than bullets, which the parser must not police.', '',
  ].join('\n');
  const d = parseTaskFile(src);
  assert.equal(d.problem, 'First sentence.\n\nSecond paragraph.');
  assert.equal(d.goals, 'Written as prose rather than bullets, which the parser must not police.');
  const once = serializeTaskFile(d, 'X', 't-1');
  assert.equal(serializeTaskFile(parseTaskFile(once), 'X', 't-1'), once, 'fixpoint holds');
});

test('a hand-written Problem/Goals in a pre-t-2191 file is recognized, not left as unknown content', () => {
  // Before t-2191 these headings landed in unknownLines and were re-emitted at the BOTTOM of the
  // file. They are now parsed content and relocate to their canonical slot on the next save — the
  // same "recognize" direction as the dropped `owner:` key (t-33cb).
  const d = parseTaskFile('# X (t-1)\n\n## Description\n\nStory.\n\n## Problem\n\nWhy.\n');
  assert.equal(d.problem, 'Why.');
  assert.deepEqual(d.unknownLines, []);
  const out = serializeTaskFile(d, 'X', 't-1');
  assert.ok(out.indexOf('## Problem') < out.indexOf('## Description'));
});

test('H1 is rewritten from the index title on save', () => {
  const d = parseTaskFile('# Stale title (t-1)\n\n## Description\n\nBody.\n');
  const out = serializeTaskFile(d, 'Fresh index title', 't-1');
  assert.ok(out.startsWith('# Fresh index title (t-1)'));
  assert.ok(!out.includes('Stale title'));
});

test('meta keys emit in canonical order regardless of input order', () => {
  const d = parseTaskFile(['# X (t-1)', '', '## Meta', '- completed: 2026-07-10', '- started: 2026-07-02', '- added: 2026-07-01'].join('\n'));
  const out = serializeTaskFile(d, 'X', 't-1');
  const metaLines = out.split('\n').filter((l) => l.startsWith('- '));
  assert.deepEqual(metaLines, ['- added: 2026-07-01', '- started: 2026-07-02', '- completed: 2026-07-10']);
});

test('[H5] unknown headings and unknown meta keys are preserved verbatim + flagged', () => {
  const src = ['# X (t-1)', '', '## Meta', '- added: 2026-07-01', '- priority: high', '', '## Random Section', '', 'freeform content'].join('\n');
  const d = parseTaskFile(src);
  assert.ok(d.unknownLines.includes('- priority: high'), 'unknown meta key flagged');
  assert.ok(d.unknownLines.includes('## Random Section'), 'unknown heading flagged');
  assert.ok(d.unknownLines.includes('freeform content'));
  // Fixpoint holds even with unknown content (it lands at the end on write).
  const once = serializeTaskFile(d, 'X', 't-1');
  const twice = serializeTaskFile(parseTaskFile(once), 'X', 't-1');
  assert.equal(twice, once);
});

test('a stale `- owner:` line (t-33cb: removed field) is silently dropped on parse — not unknownLines, never re-emitted', () => {
  const src = ['# X (t-1)', '', '## Meta', '- owner: @claude', '- added: 2026-07-01'].join('\n');
  const d = parseTaskFile(src);
  assert.equal(d.owner, undefined);
  assert.ok(!d.unknownLines.some((l) => l.includes('owner')), 'owner line must not be flagged as an unknown line');
  const out = serializeTaskFile(d, 'X', 't-1');
  assert.ok(!out.includes('owner'), 'owner must never be re-emitted');
});

test('[H8] legacy ## Feedback section is preserved verbatim as unknown content, not parsed', () => {
  const d = parseTaskFile('# X (t-1)\n\n## Feedback\n\n⚠️ No emoji here.\n');
  assert.equal(d.feedback, undefined);
  assert.ok(d.unknownLines.includes('## Feedback'));
  const out = serializeTaskFile(d, 'X', 't-1');
  assert.ok(out.includes('## Feedback'));
  assert.ok(out.includes('⚠️ No emoji here.'));
});

// ---- t-c4d1: `##` hardening (item 5). Inside Problem, Description and Goals only one of the six
// known headings ends the section; any other `## ` line is story text. Meta, Worklog, Delivered and
// unknown sections still end at every `## `. Not fence-aware, by decision.
function firstWrite(src) {
  const out = serializeTaskFile(parseTaskFile(src), 'X', 't-1');
  assert.equal(serializeTaskFile(parseTaskFile(out), 'X', 't-1'), out, 'the first write is a fixpoint');
  return parseTaskFile(out);
}

for (const [id, heading, field] of [['H1', 'Problem', 'problem'], ['H2', 'Description', 'description'], ['H3', 'Goals', 'goals']]) {
  test(`[${id}] a \`## Foo\` line inside ${heading} stays in ${heading}`, () => {
    const src = `# X (t-1)\n\n## ${heading}\n\nintro\n\n## Foo\n\nmore\n\n## Worklog\n- 2026-09-01 groomed\n`;
    const d = parseTaskFile(src);
    assert.equal(d[field], 'intro\n\n## Foo\n\nmore');
    assert.deepEqual(d.unknownLines, []);
    assert.deepEqual(d.worklog, ['2026-09-01 groomed']);
    assert.equal(firstWrite(src)[field], 'intro\n\n## Foo\n\nmore');
  });
}

test('[H4] a Description with a fenced md block containing `## Why` stays intact', () => {
  const body = 'Template:\n\n```md\n## Why\n\nBecause.\n```\n\nAfter the fence.';
  const src = `# X (t-1)\n\n## Description\n\n${body}\n\n## Goals\n\n- g\n`;
  const d = firstWrite(src);
  assert.equal(d.description, body);
  assert.equal(d.goals, '- g');
  assert.deepEqual(d.unknownLines, []);
});

test('[H6] `## Foo` after `## Worklog` is unknownLines; the worklog entries are unchanged', () => {
  const src = '# X (t-1)\n\n## Worklog\n- 2026-09-01 groomed\n- 2026-09-02 started\n\n## Foo\n\nstray\n';
  const d = firstWrite(src);
  assert.deepEqual(d.worklog, ['2026-09-01 groomed', '2026-09-02 started']);
  assert.deepEqual(d.unknownLines.filter((l) => l.trim()), ['## Foo', 'stray']);
});

test('[H7] `## Foo` after `## Delivered` is unknownLines', () => {
  const src = '# X (t-1)\n\n## Delivered\n\nShipped.\n\n## Foo\n\nstray\n';
  const d = firstWrite(src);
  assert.equal(d.delivered, 'Shipped.');
  assert.deepEqual(d.unknownLines.filter((l) => l.trim()), ['## Foo', 'stray']);
});

test('[H9] a known heading inside Description still starts that section (residual gap, pinned)', () => {
  for (const g of ['## Goals', '## goals', '## Goals ']) {
    const src = `# X (t-1)\n\n## Description\n\nd\n\n${g}\n\n- g\n`;
    const d = firstWrite(src);
    assert.equal(d.description, 'd', JSON.stringify(g));
    assert.equal(d.goals, '- g', JSON.stringify(g));
    assert.deepEqual(d.unknownLines, []);
  }
});

test('[H10] a `### Sub` heading inside a section stays in it', () => {
  for (const field of ['problem', 'description', 'goals']) {
    const name = field[0].toUpperCase() + field.slice(1);
    const src = `# X (t-1)\n\n## ${name}\n\na\n\n### Sub\n\nb\n`;
    assert.equal(firstWrite(src)[field], 'a\n\n### Sub\n\nb', field);
  }
  const d = firstWrite('# X (t-1)\n\n## Delivered\n\nx\n\n### Sub\n\ny\n');
  assert.equal(d.delivered, 'x\n\n### Sub\n\ny');
});

test('[H11] a relocated-damage file (cut fence, stray blocks after Delivered) round-trips byte-for-byte', () => {
  const src = readFix('taskfile-relocated.md');
  const d = parseTaskFile(src);
  assert.equal(serializeTaskFile(d, 'Relocated story', 't-rel1'), src);
  assert.equal(d.description, 'Short description.\n\n```md', 'Description ends at the real ## Worklog');
  assert.deepEqual(d.worklog, ['2026-08-01 groomed', '2026-08-02 started']);
  assert.equal(d.delivered, 'Shipped on the branch.');
  for (const h of ['## Part A: the parser', '## Acceptance criteria', '## Why']) assert.ok(d.unknownLines.includes(h), h);
  assert.deepEqual(d.unknownLines.filter((l) => l.trim()).slice(-2), ['fence body line', '```']);
});
