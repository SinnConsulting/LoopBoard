const test = require('node:test');
const assert = require('node:assert');
const { routeEntry, computeNudges, formatNudge, describeChanges, mergeNudgeItems } = require('../out-test/nudge');

let seq = 0;
// A minimal composed Task (index entry + detail), the shape computeNudges diffs. Change detection
// is a TEXT fingerprint of both halves (t-f1b0): `raw` is the index block, `detailRaw` the
// tasks/<id>.md text — so a caller that wants "this entry changed" passes a different one of them.
function entry(over = {}) {
  seq += 1;
  return {
    id: over.id || 't-' + seq,
    title: over.title || 'Some task',
    phase: 'new',
    checked: false,
    isDraft: false,
    questions: [],
    feedback: [],
    unknownLines: [],
    raw: 'raw',
    detailRaw: 'detail',
    worklog: [],
    links: [],
    dependsOn: [],
    hasDetailFile: true,
    ...over,
  };
}

const q = (text, answer = '') => ({ text, answer, suggestions: [] });

// ---- routeEntry: the Rules 14/15 work split, one target (t-0e99) ----

test('New/DRAFT is grooming work, everything from Backlog on is worker work, whatever the models', () => {
  for (const groomer of [undefined, 'fable', 'haiku', 'auto']) {
    assert.deepStrictEqual(routeEntry(entry({ phase: 'new', isDraft: true, groomer, model: 'opus' })), 'groom', String(groomer));
  }
  for (const model of [undefined, 'opus', 'haiku', 'auto']) {
    assert.deepStrictEqual(routeEntry(entry({ phase: 'backlog', groomer: 'fable', model })), 'backlog', String(model));
  }
});

test('an absent routing field changes nothing: every reason goes to the orchestrator', () => {
  assert.deepStrictEqual(routeEntry(entry({ isDraft: true })), 'groom');
  assert.deepStrictEqual(routeEntry(entry({ phase: 'backlog' })), 'backlog');
});

test('groomer: none is ON HOLD — never nudged, whatever changed on it', () => {
  assert.strictEqual(routeEntry(entry({ isDraft: true, groomer: 'none' })), null);
  assert.strictEqual(routeEntry(entry({ phase: 'new', groomer: 'none', feedback: ['do the thing'] })), null);
  assert.strictEqual(
    routeEntry(entry({ phase: 'new', groomer: 'none', questions: [q('pick one', 'this one')] })),
    null,
  );
});

test('a New task whose questions are ALL answered routes as a re-groom', () => {
  const e = entry({ phase: 'new', groomer: 'fable', questions: [q('pick one', 'this one'), q('and this', 'that')] });
  assert.deepStrictEqual(routeEntry(e), 'regroom');
});

test('a New task answered only in part is NOT pushed into a loop — one blank answer parks it', () => {
  const e = entry({ phase: 'new', groomer: 'fable', questions: [q('pick one', 'this one'), q('and this')] });
  assert.strictEqual(routeEntry(e), null);
});

test('a DRAFT with a half-answered question stays a groom, never a partial re-groom', () => {
  const e = entry({ phase: 'new', isDraft: true, groomer: 'fable', questions: [q('pick one', 'this one'), q('and this')] });
  assert.deepStrictEqual(routeEntry(e), 'groom');
});

test('a groomed New task with only blank answers is waiting on the human, not a loop', () => {
  const e = entry({ phase: 'new', groomer: 'fable', questions: [q('pick one'), q('and this')] });
  assert.strictEqual(routeEntry(e), null);
});

