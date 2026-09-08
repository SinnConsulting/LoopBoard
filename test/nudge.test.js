const test = require('node:test');
const assert = require('node:assert');
const { routeEntry, computeNudges, formatNudge, describeChanges, mergeNudgeItems } = require('../out-test/nudge');

const DEFAULTS = { worker: 'opus', groomer: 'sonnet' };

let seq = 0;
// A minimal composed Task (index entry + detail), the shape computeNudges diffs. `rev` is the
// change marker, so a caller that wants "this entry changed" just passes a different rev.
function entry(over = {}) {
  seq += 1;
  return {
    id: over.id || 't-' + seq,
    title: over.title || 'Some task',
    phase: 'new',
    checked: false,
    isDraft: false,
    questions: [],
    notes: [],
    feedback: [],
    unknownLines: [],
    raw: 'raw',
    rev: 1,
    worklog: [],
    links: [],
    dependsOn: [],
    hasDetailFile: true,
    ...over,
  };
}

const q = (text, answer = '') => ({ text, answer, suggestions: [] });

// ---- routeEntry: the Rules 14/15 ownership split ----

test('New/DRAFT is routed by groomer:, everything from Backlog on by model:', () => {
  assert.deepStrictEqual(
    routeEntry(entry({ phase: 'new', isDraft: true, groomer: 'fable', model: 'opus' }), DEFAULTS),
    { model: 'fable', reason: 'groom' },
  );
  assert.deepStrictEqual(
    routeEntry(entry({ phase: 'backlog', groomer: 'fable', model: 'opus' }), DEFAULTS),
    { model: 'opus', reason: 'backlog' },
  );
});

test('an absent field falls back to the matching default model', () => {
  assert.deepStrictEqual(routeEntry(entry({ isDraft: true }), DEFAULTS), { model: 'sonnet', reason: 'groom' });
  assert.deepStrictEqual(routeEntry(entry({ phase: 'backlog' }), DEFAULTS), { model: 'opus', reason: 'backlog' });
});

test('groomer: none is ON HOLD — never nudged, whatever changed on it', () => {
  assert.strictEqual(routeEntry(entry({ isDraft: true, groomer: 'none' }), DEFAULTS), null);
  assert.strictEqual(routeEntry(entry({ phase: 'new', groomer: 'none', notes: ['do the thing'] }), DEFAULTS), null);
  assert.strictEqual(
    routeEntry(entry({ phase: 'new', groomer: 'none', questions: [q('pick one', 'this one')] }), DEFAULTS),
    null,
  );
});

test('a New task whose questions are ALL answered routes to its groomer as a re-groom', () => {
  const e = entry({ phase: 'new', groomer: 'fable', questions: [q('pick one', 'this one'), q('and this', 'that')] });
  assert.deepStrictEqual(routeEntry(e, DEFAULTS), { model: 'fable', reason: 'regroom' });
});

test('a New task answered only in part is NOT pushed into a loop — one blank answer parks it', () => {
  const e = entry({ phase: 'new', groomer: 'fable', questions: [q('pick one', 'this one'), q('and this')] });
  assert.strictEqual(routeEntry(e, DEFAULTS), null);
});

test('a DRAFT with a half-answered question stays a groom, never a partial re-groom', () => {
  const e = entry({ phase: 'new', isDraft: true, groomer: 'fable', questions: [q('pick one', 'this one'), q('and this')] });
  assert.deepStrictEqual(routeEntry(e, DEFAULTS), { model: 'fable', reason: 'groom' });
});

test('a groomed New task with only blank answers is waiting on the human, not a loop', () => {
  const e = entry({ phase: 'new', groomer: 'fable', questions: [q('pick one'), q('and this')] });
  assert.strictEqual(routeEntry(e, DEFAULTS), null);
});

test('a note routes to the owning loop and outranks the phase reason (Rule 16)', () => {
  assert.deepStrictEqual(
    routeEntry(entry({ phase: 'review', model: 'fable', notes: ['re-groom with opus'] }), DEFAULTS),
    { model: 'fable', reason: 'note' },
  );
  assert.deepStrictEqual(
    routeEntry(entry({ phase: 'new', groomer: 'fable', notes: ['retitle this'] }), DEFAULTS),
    { model: 'fable', reason: 'note' },
  );
});

test('Feedback routes only when EVERY question is answered (Rule 10)', () => {
  const all = entry({ phase: 'feedback', model: 'fable', questions: [q('a', 'yes'), q('b', 'no')] });
  assert.deepStrictEqual(routeEntry(all, DEFAULTS), { model: 'fable', reason: 'answers' });
  const partial = entry({ phase: 'feedback', model: 'fable', questions: [q('a', 'yes'), q('b')] });
  assert.strictEqual(routeEntry(partial, DEFAULTS), null);
  const none = entry({ phase: 'feedback', model: 'fable', questions: [] });
  assert.strictEqual(routeEntry(none, DEFAULTS), null);
});

