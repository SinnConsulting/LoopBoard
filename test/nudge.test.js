const test = require('node:test');
const assert = require('node:assert');
const { routeEntry, computeNudges, formatNudge } = require('../out-test/nudge');

const DEFAULTS = { worker: 'opus', groomer: 'sonnet' };

let seq = 0;
// A minimal IndexEntry. `rev` is what computeNudges diffs, so a caller that wants "this entry
// changed" just passes a different rev.
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

// ---- formatNudge: one short line naming the specific tasks ----

test('the nudge line names each task by title and id, on a single line', () => {
  const line = formatNudge([
    { taskId: 't-abcd', title: 'Do the thing', reason: 'backlog' },
    { taskId: 't-ef01', title: 'Answer folded', reason: 'regroom' },
  ]);
  assert.ok(line.includes('Do the thing'));
  assert.ok(line.includes('t-abcd'));
  assert.ok(line.includes('Answer folded'));
  assert.ok(line.includes('t-ef01'));
  assert.ok(line.includes('.loopboard/TODO.md'));
  assert.ok(!line.includes('\n'), 'a newline would submit the line mid-sentence');
});

test('a long list is capped and summarised', () => {
  const items = [];
  for (let i = 0; i < 9; i++) items.push({ taskId: 't-000' + i, title: 'Task ' + i, reason: 'backlog' });
  const line = formatNudge(items);
  assert.ok(line.includes('and 4 more'), line);
  assert.ok(!line.includes('\n'));
});