test('feedback routes in EVERY phase with one reason, outranking the phase reason (Rule 13, t-ae10)', () => {
  // Backlog onward, whatever the phase and whatever the `model:`.
  for (const phase of ['backlog', 'inprogress', 'feedback', 'review']) {
    assert.deepStrictEqual(
      routeEntry(entry({ phase, model: 'fable', feedback: ['do this'], questions: [q('a')] })),
      'feedback',
      phase,
    );
    assert.deepStrictEqual(routeEntry(entry({ phase, feedback: ['do this'] })), 'feedback', phase + ' default');
  }
  // New and DRAFT: grooming work, outranking regroom/groom.
  assert.deepStrictEqual(
    routeEntry(entry({ phase: 'new', groomer: 'fable', model: 'opus', feedback: ['retitle this'], questions: [q('a', 'yes')] })),
    'feedback',
  );
  assert.deepStrictEqual(
    routeEntry(entry({ isDraft: true, feedback: ['fold this in'] })),
    'feedback',
  );
  // …and never on hold.
  assert.strictEqual(routeEntry(entry({ isDraft: true, groomer: 'none', feedback: ['x'] })), null);
});

test('Feedback routes only when EVERY question is answered (Rule 10)', () => {
  const all = entry({ phase: 'feedback', model: 'fable', questions: [q('a', 'yes'), q('b', 'no')] });
  assert.deepStrictEqual(routeEntry(all), 'answers');
  const partial = entry({ phase: 'feedback', model: 'fable', questions: [q('a', 'yes'), q('b')] });
  assert.strictEqual(routeEntry(partial), null);
  const none = entry({ phase: 'feedback', model: 'fable', questions: [] });
  assert.strictEqual(routeEntry(none), null);
});

test('Review routes only with unaddressed feedback (Rule 13); In Progress without feedback never routes', () => {
  assert.deepStrictEqual(
    routeEntry(entry({ phase: 'review', model: 'opus', feedback: ['make it blue'] })),
    'feedback',
  );
  assert.strictEqual(routeEntry(entry({ phase: 'review', model: 'opus' })), null);
  assert.strictEqual(routeEntry(entry({ phase: 'inprogress', model: 'opus' })), null);
});

// ---- computeNudges: only CHANGED entries, one loop each ----

test('the first board of a session nudges nobody', () => {
  const next = [entry({ phase: 'backlog', model: 'opus' })];
  assert.deepStrictEqual(computeNudges(undefined, next), []);
});

test('an unchanged entry is not nudged again, a changed one is', () => {
  const before = entry({ phase: 'backlog', model: 'opus', raw: 'one' });
  assert.deepStrictEqual(computeNudges([before], [{ ...before }]), []);
  const items = computeNudges([before], [{ ...before, raw: 'two' }]);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].reason, 'backlog');
});

// The capability the removed `rev:` marker existed for (t-f1b0): a human edits the Description or
// a worklog line in tasks/<id>.md and the index block does not move at all. With an index-only
// fingerprint the owning loop would never hear about it.
test('an edit confined to the task file still nudges — the fingerprint covers the detail text', () => {
  const before = entry({ phase: 'backlog', model: 'opus', description: 'old', raw: 'unchanged index block' });
  const next = { ...before, description: 'new', detailRaw: '# t\n\n## Description\n\nnew\n' };
  assert.strictEqual(before.raw, next.raw, 'the index block is byte-identical — only the detail moved');
  const items = computeNudges([before], [next]);
  assert.strictEqual(items.length, 1);
  assert.deepStrictEqual(items[0].changes, ['description edited']);
  // An appended worklog line is the same shape and must behave the same way.
  const appended = { ...before, worklog: ['2026-09-18'], detailRaw: '# t\n\n## Worklog\n\n- 2026-09-18\n' };
  assert.deepStrictEqual(computeNudges([before], [appended])[0].changes, ['worklog appended']);
  // …and the signal is the TEXT, not the parsed detail fields: with EVERY other field byte-identical
  // and only `detailRaw` moved (a reordered Meta block, a heading reflow), the nudge still fires.
  // Pins the detail side the way the `raw: 'canonicalized'` case pins the index side — an
  // implementation diffing parsed detail fields instead of the text would fail here and only here.
  const reflowed = { ...before, detailRaw: before.detailRaw + '\n' };
  assert.deepStrictEqual(computeNudges([before], [reflowed])[0].changes, ['changed']);
  // t-2191: a re-groom that only rewrote Problem or Goals is the same index-silent shape.
  const regroomed = { ...before, problem: 'why', goals: '- done when', detailRaw: '# t\n\n## Problem\n\nwhy\n' };
  assert.deepStrictEqual(computeNudges([before], [regroomed])[0].changes, ['problem edited', 'goals edited']);
});

