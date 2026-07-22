'use strict';
// Board -> webview payload: badge, dependency-met lookup against done: IndexEntry[], hasDetailFile.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseDone } = require('../out-test/parser.js');
const { computeBadge, toWebviewBoard } = require('../out-test/view.js');

// Minimal composed task (index + detail fields flattened, as store.compose produces).
function task(over) {
  return Object.assign(
    {
      id: 't-x', title: 'T', phase: 'backlog', checked: false, isDraft: false,
      questions: [], hasDetailFile: true,
      worklog: [], links: [], dependsOn: [], notes: [], unknownLines: [],
      raw: '',
    },
    over
  );
}

test('computeBadge = new (incl DRAFTs) + unanswered feedback + review', () => {
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
  assert.equal(b.newCount, 2);
  assert.equal(b.feedbackUnanswered, 1);
  assert.equal(b.reviewCount, 1);
  assert.equal(b.count, 4);
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
