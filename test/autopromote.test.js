'use strict';
// Right-click Promote (t-39e2): the ready predicate and the pure arm decision. The controller owns
// the session-only arm map and its timers; everything about WHETHER and WHEN an arm fires is here.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  AUTO_PROMOTE_SETTLE_MS, readyToAutoPromote, createArm, evaluateArm,
} = require('../out-test/autopromote.js');

const S = AUTO_PROMOTE_SETTLE_MS;

// A board task as evaluateArm sees it. `raw`/`detailRaw` default to text derived from the state,
// so two different states never share a fingerprint by accident.
function task(over) {
  const t = Object.assign({ id: 't-1', phase: 'new', isDraft: false, questions: [], feedback: [], detailRaw: '# T (t-1)\n' }, over);
  if (t.raw === undefined) t.raw = JSON.stringify([t.phase, t.isDraft, t.questions, t.feedback]);
  return t;
}
const q = (answer, text = 'q') => ({ text, answer, suggestions: [] });

// Feeds one arm through a sequence of evaluations, returning every decision; the arm carries over.
function run(arm, steps) {
  const out = [];
  for (const [t, now] of steps) {
    const r = evaluateArm(arm, t, now);
    arm = r.arm;
    out.push(r.decision);
  }
  return { arm, out };
}

test('AUTO_PROMOTE_SETTLE_MS is 30 s', () => {
  assert.equal(S, 30000);
});

test('readyToAutoPromote: true only for a groomed New story with no questions and no feedback', () => {
  assert.equal(readyToAutoPromote(task()), true);
  assert.equal(readyToAutoPromote(task({ phase: 'backlog' })), false, 'not New');
  assert.equal(readyToAutoPromote(task({ isDraft: true })), false, 'a DRAFT');
  assert.equal(readyToAutoPromote(task({ questions: [q('')] })), false, 'a blank question');
  assert.equal(readyToAutoPromote(task({ questions: [q('yes')] })), false, 'all answered but the pair is still present (not folded)');
  assert.equal(readyToAutoPromote(task({ feedback: ['fold me'] })), false, 'pending feedback');
});

test('evaluateArm: fires only after the predicate held with an unchanged fingerprint for the settle window', () => {
  const t0 = 1000;
  const ready = task();
  const { out } = run(createArm(t0), [[ready, t0], [ready, t0 + S - 1], [ready, t0 + S]]);
  assert.equal(out[0].kind, 'hold');
  assert.equal(out[0].reason, 'settling');
  assert.equal(out[0].wakeAt, t0 + S, 'the host re-evaluates at the end of the window');
  assert.equal(out[1].reason, 'settling');
  assert.equal(out[2].kind, 'fire');
});

test('evaluateArm: a fingerprint change inside the window restarts it — index block or task file', () => {
  const t0 = 1000;
  for (const changed of [task({ raw: 'other index block' }), task({ detailRaw: '# T (t-1)\n\n## Goals\n- more\n' })]) {
    const { out } = run(createArm(t0), [
      [task(), t0],
      [changed, t0 + 20000],          // change 20 s in: window restarts here
      [changed, t0 + S],              // would have fired on the old window
      [changed, t0 + 20000 + S - 1],
      [changed, t0 + 20000 + S],
    ]);
    assert.deepEqual(out.map((d) => d.kind), ['hold', 'hold', 'hold', 'hold', 'fire']);
    assert.equal(out[1].wakeAt, t0 + 20000 + S);
  }
});

test('evaluateArm: the window never starts before the arm time', () => {
  // A story that has been ready and untouched for an hour still waits the full window from the
  // right-click, not from when it became ready.
  const armedAt = 3600000;
  const ready = task();
  const { out } = run(createArm(armedAt), [[ready, armedAt], [ready, armedAt + S - 1], [ready, armedAt + S]]);
  assert.deepEqual(out.map((d) => d.kind), ['hold', 'hold', 'fire']);
  // Even an evaluation stamped before the arm (clock skew) cannot pull the window earlier.
  const skew = evaluateArm(createArm(armedAt), ready, armedAt - 5000);
  assert.equal(skew.arm.since, armedAt);
  assert.equal(skew.decision.wakeAt, armedAt + S);
});

test('evaluateArm: drops when the task is gone or out of New', () => {
  const arm = createArm(0);
  assert.deepEqual(evaluateArm(arm, undefined, 10).decision, { kind: 'drop', reason: 'gone' });
  for (const phase of ['backlog', 'inprogress', 'feedback', 'review']) {
    assert.deepEqual(evaluateArm(arm, task({ phase }), 10).decision, { kind: 'drop', reason: 'left-new' }, phase);
  }
});