test('a brand-new entry is a change', () => {
  const fresh = entry({ phase: 'backlog', model: 'opus' });
  const items = computeNudges([], [fresh]);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].taskId, fresh.id);
});

test('changes that give no loop work nudge nobody', () => {
  const before = entry({ phase: 'review', model: 'opus' });
  assert.deepStrictEqual(computeNudges([before], [{ ...before, raw: 'moved' }]), []);
});

test('a Backlog nudge is suppressed while any task is In Progress (Rule 2)', () => {
  const backlog = entry({ phase: 'backlog', model: 'opus' });
  const busy = entry({ phase: 'inprogress', model: 'fable' });
  const next = [{ ...backlog, raw: 'moved' }, busy];
  assert.deepStrictEqual(computeNudges([backlog, busy], next), []);
  // …but grooming and feedback are not Backlog claims, so they still route.
  const draft = entry({ isDraft: true, groomer: 'fable' });
  const items = computeNudges([backlog, busy, draft], [{ ...backlog, raw: 'moved' }, busy, { ...draft, raw: 'moved' }]);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].taskId, draft.id);
  assert.strictEqual(items[0].reason, 'groom');
});

test('every change reaches the one orchestrator once, in board order, whatever its models (t-0e99)', () => {
  const a = entry({ phase: 'feedback', model: 'opus', questions: [q('a', 'yes')] });
  const b = entry({ phase: 'review', model: 'haiku', feedback: ['fix it'] });
  const c = entry({ phase: 'new', groomer: 'fable', feedback: ['fold this in'] });
  const d = entry({ isDraft: true, groomer: 'auto', model: 'auto' });
  const prev = [a, b, c, d];
  const next = [{ ...a, raw: 'moved' }, { ...b, raw: 'moved' }, { ...c, raw: 'moved' }, { ...d, raw: 'moved' }];
  const items = computeNudges(prev, next);
  assert.deepStrictEqual(items.map((i) => i.taskId), [a.id, b.id, c.id, d.id]);
  assert.deepStrictEqual(items.map((i) => i.reason), ['answers', 'feedback', 'feedback', 'groom']);
  assert.ok(items.every((i) => !('model' in i)), 'an item names no loop or model: there is one target');
});

// ---- the New/DRAFT detail-only carve-out (t-6cbf) ----

// The loop writes a groom's tasks/<id>.md FIRST and replaces the `- [ ] DRAFT:` line after (Rule
// 16), so between its two writes the board would nudge "is a draft to groom" into the very loop
// that is grooming it — one wholly empty pass per groomed draft.
test('a DRAFT whose change is confined to the task file nudges nobody (t-6cbf)', () => {
  const before = entry({ isDraft: true, groomer: 'fable', raw: '- [ ] DRAFT: t-1 — do a thing' });
  const next = { ...before, problem: 'why', goals: '- done when', detailRaw: '# t\n\n## Problem\n\nwhy\n' };
  assert.strictEqual(before.raw, next.raw, 'the index block is byte-identical — only the detail moved');
  assert.deepStrictEqual(computeNudges([before], [next]), []);
  // The suppression is surfaced for the controller's verbose debug line: task id + the reason it
  // WOULD have carried.
  const skipped = [];
  computeNudges([before], [next], skipped);
  assert.strictEqual(skipped.length, 1);
  assert.strictEqual(skipped[0].taskId, before.id);
  assert.strictEqual(skipped[0].reason, 'groom');
});

test('the re-groom shape is suppressed the same way — all answers filled, detail-only change (t-6cbf)', () => {
  const before = entry({ phase: 'new', groomer: 'fable', questions: [q('pick one', 'this one')], raw: 'index block' });
  assert.deepStrictEqual(routeEntry(before), 'regroom');
  const next = { ...before, worklog: ['2026-09-21'], detailRaw: '# t\n\n## Worklog\n\n- 2026-09-21\n' };
  assert.deepStrictEqual(computeNudges([before], [next]), []);
  const skipped = [];
  computeNudges([before], [next], skipped);
  assert.deepStrictEqual(skipped.map((i) => [i.taskId, i.reason]), [[before.id, 'regroom']]);
});

