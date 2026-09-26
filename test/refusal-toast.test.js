'use strict';
// Honest refusal toasts and the patch round trip (t-5831).
//
// The toast text is the pure `refusalToast` in src/merge.ts, run for real. The host wiring
// (src/store.ts, src/controller.ts) imports vscode and the webview side (media/board.js) is never
// loaded by the Docker suite, so — the test/board-patch-echo.test.js technique — their invariants
// are asserted over the SOURCE TEXT.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { refusalToast, fieldLabel } = require('../out-test/merge.js');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const codeLines = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//'));

const ALL_FIELDS = ['title', 'model', 'groomer', 'answer', 'answers', 'feedbackAdd', 'feedbackItem', 'description', 'problem', 'goals', 'someFutureField'];
const RAW_KINDS = ['feedbackAdd', 'feedbackItem', 'answers'];

// ---- the pure toast text ----

test('a conflict says the task changed on disk and names the human field label', () => {
  assert.equal(refusalToast('conflict', 'description'), 'Task changed on disk — your description edit was not applied.');
  assert.match(refusalToast('conflict', 'feedbackAdd'), /your feedback edit was not applied/);
  assert.match(refusalToast('conflict', 'feedbackItem'), /your feedback edit was not applied/);
  assert.match(refusalToast('conflict', 'answers'), /your answer edit was not applied/);
  assert.match(refusalToast('conflict', 'answer'), /your answer edit was not applied/);
  assert.match(refusalToast('conflict', 'model'), /your worker model edit/);
  for (const f of ALL_FIELDS) assert.match(refusalToast('conflict', f), /^Task changed on disk/, f);
});

test('for answers and feedback a conflict also says the text was kept; other fields do not promise it', () => {
  for (const f of ['answer', 'answers', 'feedbackAdd', 'feedbackItem']) {
    assert.match(refusalToast('conflict', f), /Your text was kept/, f);
  }
  for (const f of ['title', 'model', 'groomer', 'description', 'problem', 'goals']) {
    assert.doesNotMatch(refusalToast('conflict', f), /kept/, f + ' is not rescued yet (follow-up story)');
  }
});

test('unsupported says to reload the window and never says "changed on disk"', () => {
  for (const f of ALL_FIELDS) {
    const text = refusalToast('unsupported', f);
    assert.match(text, /out of step/, f);
    assert.match(text, /Reload the window/, f);
    assert.doesNotMatch(text, /changed on disk/, f);
  }
  assert.equal(refusalToast('unsupported', 'someFutureField'),
    'The board and the extension are out of step — your edit was not applied. Reload the window (Developer: Reload Window).',
    'a field this build does not know is simply "your edit"');
});

test('notfound keeps today\'s text; applied and noop say nothing', () => {
  for (const f of ALL_FIELDS) {
    assert.equal(refusalToast('notfound', f), 'That task no longer exists on disk — the board was refreshed.', f);
    assert.equal(refusalToast('applied', f), undefined, f);
    assert.equal(refusalToast('noop', f), undefined, f);
  }
});

test('no outcome\'s text contains a raw patch kind', () => {
  for (const status of ['conflict', 'unsupported', 'notfound']) {
    for (const f of ALL_FIELDS) {
      const text = refusalToast(status, f);
      for (const kind of RAW_KINDS) assert.ok(!text.includes(kind), `${status}/${f} leaks ${kind}: ${text}`);
      assert.ok(!text.includes('someFutureField'), `${status}/${f} leaks the raw unknown field`);
    }
  }
  for (const f of ALL_FIELDS) for (const kind of RAW_KINDS) assert.ok(!fieldLabel(f).includes(kind), f);
});

// ---- host wiring (source text) ----

const store = codeLines(read('src', 'store.ts'));
const controller = codeLines(read('src', 'controller.ts'));
const board = codeLines(read('media', 'board.js'));

test('the unsupported outcome is logged at info with task id, field and value, on both store paths', () => {
  const lines = store.filter((l) => l.includes("this.debugLog('info', 'unsupported',"));
  assert.equal(lines.length, 2, 'index path + detail path');
  for (const l of lines) {
    assert.match(l, /if \(result\.status === 'unsupported'\)/);
    assert.match(l, /`\$\{patch\.taskId\} \$\{patch\.field\} -> \$\{patch\.value\}`/);
  }
});

test('the toast text comes from refusalToast, never from the raw patch kind', () => {
  const src = read('src', 'controller.ts');
  const onPatch = src.slice(src.indexOf('private async onPatch('), src.indexOf('private async onGate('));
  assert.match(onPatch, /const text = refusalToast\(outcome\.status, patch\.field\);/);
  assert.doesNotMatch(onPatch, /your edit to \$\{/, 'the old raw-field template is gone');
});

// ---- the round trip (source text) ----

test('sendPatch puts a request id on every patch, and is the only poster of patch messages', () => {
  const posts = board.filter((l) => l.includes("type: 'patch'"));
  assert.equal(posts.length, 1, 'exactly one line posts a patch message');
  assert.match(posts[0], /post\(\{ type: 'patch', reqId, patch \}\);/);
  const src = read('media', 'board.js');
  const send = src.slice(src.indexOf('function sendPatch('), src.indexOf('function commitPatch('));
  assert.ok(send.includes(posts[0].trim()), 'and it lives in sendPatch');
  assert.match(send, /const reqId = patchTag \+ ':' \+ patchSeq\+\+;/, 'a fresh id per patch');
  assert.match(send, /pendingPatches\[reqId\] = patch;/, 'remembered until the host answers');
});

test('the host echoes the request id with the status on every non-applied outcome', () => {
  assert.ok(controller.some((l) => l.includes('return this.onPatch(msg.patch as FieldPatch, msg.reqId);')), 'the id reaches onPatch');
  const src = read('src', 'controller.ts');
  const onPatch = src.slice(src.indexOf('private async onPatch('), src.indexOf('private async onGate('));
  const reply = "BoardPanel.current?.post({ type: 'patchResult', reqId, status: outcome.status, taskId: patch.taskId });";
  assert.ok(onPatch.includes(reply), 'patchResult carries reqId + status');
  // Unconditional (every outcome, so the webview's pending map empties), and before the refresh.
  const replyLine = onPatch.split('\n').find((l) => l.includes(reply));
  assert.match(replyLine, /^    BoardPanel/, 'not inside any branch');
  assert.ok(onPatch.indexOf(reply) < onPatch.indexOf('return this.refresh();'), 'posted before the refresh that carries disk');
  // The webview reads it back by the same id and queues a refusal for rescue.
  assert.ok(board.some((l) => l.includes("msg.type === 'patchResult'")));
  assert.ok(board.some((l) => l.includes('const patch = pendingPatches[msg.reqId];')));
  assert.ok(board.some((l) => l.includes("if (patch && (msg.status === 'conflict' || msg.status === 'unsupported')) {")));
});

test('sameFieldConflict is still tagged on both sides', () => {
  assert.ok(controller.some((l) => l.includes("outcome.status === 'conflict' ? 'sameFieldConflict' : undefined")), 'host tags a conflict toast');
  assert.ok(board.some((l) => l.includes("if (msg.kind === 'sameFieldConflict') forceNextBoard = true;")), 'webview still force-flushes on it');
});
