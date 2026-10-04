'use strict';
// Board -> webview payload: badge, dependency-met lookup against done: IndexEntry[], hasDetailFile.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseDone } = require('../out-test/parser.js');
const { computeBadge, toWebviewBoard, computeConcurrency } = require('../out-test/view.js');

// Minimal composed task (index + detail fields flattened, as store.compose produces).
function task(over) {
  return Object.assign(
    {
      id: 't-x', title: 'T', phase: 'backlog', checked: false, isDraft: false,
      questions: [], hasDetailFile: true,
      worklog: [], links: [], dependsOn: [], feedback: [], unknownLines: [],
      raw: '',
    },
    over
  );
}

test('computeBadge = new (excl DRAFTs) + drafts + unanswered feedback + review', () => {
  const board = {
    preamble: '', done: [],
    tasks: [
      task({ id: 't-1', phase: 'new' }),
      task({ id: 't-2', phase: 'new', isDraft: true }),
      task({ id: 't-3', phase: 'feedback', questions: [{ text: 'q', answer: '' }] }),
      task({ id: 't-4', phase: 'review' }),
    ],
  };
  const b = computeBadge(board);
  assert.equal(b.newCount, 1);
  assert.equal(b.draftCount, 1);
  assert.equal(b.feedbackUnanswered, 1);
  assert.equal(b.reviewCount, 1);
  assert.equal(b.count, 4);
});

test('computeBadge: drafts and groomed New tasks split without double-counting', () => {
  const board = {
    preamble: '', done: [],
    tasks: [
      task({ id: 't-1', phase: 'new' }),
      task({ id: 't-2', phase: 'new' }),
      ...Array.from({ length: 9 }, (_, i) => task({ id: `t-d${i}`, phase: 'new', isDraft: true })),
    ],
  };
  const b = computeBadge(board);
  assert.equal(b.newCount, 2);
  assert.equal(b.draftCount, 9);
  assert.equal(b.count, 11);
});

test('computeBadge: newUnanswered counts New tasks with an unanswered question, separate from feedbackUnanswered and not added into count', () => {
  const board = {
    preamble: '', done: [],
    tasks: [
      task({ id: 't-1', phase: 'new', questions: [{ text: 'q', answer: '' }] }),
      task({ id: 't-2', phase: 'new', questions: [{ text: 'q', answer: 'yes' }] }),
      task({ id: 't-3', phase: 'feedback', questions: [{ text: 'q', answer: '' }] }),
    ],
  };
  const b = computeBadge(board);
  assert.equal(b.newUnanswered, 1);
  assert.equal(b.feedbackUnanswered, 1);
  assert.equal(b.count, 2 + 1 + 0); // newCount(2) + feedbackUnanswered(1) + reviewCount(0)
});

test('dependency marked met when its id is in DONE (IndexEntry[])', () => {
  const board = {
    preamble: '',
    done: parseDone('## Tasks\n\n- [x] dep\n  - id: t-9c2e\n  - completed: 2026-07-01'),
    tasks: [task({ id: 't-dd01', dependsOn: ['t-9c2e', 't-missing'] })],
  };
  const web = toWebviewBoard(board, 'ws', 'opus', []);
  const card = web.phases.backlog[0];
  assert.equal(card.dependsOn[0].met, true);
  assert.equal(card.dependsOn[1].met, false);
});

test('hasDetailFile flows to the webview payload', () => {
  const board = {
    preamble: '', done: [],
    tasks: [task({ id: 't-1', phase: 'new', hasDetailFile: false })],
  };
  const web = toWebviewBoard(board, 'ws', 'opus', []);
  assert.equal(web.phases.new[0].hasDetailFile, false);
});

// t-65a2: the board needs the hold state to render its "on hold — not groomed" badge, so the
// sentinel must reach the payload as-is rather than being coerced to null (= default groomer).
test('groomer: none reaches the webview payload uncoerced', () => {
  const board = {
    preamble: '', done: [],
    tasks: [task({ id: 't-1', phase: 'new', groomer: 'none' })],
  };
  const web = toWebviewBoard(board, 'ws', 'opus', []);
  assert.equal(web.phases.new[0].groomer, 'none');
});