test('the carve-out is New/DRAFT only — a Backlog task-file-only change still nudges (t-6cbf)', () => {
  const before = entry({ phase: 'backlog', model: 'opus', description: 'old', raw: 'index block' });
  const next = { ...before, description: 'new', detailRaw: '# t\n\n## Description\n\nnew\n' };
  const skipped = [];
  const items = computeNudges([before], [next], skipped);
  assert.deepStrictEqual(skipped, []);
  assert.deepStrictEqual(items.map((i) => i.reason), ['backlog']);
});

test('an INDEX-side edit on a New/DRAFT task still nudges its groomer (t-6cbf)', () => {
  const draft = entry({ isDraft: true, groomer: 'fable', raw: '- [ ] DRAFT: t-1 — do a thing' });
  const edited = { ...draft, title: 'do a different thing', raw: '- [ ] DRAFT: t-1 — do a different thing' };
  assert.deepStrictEqual(computeNudges([draft], [edited]).map((i) => i.reason), ['groom']);
  // A `feedback:` added to the entry, with the detail file moving in the same refresh.
  const noted = { ...draft, feedback: ['retitle this'], raw: draft.raw + '\n  - feedback: retitle this', detailRaw: 'detail 2' };
  assert.deepStrictEqual(computeNudges([draft], [noted]).map((i) => i.reason), ['feedback']);
  // The human filling the last blank answer on a groomed New task — the real re-groom trigger.
  const asked = entry({ phase: 'new', groomer: 'fable', questions: [q('pick one')], raw: 'index block' });
  const answered = { ...asked, questions: [q('pick one', 'this one')], raw: 'index block + answer' };
  const items = computeNudges([asked], [answered]);
  assert.deepStrictEqual(items.map((i) => i.reason), ['regroom']);
});

// ---- describeChanges: which FIELD moved, never its text (t-f8bd) ----

test('a task the previous board did not have is a new entry', () => {
  assert.deepStrictEqual(describeChanges(undefined, entry()), ['new entry']);
});

test('index fields are named, and enum values (phase and the routing keys) appear verbatim', () => {
  const before = entry({ phase: 'new', model: 'opus', groomer: 'opus', title: 'Old title' });
  assert.deepStrictEqual(describeChanges(before, { ...before, title: 'New title' }), ['title edited']);
  assert.deepStrictEqual(describeChanges(before, { ...before, phase: 'backlog' }), ['phase → backlog']);
  assert.deepStrictEqual(describeChanges(before, { ...before, model: 'sonnet' }), ['model → sonnet']);
  assert.deepStrictEqual(describeChanges(before, { ...before, groomer: 'none' }), ['groomer → none']);
  assert.deepStrictEqual(describeChanges(before, { ...before, model: undefined }), ['model → default']);
  // t-0e99: the three new routing keys are named the same way.
  assert.deepStrictEqual(describeChanges(before, { ...before, effort: 'high' }), ['effort → high']);
  assert.deepStrictEqual(describeChanges(before, { ...before, groomerEffort: 'auto' }), ['groomer-effort → auto']);
  assert.deepStrictEqual(describeChanges(before, { ...before, reviewer: 'none' }), ['reviewer → none']);
  assert.deepStrictEqual(describeChanges({ ...before, reviewer: 'haiku' }, before), ['reviewer → default']);
  assert.deepStrictEqual(describeChanges(before, { ...before, checked: true }), ['ticked']);
  assert.deepStrictEqual(describeChanges({ ...before, checked: true }, before), ['unticked']);
});

test('questions are counted when added or removed, and singular/plural correctly', () => {
  const before = entry({ questions: [q('a')] });
  assert.deepStrictEqual(describeChanges(before, { ...before, questions: [q('a'), q('b')] }), ['question added']);
  assert.deepStrictEqual(
    describeChanges(before, { ...before, questions: [q('a'), q('b'), q('c')] }),
    ['2 questions added'],
  );
  assert.deepStrictEqual(describeChanges({ ...before, questions: [q('a'), q('b')] }, before), ['question removed']);
});

