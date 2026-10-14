'use strict';
// t-0e99 owner bug: a DRAFT whose groom wrote `question:` sub-bullets but kept the DRAFT: title
// showed no questions on the board. The parser and the payload always carried them (pinned here);
// the draft card never drew them. media/board.js is a webview asset the Docker suite never loads,
// so its half is pinned by source text; what the card draws is a VERIFICATION.md manual item.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseTodo } = require('../out-test/parser.js');
const { toWebviewBoard } = require('../out-test/view.js');
const { TASK_DEFAULTS } = require('../out-test/model.js');

const TODO = [
  '## Tasks', '',
  '- [ ] DRAFT: louder axe',
  '  - id: t-b634',
  '  - question: Which sounds count?',
  '    - answer:',
  '    - suggestion: only hits',
  '  - question: Borrowed clips too?',
  '    - answer: no',
  '',
].join('\n');

test('a DRAFT entry keeps its questions through the parser and into the webview payload', () => {
  const doc = parseTodo(TODO);
  const entry = doc.entries.find((e) => e.id === 't-b634');
  assert.equal(entry.isDraft, true);
  assert.deepEqual(entry.questions.map((q) => [q.text, q.answer]), [['Which sounds count?', ''], ['Borrowed clips too?', 'no']]);
  const task = Object.assign({ hasDetailFile: true, worklog: [], links: [], dependsOn: [] }, entry);
  const web = toWebviewBoard({ preamble: '', done: [], tasks: [task] }, 'ws', { ...TASK_DEFAULTS, worker: 'opus' }, []);
  const card = web.phases.new[0];
  assert.equal(card.isDraft, true);
  assert.deepEqual(card.questions.map((q) => q.answered), [false, true]);
  assert.deepEqual(card.questions[0].suggestions, ['only hits']);
});

test('the draft card renders the questions panel whenever the draft carries questions', () => {
  const board = fs.readFileSync(path.resolve(__dirname, '..', 'media', 'board.js'), 'utf8');
  const start = board.indexOf('  function renderDraft(t) {');
  const draft = board.slice(start, board.indexOf('\n  function ', start + 1));
  assert.match(draft, /isCollapsedCard \|\| !\(t\.questions\.length \|\| rescuedAnswers\[t\.id\]\) \? null : renderQuestions\(t\)/);
});
