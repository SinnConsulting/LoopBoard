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
      worklog: [], links: [], dependsOn: [], notes: [], feedback: [], unknownLines: [],
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

test('note maps from notes[] joined with newlines', () => {
  const board = {
    preamble: '', done: [],
    tasks: [task({ id: 't-1', phase: 'inprogress', notes: ['a', 'b'] })],
  };
  const web = toWebviewBoard(board, 'ws', 'opus', []);
  assert.equal(web.phases.inprogress[0].note, 'a\nb');
});

test('feedback maps from feedback[] joined with newlines', () => {
  const board = {
    preamble: '', done: [],
    tasks: [task({ id: 't-1', phase: 'review', feedback: ['a', 'b'] })],
  };
  const web = toWebviewBoard(board, 'ws', 'opus', []);
  assert.equal(web.phases.review[0].feedback, 'a\nb');
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