test('answer and suggestion descriptors are positional and 1-based, in index order', () => {
  const before = entry({ questions: [q('a'), q('b'), q('c')] });
  assert.deepStrictEqual(
    describeChanges(before, { ...before, questions: [q('a'), q('b', 'yes'), q('c')] }),
    ['answer filled (question 2)'],
  );
  const answered = entry({ questions: [q('a', 'yes'), q('b')] });
  assert.deepStrictEqual(
    describeChanges(answered, { ...answered, questions: [q('a', 'no longer yes'), q('b')] }),
    ['answer edited (question 1)'],
  );
  assert.deepStrictEqual(
    describeChanges(answered, { ...answered, questions: [q('a', '   '), q('b')] }),
    ['answer cleared (question 1)'],
  );
  const withSuggestion = { text: 'c', answer: '', suggestions: ['take this one'] };
  assert.deepStrictEqual(
    describeChanges(before, { ...before, questions: [q('a'), q('b'), withSuggestion] }),
    ['suggestions added (question 3)'],
  );
  assert.deepStrictEqual(
    describeChanges({ ...before, questions: [q('a'), q('b'), withSuggestion] }, before),
    ['suggestions removed (question 3)'],
  );
});

test('feedback items are counted, never quoted', () => {
  const before = entry({ feedback: ['fix it'] });
  assert.deepStrictEqual(describeChanges(before, { ...before, feedback: ['fix it', 'do the thing'] }), ['feedback added']);
  assert.deepStrictEqual(describeChanges(before, { ...before, feedback: [] }), ['feedback removed']);
  assert.deepStrictEqual(
    describeChanges(before, { ...before, feedback: ['fix it', 'and this', 'and that'] }),
    ['2 feedback added'],
  );
});

test('detail changes are named per section, and Meta per field', () => {
  const before = entry({ description: 'old', worklog: ['2026-09-01'] });
  assert.deepStrictEqual(describeChanges(before, { ...before, description: 'new' }), ['description edited']);
  // t-2191: the two groomer-owned sections are named individually, never folded into
  // 'description edited' — a re-groom that only rewrote Goals has to be visible as such.
  assert.deepStrictEqual(describeChanges(before, { ...before, problem: 'why' }), ['problem edited']);
  assert.deepStrictEqual(describeChanges(before, { ...before, goals: '- done when' }), ['goals edited']);
  assert.deepStrictEqual(
    describeChanges(before, { ...before, problem: 'why', description: 'new', goals: '- done when' }),
    ['problem edited', 'description edited', 'goals edited'],
  );
  assert.deepStrictEqual(describeChanges(before, { ...before, delivered: 'shipped' }), ['delivered edited']);
  assert.deepStrictEqual(
    describeChanges(before, { ...before, worklog: ['2026-09-01', '2026-09-02'] }),
    ['worklog appended'],
  );
  assert.deepStrictEqual(describeChanges(before, { ...before, worklog: ['2026-09-02'] }), ['worklog edited']);
  assert.deepStrictEqual(describeChanges(before, { ...before, started: '2026-09-02' }), ['meta started set']);
  assert.deepStrictEqual(
    describeChanges({ ...before, started: '2026-09-02' }, before),
    ['meta started cleared'],
  );
  assert.deepStrictEqual(describeChanges(before, { ...before, links: ['task/t-f8bd'] }), ['meta link set']);
  assert.deepStrictEqual(describeChanges(before, { ...before, dependsOn: ['t-abcd'] }), ['depends on edited']);
});

test('several fields moving at once are all named', () => {
  const before = entry({ phase: 'new', questions: [q('a')], description: 'old' });
  assert.deepStrictEqual(
    describeChanges(before, { ...before, questions: [q('a', 'yes')], description: 'new' }),
    ['answer filled (question 1)', 'description edited'],
  );
});