test('feedback maps to the feedback[] item list on every phase (t-ae10); the note field is gone', () => {
  const board = {
    preamble: '', done: [],
    tasks: [
      task({ id: 't-1', phase: 'inprogress', feedback: ['a', 'b'] }),
      task({ id: 't-2', phase: 'review', feedback: ['c'] }),
      task({ id: 't-3', phase: 'backlog' }),
    ],
  };
  const web = toWebviewBoard(board, 'ws', 'opus', []);
  assert.deepEqual(web.phases.inprogress[0].feedback, ['a', 'b']);
  assert.deepEqual(web.phases.review[0].feedback, ['c']);
  assert.deepEqual(web.phases.backlog[0].feedback, [], 'no feedback = empty list, not null');
  assert.equal('note' in web.phases.inprogress[0], false);
});

test('computeConcurrency: nothing In Progress → empty status, no message, not breached', () => {
  const board = {
    preamble: '', done: [],
    tasks: [task({ id: 't-1', phase: 'backlog' }), task({ id: 't-2', phase: 'new' })],
  };
  const c = computeConcurrency(board, 'opus');
  assert.equal(c.inProgress.length, 0);
  assert.equal(c.skipped.length, 0);
  assert.equal(c.breached, false);
  assert.equal(c.message, null);
});

test('computeConcurrency: one In Progress + a Backlog task → Active Queue names the in-progress task', () => {
  const board = {
    preamble: '', done: [],
    tasks: [
      task({ id: 't-run', title: 'Running', phase: 'inprogress', model: 'sonnet' }),
      task({ id: 't-prep', title: 'Prepared', phase: 'backlog' }),
    ],
  };
  const c = computeConcurrency(board, 'opus');
  assert.deepEqual(c.inProgress, [{ id: 't-run', title: 'Running', model: 'sonnet' }]);
  assert.deepEqual(c.skipped, [{ id: 't-prep', title: 'Prepared' }]);
  assert.equal(c.breached, false);
  assert.equal(c.message, 'Active Queue: t-run (sonnet)');
});

test('computeConcurrency: in-progress task with no model: falls back to the default model', () => {
  const board = {
    preamble: '', done: [],
    tasks: [task({ id: 't-run', phase: 'inprogress' }), task({ id: 't-prep', phase: 'backlog' })],
  };
  const c = computeConcurrency(board, 'opus');
  assert.equal(c.inProgress[0].model, 'opus');
  assert.equal(c.message, 'Active Queue: t-run (opus)');
});

test('computeConcurrency: In Progress but no Backlog waiting → no Active Queue message', () => {
  const board = {
    preamble: '', done: [],
    tasks: [task({ id: 't-run', phase: 'inprogress' }), task({ id: 't-n', phase: 'new' })],
  };
  const c = computeConcurrency(board, 'opus');
  assert.equal(c.inProgress.length, 1);
  assert.equal(c.skipped.length, 0);
  assert.equal(c.message, null);
});

test('computeConcurrency: more than one In Progress → breached, Active Queue lists all of them', () => {
  const board = {
    preamble: '', done: [],
    tasks: [
      task({ id: 't-a', phase: 'inprogress', model: 'opus' }),
      task({ id: 't-b', phase: 'inprogress', model: 'fable' }),
      task({ id: 't-prep', phase: 'backlog' }),
    ],
  };
  const c = computeConcurrency(board, 'opus');
  assert.equal(c.inProgress.length, 2);
  assert.equal(c.breached, true);
  assert.equal(c.message, 'Active Queue: t-a (opus), t-b (fable)');
});

test('computeConcurrency flows onto the WebBoard payload', () => {
  const board = {
    preamble: '', done: [],
    tasks: [task({ id: 't-run', phase: 'inprogress', model: 'sonnet' }), task({ id: 't-prep', phase: 'backlog' })],
  };
  const web = toWebviewBoard(board, 'ws', 'opus', []);
  assert.equal(web.concurrency.message, 'Active Queue: t-run (sonnet)');
});

test('DONE entries render from the slim IndexEntry (no detail)', () => {
  const board = {
    preamble: '',
    done: parseDone('## Tasks\n\n- [x] Shipped\n  - id: t-1\n  - model: sonnet\n  - completed: 2026-07-01'),
    tasks: [],
  };
  const web = toWebviewBoard(board, 'ws', 'opus', []);
  assert.equal(web.phases.done.length, 1);
  assert.equal(web.phases.done[0].title, 'Shipped');
  assert.equal(web.phases.done[0].completed, '2026-07-01');
  assert.equal(web.phases.done[0].model, 'sonnet');
});