test('Review routes only with unaddressed feedback (Rule 13); In Progress never routes', () => {
  assert.deepStrictEqual(
    routeEntry(entry({ phase: 'review', model: 'opus', feedback: ['make it blue'] }), DEFAULTS),
    { model: 'opus', reason: 'feedback' },
  );
  assert.strictEqual(routeEntry(entry({ phase: 'review', model: 'opus' }), DEFAULTS), null);
  assert.strictEqual(routeEntry(entry({ phase: 'inprogress', model: 'opus' }), DEFAULTS), null);
});

// ---- computeNudges: only CHANGED entries, one loop each ----

test('the first board of a session nudges nobody', () => {
  const next = [entry({ phase: 'backlog', model: 'opus' })];
  assert.deepStrictEqual(computeNudges(undefined, next, DEFAULTS), []);
});

test('an unchanged entry is not nudged again, a changed one is', () => {
  const before = entry({ phase: 'backlog', model: 'opus', rev: 3 });
  assert.deepStrictEqual(computeNudges([before], [{ ...before }], DEFAULTS), []);
  const routes = computeNudges([before], [{ ...before, rev: 4 }], DEFAULTS);
  assert.strictEqual(routes.length, 1);
  assert.strictEqual(routes[0].model, 'opus');
  assert.strictEqual(routes[0].items[0].reason, 'backlog');
});

test('an entry with no rev at all falls back to a raw comparison', () => {
  const before = entry({ phase: 'backlog', model: 'opus', rev: undefined, raw: 'one' });
  assert.deepStrictEqual(computeNudges([before], [{ ...before }], DEFAULTS), []);
  assert.strictEqual(computeNudges([before], [{ ...before, raw: 'two' }], DEFAULTS).length, 1);
});

test('a brand-new entry is a change', () => {
  const fresh = entry({ phase: 'backlog', model: 'opus' });
  const routes = computeNudges([], [fresh], DEFAULTS);
  assert.strictEqual(routes.length, 1);
  assert.strictEqual(routes[0].items[0].taskId, fresh.id);
});

test('changes that give no loop work nudge nobody', () => {
  const before = entry({ phase: 'review', model: 'opus', rev: 1 });
  assert.deepStrictEqual(computeNudges([before], [{ ...before, rev: 2 }], DEFAULTS), []);
});

test('a Backlog nudge is suppressed while any task is In Progress (Rule 2)', () => {
  const backlog = entry({ phase: 'backlog', model: 'opus', rev: 1 });
  const busy = entry({ phase: 'inprogress', model: 'fable' });
  const next = [{ ...backlog, rev: 2 }, busy];
  assert.deepStrictEqual(computeNudges([backlog, busy], next, DEFAULTS), []);
  // …but grooming and notes never set inprogress, so they still route.
  const draft = entry({ isDraft: true, groomer: 'fable', rev: 1 });
  const routes = computeNudges([backlog, busy, draft], [{ ...backlog, rev: 2 }, busy, { ...draft, rev: 2 }], DEFAULTS);
  assert.strictEqual(routes.length, 1);
  assert.strictEqual(routes[0].model, 'fable');
  assert.strictEqual(routes[0].items[0].reason, 'groom');
});

test('changes are grouped per loop, and each change reaches exactly one loop', () => {
  const a = entry({ phase: 'feedback', model: 'opus', questions: [q('a', 'yes')], rev: 1 });
  const b = entry({ phase: 'review', model: 'opus', feedback: ['fix it'], rev: 1 });
  const c = entry({ phase: 'new', groomer: 'fable', notes: ['note'], rev: 1 });
  const prev = [a, b, c];
  const next = [{ ...a, rev: 2 }, { ...b, rev: 2 }, { ...c, rev: 2 }];
  const routes = computeNudges(prev, next, DEFAULTS);
  assert.strictEqual(routes.length, 2);
  const byModel = Object.fromEntries(routes.map((r) => [r.model, r.items]));
  assert.deepStrictEqual(byModel.opus.map((i) => i.reason), ['answers', 'feedback']);
  assert.deepStrictEqual(byModel.fable.map((i) => i.reason), ['note']);
  assert.strictEqual(routes.reduce((n, r) => n + r.items.length, 0), 3);
});

// ---- describeChanges: which FIELD moved, never its text (t-f8bd) ----

test('a task the previous board did not have is a new entry', () => {
  assert.deepStrictEqual(describeChanges(undefined, entry()), ['new entry']);
});