test('a text change with no visible field delta still yields a descriptor', () => {
  const before = entry({ phase: 'backlog', model: 'opus' });
  assert.deepStrictEqual(describeChanges(before, { ...before, raw: 'canonicalized' }), ['changed']);
  // …and it still produces a nudge, never a dropped one.
  const items = computeNudges([before], [{ ...before, raw: 'canonicalized' }]);
  assert.deepStrictEqual(items[0].changes, ['changed']);
  // A question TEXT edit is the same case: the fingerprint sees it, the descriptors only count
  // questions, so the ['changed'] fallback is what keeps it reachable.
  const asked = entry({ phase: 'backlog', model: 'opus', questions: [q('old text')] });
  const reworded = { ...asked, questions: [q('new text')], raw: 'reworded' };
  assert.deepStrictEqual(computeNudges([asked], [reworded])[0].changes, ['changed']);
});

// ---- mergeNudgeItems: a task held for a downed terminal unions its descriptors ----

test('held items union their change descriptors under one id, newest reason winning', () => {
  const held = [
    { taskId: 't-abcd', reason: 'groom', changes: ['new entry'] },
    { taskId: 't-ef01', reason: 'backlog', changes: ['phase → backlog'] },
  ];
  const merged = mergeNudgeItems(held, [
    { taskId: 't-abcd', reason: 'regroom', changes: ['new entry', 'answer filled (question 1)'] },
    { taskId: 't-2222', reason: 'feedback', changes: ['feedback added'] },
  ]);
  assert.deepStrictEqual(merged.map((i) => i.taskId), ['t-abcd', 't-ef01', 't-2222']);
  assert.deepStrictEqual(merged[0].changes, ['new entry', 'answer filled (question 1)']);
  assert.strictEqual(merged[0].reason, 'regroom');
  // The held array is not mutated in place.
  assert.deepStrictEqual(held[0].changes, ['new entry']);
});

// ---- formatNudge: one short line naming ids and fields, never task text ----

test('the nudge line names each task by id and changed fields, not by title, on a single line', () => {
  const line = formatNudge([
    { taskId: 't-abcd', reason: 'backlog', changes: ['phase → backlog'] },
    { taskId: 't-ef01', reason: 'regroom', changes: ['answer filled (question 2)', 'description edited'] },
  ]);
  assert.ok(line.includes('t-abcd'));
  assert.ok(line.includes('phase → backlog'));
  assert.ok(line.includes('t-ef01'));
  assert.ok(line.includes('answer filled (question 2), description edited'));
  assert.ok(line.includes('is claimable in Backlog'), 'the routing reason phrase stays');
  assert.ok(line.includes('.loopboard/TODO.md'));
  assert.ok(!line.includes('\n'), 'a newline would submit the line mid-sentence');
});