test('evaluateArm: holds name their reason — questions (blank / unfolded) and feedback', () => {
  const arm = createArm(0);
  const blank = evaluateArm(arm, task({ questions: [q(''), q('yes', 'q2')] }), 10).decision;
  assert.equal(blank.reason, 'questions');
  assert.match(blank.detail, /2 question\(s\), 1 unanswered/);
  const unfolded = evaluateArm(arm, task({ questions: [q('yes')] }), 10).decision;
  assert.equal(unfolded.reason, 'questions');
  assert.match(unfolded.detail, /not folded in yet/);
  const fb = evaluateArm(arm, task({ feedback: ['x'] }), 10).decision;
  assert.equal(fb.reason, 'feedback');
  assert.equal(fb.wakeAt, undefined, 'only a settling hold schedules a wake-up');
});

// Human decision 2 (2026-09-25): new questions from a re-groom never disarm — the arm waits through
// as many rounds as it takes and fires on the first one that comes back fully folded.
test('evaluateArm: an arm stays held across question rounds and fires after the last fold settles', () => {
  const t0 = 0;
  const rounds = [
    task({ questions: [q(''), q('', 'q2')] }),                // 1. questions blank
    task({ questions: [q('a'), q('b', 'q2')] }),              // 2. answered, not folded
    task({ questions: [q('', 'q3')], detailRaw: '# T v2\n' }), // 3. folded; re-groom filed a new question
    task({ questions: [q('c', 'q3')], detailRaw: '# T v2\n' }), // 4. answered again
    task({ detailRaw: '# T v3\n' }),                          // 5. folded, zero questions
  ];
  // Each round lasts far longer than the settle window: holding is never a timeout.
  const steps = rounds.map((t, i) => [t, t0 + i * 10 * S]);
  const { arm, out } = run(createArm(t0), steps);
  for (const d of out) assert.notEqual(d.kind, 'drop');
  assert.deepEqual(out.slice(0, 4).map((d) => d.reason), ['questions', 'questions', 'questions', 'questions']);
  assert.equal(out[4].reason, 'settling', 'state 5 only just changed');
  const lastChange = t0 + 4 * 10 * S;
  assert.equal(evaluateArm(arm, rounds[4], lastChange + S - 1).decision.kind, 'hold');
  assert.equal(evaluateArm(arm, rounds[4], lastChange + S).decision.kind, 'fire');
});

// Human decision 3 (2026-09-25): a DRAFT can be armed. It holds (`draft`) however long it sits
// untouched; the groom keeps the id and the implicit `phase: new`, so DRAFT -> New is a fingerprint
// change that restarts the window, never a drop.
test('evaluateArm: an armed DRAFT holds until groomed, then fires a full window after the groom', () => {
  const draft = task({ isDraft: true, raw: '- [ ] DRAFT: idea\n  - id: t-1' });
  const groomed = task({ raw: '- [ ] Idea\n  - id: t-1\n  - phase: new', detailRaw: '# Idea (t-1)\n\n## Goals\n- g\n' });
  const t0 = 0;
  const { arm, out } = run(createArm(t0), [[draft, t0], [draft, t0 + S], [draft, t0 + 100 * S]]);
  for (const d of out) assert.deepEqual(d, { kind: 'hold', reason: 'draft', detail: 'not groomed yet' });
  const groomAt = t0 + 100 * S + 7;
  const after = run(arm, [[groomed, groomAt], [groomed, groomAt + S - 1], [groomed, groomAt + S]]);
  assert.deepEqual(after.out.map((d) => d.kind), ['hold', 'hold', 'fire']);
  assert.equal(after.out[0].reason, 'settling');
  assert.equal(after.out[0].wakeAt, groomAt + S, 'window restarts at the DRAFT -> New change');
});

test('evaluateArm: an armed DRAFT whose first groom files questions holds through the rounds', () => {
  const draft = task({ isDraft: true, raw: 'DRAFT: idea' });
  const withQs = task({ raw: 'Idea q', questions: [q('')] });
  const answered = task({ raw: 'Idea a', questions: [q('yes')] });
  const folded = task({ raw: 'Idea folded' });
  const { arm, out } = run(createArm(0), [[draft, 0], [withQs, S], [answered, 5 * S], [folded, 9 * S]]);
  assert.deepEqual(out.map((d) => d.reason), ['draft', 'questions', 'questions', 'settling']);
  assert.equal(evaluateArm(arm, folded, 10 * S).decision.kind, 'fire');
});