test('index fields are named, and enum values (phase/model/groomer) appear verbatim', () => {
  const before = entry({ phase: 'new', model: 'opus', groomer: 'opus', title: 'Old title' });
  assert.deepStrictEqual(describeChanges(before, { ...before, title: 'New title' }), ['title edited']);
  assert.deepStrictEqual(describeChanges(before, { ...before, phase: 'backlog' }), ['phase → backlog']);
  assert.deepStrictEqual(describeChanges(before, { ...before, model: 'sonnet' }), ['model → sonnet']);
  assert.deepStrictEqual(describeChanges(before, { ...before, groomer: 'none' }), ['groomer → none']);
  assert.deepStrictEqual(describeChanges(before, { ...before, model: undefined }), ['model → default']);
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

test('notes and feedback are counted, never quoted', () => {
  const before = entry({ notes: [], feedback: ['fix it'] });
  assert.deepStrictEqual(describeChanges(before, { ...before, notes: ['do the thing'] }), ['note added']);
  assert.deepStrictEqual(describeChanges(before, { ...before, feedback: [] }), ['feedback removed']);
  assert.deepStrictEqual(
    describeChanges(before, { ...before, feedback: ['fix it', 'and this', 'and that'] }),
    ['2 feedback added'],
  );
});

test('detail changes are named per section, and Meta per field', () => {
  const before = entry({ description: 'old', worklog: ['2026-09-01'] });
  assert.deepStrictEqual(describeChanges(before, { ...before, description: 'new' }), ['description edited']);
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

test('a rev bump with no visible field delta still yields a descriptor', () => {
  const before = entry({ phase: 'backlog', model: 'opus', rev: 1 });
  assert.deepStrictEqual(describeChanges(before, { ...before, rev: 2, raw: 'canonicalized' }), ['changed']);
  // …and it still produces a nudge, never a dropped one.
  const routes = computeNudges([before], [{ ...before, rev: 2, raw: 'canonicalized' }], DEFAULTS);
  assert.deepStrictEqual(routes[0].items[0].changes, ['changed']);
});

// ---- mergeNudgeItems: a task held for a downed terminal unions its descriptors ----

test('held items union their change descriptors under one id, newest reason winning', () => {
  const held = [
    { taskId: 't-abcd', reason: 'groom', changes: ['new entry'] },
    { taskId: 't-ef01', reason: 'backlog', changes: ['phase → backlog'] },
  ];
  const merged = mergeNudgeItems(held, [
    { taskId: 't-abcd', reason: 'regroom', changes: ['new entry', 'answer filled (question 1)'] },
    { taskId: 't-2222', reason: 'note', changes: ['note added'] },
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
    note: 'SENTINEL-NOTE',
    feedback: 'SENTINEL-FEEDBACK',
    description: 'SENTINEL-DESCRIPTION',
    worklog: 'SENTINEL-WORKLOG',
    delivered: 'SENTINEL-DELIVERED',
  };
  const loaded = (over) => entry({
    title: SENTINELS.title,
    description: SENTINELS.description,
    worklog: [SENTINELS.worklog],
    delivered: SENTINELS.delivered,
    ...over,
  });
  const answeredQ = { text: SENTINELS.question, answer: SENTINELS.answer, suggestions: [SENTINELS.suggestion] };
  const cases = [
    ['note', loaded({ phase: 'backlog', model: 'opus', notes: [SENTINELS.note] })],
    ['groom', loaded({ phase: 'new', isDraft: true, groomer: 'opus' })],
    ['regroom', loaded({ phase: 'new', groomer: 'opus', questions: [answeredQ] })],
    ['backlog', loaded({ phase: 'backlog', model: 'opus' })],
    ['answers', loaded({ phase: 'feedback', model: 'opus', questions: [answeredQ] })],
    ['feedback', loaded({ phase: 'review', model: 'opus', feedback: [SENTINELS.feedback] })],
  ];
  const seen = new Set();
  for (const [reason, next] of cases) {
    const prev = { ...entry({ id: next.id }), rev: 1 };
    const routes = computeNudges([prev], [{ ...next, rev: 2 }], DEFAULTS);
    assert.strictEqual(routes.length, 1, reason + ' should route somewhere');
    const items = routes[0].items;
    assert.strictEqual(items[0].reason, reason);
    seen.add(reason);
    const line = formatNudge(items);
    assert.ok(line.includes(next.id), reason + ': the id must be named');
    for (const [field, text] of Object.entries(SENTINELS)) {
      assert.ok(!line.includes(text), reason + ': ' + field + ' text leaked into the nudge line — ' + line);
    }
  }
  assert.strictEqual(seen.size, 6, 'every NudgeReason must be covered');
});

test('a long list is capped and summarised', () => {
  const items = [];
  for (let i = 0; i < 9; i++) items.push({ taskId: 't-000' + i, reason: 'backlog', changes: ['phase → backlog'] });
  const line = formatNudge(items);
  assert.ok(line.includes('and 4 more'), line);
  assert.ok(!line.includes('\n'));
});