// The human's actual requirement (t-f8bd), table-driven over EVERY reason so a new routing branch
// cannot bypass it: no free text of any kind reaches the pasted line.
test('no task text of any kind reaches the nudge line, in any reason branch', () => {
  const SENTINELS = {
    title: 'SENTINEL-TITLE',
    question: 'SENTINEL-QUESTION',
    answer: 'SENTINEL-ANSWER',
    suggestion: 'SENTINEL-SUGGESTION',
    feedback: 'SENTINEL-FEEDBACK',
    problem: 'SENTINEL-PROBLEM',
    description: 'SENTINEL-DESCRIPTION',
    goals: 'SENTINEL-GOALS',
    worklog: 'SENTINEL-WORKLOG',
    delivered: 'SENTINEL-DELIVERED',
  };
  const loaded = (over) => entry({
    title: SENTINELS.title,
    problem: SENTINELS.problem,
    description: SENTINELS.description,
    goals: SENTINELS.goals,
    worklog: [SENTINELS.worklog],
    delivered: SENTINELS.delivered,
    ...over,
  });
  const answeredQ = { text: SENTINELS.question, answer: SENTINELS.answer, suggestions: [SENTINELS.suggestion] };
  const cases = [
    ['groom', loaded({ phase: 'new', isDraft: true, groomer: 'opus' })],
    ['regroom', loaded({ phase: 'new', groomer: 'opus', questions: [answeredQ] })],
    ['backlog', loaded({ phase: 'backlog', model: 'opus' })],
    ['answers', loaded({ phase: 'feedback', model: 'opus', questions: [answeredQ] })],
    ['feedback', loaded({ phase: 'review', model: 'opus', feedback: [SENTINELS.feedback] })],
    ['feedback', loaded({ phase: 'backlog', model: 'opus', feedback: [SENTINELS.feedback] })],
    ['feedback', loaded({ phase: 'new', isDraft: true, groomer: 'opus', feedback: [SENTINELS.feedback] })],
  ];
  const seen = new Set();
  for (const [reason, next] of cases) {
    const prev = { ...entry({ id: next.id }), raw: 'before' };
    const items = computeNudges([prev], [{ ...next, raw: 'after' }]);
    assert.strictEqual(items.length, 1, reason + ' should route somewhere');
    assert.strictEqual(items[0].reason, reason);
    seen.add(reason);
    const line = formatNudge(items);
    assert.ok(line.includes(next.id), reason + ': the id must be named');
    for (const [field, text] of Object.entries(SENTINELS)) {
      assert.ok(!line.includes(text), reason + ': ' + field + ' text leaked into the nudge line — ' + line);
    }
  }
  assert.strictEqual(seen.size, 5, 'every NudgeReason must be covered (t-ae10 folded `note` into `feedback`)');
});

test('a long list is capped and summarised', () => {
  const items = [];
  for (let i = 0; i < 9; i++) items.push({ taskId: 't-000' + i, reason: 'backlog', changes: ['phase → backlog'] });
  const line = formatNudge(items);
  assert.ok(line.includes('and 4 more'), line);
  assert.ok(!line.includes('\n'));
});

// ---- t-0e99: the orchestrator writing its `auto` picks must not nudge itself ----

test('a routing-only change on a New/DRAFT task nudges nobody: the pre-spawn pick write (t-0e99)', () => {
  const before = entry({ isDraft: true, groomer: 'auto', groomerEffort: 'auto', raw: '- [ ] DRAFT: t-1, do it\n  - id: t-1\n  - groomer: auto\n  - groomer-effort: auto' });
  const next = { ...before, groomer: 'opus', groomerEffort: 'high', raw: '- [ ] DRAFT: t-1, do it\n  - id: t-1\n  - groomer: opus\n  - groomer-effort: high' };
  const skipped = [];
  assert.deepStrictEqual(computeNudges([before], [next], skipped), []);
  assert.deepStrictEqual(skipped.map((i) => [i.taskId, i.reason]), [[before.id, 'groom']]);
  assert.deepStrictEqual(skipped[0].changes, ['groomer → opus', 'groomer-effort → high']);
});

test('taking a draft OFF hold still nudges, and a routing change plus real work still nudges', () => {
  const held = entry({ isDraft: true, groomer: 'none', raw: '- [ ] DRAFT: x\n  - groomer: none' });
  const released = { ...held, groomer: 'opus', raw: '- [ ] DRAFT: x\n  - groomer: opus' };
  assert.deepStrictEqual(computeNudges([held], [released]).map((i) => i.reason), ['groom']);
  const draft = entry({ isDraft: true, raw: '- [ ] DRAFT: x' });
  const withFeedback = { ...draft, model: 'haiku', feedback: ['also this'], raw: '- [ ] DRAFT: x\n  - model: haiku\n  - feedback: also this' };
  assert.deepStrictEqual(computeNudges([draft], [withFeedback]).map((i) => i.reason), ['feedback']);
});

test('the routing carve-out is New/DRAFT only: a Backlog re-pick still nudges the claim', () => {
  const backlog = entry({ phase: 'backlog', model: 'sonnet', raw: '- [ ] B\n  - phase: backlog\n  - model: sonnet' });
  const repicked = { ...backlog, model: 'haiku', raw: '- [ ] B\n  - phase: backlog\n  - model: haiku' };
  assert.deepStrictEqual(computeNudges([backlog], [repicked]).map((i) => i.reason), ['backlog']);
});