test('DONE entries carry description/delivered through from their task file', () => {
  const [entry] = parseDone('## Tasks\n\n- [x] Shipped\n  - id: t-1\n  - model: sonnet\n  - completed: 2026-07-01');
  const board = {
    preamble: '',
    done: [{ ...entry, description: 'Story text.', delivered: 'What shipped.' }],
    tasks: [],
  };
  const web = toWebviewBoard(board, 'ws', 'opus', []);
  assert.equal(web.phases.done[0].description, 'Story text.');
  assert.equal(web.phases.done[0].delivered, 'What shipped.');
});

test('WebTask carries problem/goals for an active task, defaulting to empty strings (t-2191)', () => {
  const board = {
    preamble: '', done: [],
    tasks: [
      task({ id: 't-1', problem: 'It is broken.', description: 'Story.', goals: '- Fix it.' }),
      task({ id: 't-2' }),
    ],
  };
  const web = toWebviewBoard(board, 'ws', 'opus', []);
  const [withSections, without] = web.phases.backlog;
  assert.equal(withSections.problem, 'It is broken.');
  assert.equal(withSections.goals, '- Fix it.');
  // A task file with neither section yields '' — the board renders its "add one" affordance
  // without a null check.
  assert.equal(without.problem, '');
  assert.equal(without.goals, '');
});

test('DONE entries carry problem/goals through as well, so the Done card can show them (t-2191)', () => {
  const [entry] = parseDone('## Tasks\n\n- [x] Shipped\n  - id: t-1\n  - completed: 2026-07-01');
  const board = {
    preamble: '',
    done: [{ ...entry, problem: 'It was broken.', description: 'Story.', goals: '- Fixed.', delivered: 'What shipped.' }],
    tasks: [],
  };
  const web = toWebviewBoard(board, 'ws', 'opus', []);
  assert.equal(web.phases.done[0].problem, 'It was broken.');
  assert.equal(web.phases.done[0].goals, '- Fixed.');
});

// t-39e2: the Promote button's spinner reads the host's arm set, never a webview guess — so the
// payload must flag exactly the armed ids, drafts included, and nothing else (Done cards never).
test('autoPromote flags exactly the armed task ids, DRAFTs included', () => {
  const board = {
    preamble: '',
    done: parseDone('## Tasks\n\n- [x] old\n  - id: t-d1\n  - completed: 2026-07-01'),
    tasks: [
      task({ id: 't-1', phase: 'new' }),
      task({ id: 't-2', phase: 'new' }),
      task({ id: 't-3', phase: 'new', isDraft: true }),
      task({ id: 't-4', phase: 'new', isDraft: true }),
      task({ id: 't-5', phase: 'backlog' }),
    ],
  };
  const web = toWebviewBoard(board, 'ws', 'opus', [], [], 'opus', new Set(['t-1', 't-3']));
  const flagged = Object.values(web.phases).flat().filter((t) => t.autoPromote).map((t) => t.id);
  assert.deepEqual(flagged, ['t-1', 't-3']);
  for (const t of Object.values(web.phases).flat()) assert.equal(typeof t.autoPromote, 'boolean', t.id);
  // Omitted set (every existing caller) = nothing armed.
  const plain = toWebviewBoard(board, 'ws', 'opus', []);
  assert.equal(Object.values(plain.phases).flat().some((t) => t.autoPromote), false);
});

// ---- tags (t-0b10) ----
const { tagsInUse, tagCatalogue, tagOverview } = require('../out-test/view.js');

function doneEntry(over) {
  return Object.assign({ id: 't-d', title: 'D', phase: 'done', checked: true, isDraft: false, questions: [], unknownLines: [], raw: '', tags: [] }, over);
}

const tagBoard = () => ({
  preamble: '',
  tagRegistry: [{ name: 'bug', color: 'red' }, { name: 'docs' }, { name: 'unused', color: 'blue' }],
  tasks: [
    task({ id: 't-1', phase: 'new', isDraft: true, tags: ['bug'] }),
    task({ id: 't-2', phase: 'backlog', tags: ['feature', 'bug'], model: 'sonnet' }),
    task({ id: 't-3', phase: 'feedback', tags: ['bug'], questions: [{ text: 'q', answer: '' }, { text: 'r', answer: 'x' }] }),
    task({ id: 't-4', phase: 'review', tags: [] }),
  ],
  done: [doneEntry({ id: 't-5', tags: ['bug', 'docs'] }), doneEntry({ id: 't-6', tags: ['feature'] })],
});

