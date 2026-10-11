'use strict';
// Drag reorder in the webview (t-81a0). media/board.js is a vanilla browser script the Docker suite
// never loads as a module, so the helpers are lifted out of the SOURCE TEXT and run in a bare vm
// context (the test/board-gate-button.test.js technique) against fake elements and events. The
// live drag is VERIFICATION.md item 67 (untested).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'media', 'board.js'), 'utf8');

function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'media/board.js must define ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}
const typeLine = source.match(/^\s*const REORDER_TYPE = '[^']+';$/m);
assert.ok(typeLine, 'media/board.js must declare REORDER_TYPE');
const REORDER_TYPE = typeLine[0].match(/'([^']+)'/)[1];

function context(extra, names) {
  const ctx = Object.assign({}, extra);
  vm.createContext(ctx);
  vm.runInContext('var REORDER_TYPE = ' + JSON.stringify(REORDER_TYPE) + ';', ctx);
  for (const n of names) vm.runInContext(extractFunction(n), ctx);
  return ctx;
}

// Records listeners and class changes; events carry their own preventDefault bookkeeping.
function fakeEl(extra) {
  const listeners = {};
  const classes = new Set();
  return Object.assign({
    listeners,
    classes,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)) },
    fire(type, ev) { for (const fn of listeners[type] || []) fn(ev); return ev; },
  }, extra);
}
function dragEvent(types, files, clientY) {
  return {
    dataTransfer: { types, files: files || [], dropEffect: 'none' },
    clientY: clientY || 0,
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}
const FILE = { name: 'shot.png' };

test('reorderAnchor: a drop above a card names that card, below the last card is null, the own slot posts nothing', () => {
  const { reorderAnchor } = context({}, ['reorderAnchor']);
  const ids = ['a', 'b', 'c'];
  const mids = [10, 30, 50];
  assert.equal(reorderAnchor(ids, mids, 'c', 5), 'a', 'above the first card');
  assert.equal(reorderAnchor(ids, mids, 'c', 25), 'b', 'above b (below a\'s centre)');
  assert.equal(reorderAnchor(ids, mids, 'a', 40), 'c', 'above c');
  assert.equal(reorderAnchor(ids, mids, 'a', 60), null, 'below the last card -> end of the tab');
  assert.equal(reorderAnchor(ids, mids, 'b', 20), undefined, 'just above itself');
  assert.equal(reorderAnchor(ids, mids, 'b', 40), undefined, 'just below itself');
  assert.equal(reorderAnchor(ids, mids, 'c', 60), undefined, 'the last card dropped at the end');
  assert.equal(reorderAnchor(ids, mids, 'a', 0), undefined, 'the first card dropped at the top');
  assert.equal(reorderAnchor(ids, mids, 'gone', 5), undefined, 'a card no longer rendered in this tab');
});

test('attach drop handlers ignore a drag carrying the reorder type', () => {
  const attached = [];
  const staged = [];
  const ctx = context({
    attachFile: (id, f) => attached.push([id, f]),
    readAttachmentFile: (f) => staged.push(f),
    post: () => {},
    pendingAttach: {},
    attachReqSeq: 1,
  }, ['isReorderDrag', 'wireAttachDropAndPaste', 'wireFieldAttach']);

  const card = fakeEl();
  ctx.wireAttachDropAndPaste(card, 't-1');
  const over = card.fire('dragover', dragEvent([REORDER_TYPE]));
  assert.equal(over.prevented, false, 'the card does not accept the drag itself — it bubbles to the list');
  assert.equal(card.classes.has('drag-over'), false, 'no attach highlight');
  const drop = card.fire('drop', dragEvent([REORDER_TYPE, 'Files'], [FILE]));
  assert.equal(drop.prevented, false);
  assert.deepEqual(attached, [], 'a card dropped on a card never stages an attachment');

  const field = fakeEl();
  ctx.wireFieldAttach(field, 't-1', 'description', undefined, () => {});
  const fdrop = field.fire('drop', dragEvent([REORDER_TYPE, 'Files'], [FILE]));
  assert.equal(fdrop.prevented || fdrop.stopped, false);
  assert.deepEqual(staged, [], 'the field stages nothing either');

  // Control: a plain file drop still attaches through both.
  card.fire('drop', dragEvent(['Files'], [FILE]));
  assert.deepEqual(attached, [['t-1', FILE]]);
  field.fire('drop', dragEvent(['Files'], [FILE]));
  assert.deepEqual(staged, [FILE]);
});

function reorderList() {
  const cards = ['a', 'b', 'c'].map((id, i) => fakeEl({
    dataset: { task: id },
    getBoundingClientRect: () => ({ top: i * 40, height: 20 }),
  }));
  const list = fakeEl({
    children: cards,
    contains: (n) => cards.includes(n),
    querySelectorAll: () => cards.filter((c) => c.classes.has('drop-before') || c.classes.has('drop-after')),
  });
  return { list, cards };
}
function reorderContext() {
  const posted = [];
  const ctx = context({ post: (m) => posted.push(m), document: {}, gateInFlight: false, reorderDrag: null },
    ['isReorderDrag', 'reorderAnchor', 'showDropLine', 'wireReorderDrop']);
  return { ctx, posted };
}

test('reorder handlers ignore a drag carrying only files', () => {
  const { ctx, posted } = reorderContext();
  const { list, cards } = reorderList();
  ctx.wireReorderDrop(list);
  ctx.reorderDrag = { taskId: 'c', phase: 'backlog' };
  const over = list.fire('dragover', dragEvent(['Files'], [FILE], 5));
  assert.equal(over.prevented, false, 'a file drag is left to the attach handlers');
  assert.ok(cards.every((c) => c.classes.size === 0), 'no insertion line');
  const drop = list.fire('drop', dragEvent(['Files'], [FILE], 5));
  assert.equal(drop.prevented, false);
  assert.deepEqual(posted, []);
  assert.deepEqual(ctx.reorderDrag, { taskId: 'c', phase: 'backlog' }, 'the card drag is still live');
});

test('reorder drop posts the anchor once, shows the line on dragover, and a second drop in flight is swallowed', () => {
  const { ctx, posted } = reorderContext();
  const { list, cards } = reorderList();
  ctx.wireReorderDrop(list);

  ctx.reorderDrag = { taskId: 'c', phase: 'new' };
  const over = list.fire('dragover', dragEvent([REORDER_TYPE], [], 5));
  assert.equal(over.prevented, true);
  assert.ok(cards[0].classes.has('drop-before'), 'insertion line above a');
  const drop = list.fire('drop', dragEvent([REORDER_TYPE], [], 5));
  assert.equal(drop.prevented, true);
  assert.ok(cards.every((c) => c.classes.size === 0), 'line cleared on drop');
  assert.equal(JSON.stringify(posted), JSON.stringify([{ type: 'reorder', taskId: 'c', phase: 'new', beforeId: 'a' }]));
  assert.equal(ctx.gateInFlight, true);

  ctx.reorderDrag = { taskId: 'a', phase: 'new' };
  list.fire('drop', dragEvent([REORDER_TYPE], [], 200));
  assert.equal(posted.length, 1, 'swallowed while the first reorder is in flight');

  ctx.gateInFlight = false;
  ctx.reorderDrag = { taskId: 'a', phase: 'new' };
  list.fire('dragover', dragEvent([REORDER_TYPE], [], 200));
  assert.ok(cards[2].classes.has('drop-after'), 'insertion line below the last card');
  list.fire('drop', dragEvent([REORDER_TYPE], [], 200));
  assert.equal(JSON.stringify(posted[1]), JSON.stringify({ type: 'reorder', taskId: 'a', phase: 'new', beforeId: null }));

  ctx.gateInFlight = false;
  ctx.reorderDrag = { taskId: 'b', phase: 'new' };
  list.fire('drop', dragEvent([REORDER_TYPE], [], 25));
  assert.equal(posted.length, 2, 'a drop on its own slot posts nothing');
  assert.equal(ctx.gateInFlight, false);
});