test('WebTask.tags is filled for active tasks and for Done entries', () => {
  const web = toWebviewBoard(tagBoard(), 'ws', 'opus', []);
  assert.deepEqual(web.phases.new[0].tags, ['bug']);
  assert.deepEqual(web.phases.backlog[0].tags, ['feature', 'bug']);
  assert.deepEqual(web.phases.review[0].tags, []);
  assert.deepEqual(web.phases.done.map((t) => t.tags), [['bug', 'docs'], ['feature']]);
});

test('the payload carries the catalogue: registry plus tags in use, sorted, with color, open and Done counts', () => {
  const web = toWebviewBoard(tagBoard(), 'ws', 'opus', []);
  assert.deepEqual(web.tags, [
    { name: 'bug', color: 'red', open: 3, done: 1 },
    { name: 'docs', color: null, open: 0, done: 1 },
    { name: 'feature', color: null, open: 1, done: 1 },
    { name: 'unused', color: 'blue', open: 0, done: 0 },
  ]);
  assert.deepEqual(tagCatalogue(tagBoard()), web.tags);
  assert.deepEqual(web.tagsInUse, ['bug', 'docs', 'feature'], 'a registry-only tag is not in use');
});

test('the Done count covers every DONE.md entry, not only the 50 the Done tab shows', () => {
  const board = tagBoard();
  board.done = Array.from({ length: 60 }, (_, i) => doneEntry({ id: `t-x${i}`, tags: ['bug'] }));
  const web = toWebviewBoard(board, 'ws', 'opus', []);
  assert.equal(web.phases.done.length, 50);
  assert.equal(web.tags.find((t) => t.name === 'bug').done, 60);
  assert.equal(web.tagOverviews.bug.phases.done.length, 60);
});

test('tagOverview: total, done and the tagged ids per phase in pipeline order (draft = New, Done entries = Done)', () => {
  const o = tagOverview(tagBoard(), 'bug');
  assert.deepEqual(Object.keys(o.phases), ['new', 'backlog', 'inprogress', 'feedback', 'review', 'done']);
  assert.deepEqual(o.phases, { new: ['t-1'], backlog: ['t-2'], inprogress: [], feedback: ['t-3'], review: [], done: ['t-5'] });
  assert.equal(o.total, 4);
  assert.equal(o.done, 1);
  assert.equal(tagOverview(tagBoard(), ' BUG ').total, 4, 'the name is normalized');
  const none = tagOverview(tagBoard(), 'nobody');
  assert.equal(none.total, 0);
  assert.equal(none.done, 0);
  assert.deepEqual(Object.values(none.phases), [[], [], [], [], [], []]);
});

test('the overview rows carry the other tags, unanswered count and the owning model', () => {
  const web = toWebviewBoard(tagBoard(), 'ws', 'opus', []);
  const ov = web.tagOverviews.bug;
  assert.equal(ov.total, 4);
  assert.equal(ov.done, 1);
  assert.deepEqual(ov.phases.backlog, [{ id: 't-2', isDraft: false, title: 'T', tags: ['feature'], unanswered: 0, model: 'sonnet' }]);
  assert.equal(ov.phases.new[0].isDraft, true);
  assert.equal(ov.phases.new[0].model, 'opus', 'no model: falls back to the default worker model');
  assert.equal(ov.phases.feedback[0].unanswered, 1);
  assert.deepEqual(ov.phases.done[0].tags, ['docs']);
  assert.equal(web.tagOverviews.unused, undefined, 'only tags in use have an overview');
});

test('tagsInUse is empty when no task carries a tag, even with a non-empty registry', () => {
  const board = { preamble: '', tasks: [task({ id: 't-1' })], done: [doneEntry({ id: 't-2' })], tagRegistry: [{ name: 'bug', color: 'red' }] };
  assert.deepEqual(tagsInUse(board), []);
  const web = toWebviewBoard(board, 'ws', 'opus', []);
  assert.deepEqual(web.tagsInUse, []);
  assert.deepEqual(web.tagOverviews, {});
  assert.deepEqual(web.tags, [{ name: 'bug', color: 'red', open: 0, done: 0 }]);
});
