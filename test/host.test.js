/* Host-side suite: Store + Controller + BoardPanel + renderHtml, running headless.
 *
 * These four modules import `vscode`, so they compile only under the main tsconfig (-> out/) and
 * used to be reachable only through the F5 checklist in VERIFICATION.md. test/fake-vscode.js
 * resolves `require('vscode')` to a hand-written stand-in, so the REAL compiled out/ code runs
 * against a temp `.loopboard/` workspace mounted from test/fixtures.
 *
 * Every message a test sends is one media/board.js actually posts (`post({ type: ... })` call
 * sites) — the point is to exercise the same wire protocol, not a private API.
 */
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fake = require('./fake-vscode.js');
fake.install();

const vscode = require('vscode');
const { Store } = require('../out/store.js');
const { Controller } = require('../out/controller.js');
const { BoardPanel } = require('../out/panel.js');
const { parseTodo } = require('../out/parser.js');
const { serializeTodo } = require('../out/writer.js');

const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'test', 'fixtures');
const mounted = [];

after(() => {
  for (const dir of mounted) fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- harness

// Copy (never mutate) a fixture tracker into a fresh temp workspace.
function mountWorkspace(index) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopboard-host-'));
  mounted.push(dir);
  fs.mkdirSync(path.join(dir, '.loopboard', 'tasks'), { recursive: true });
  fs.copyFileSync(path.join(fixtures, index), path.join(dir, '.loopboard', 'TODO.md'));
  fs.copyFileSync(path.join(fixtures, 'taskfile-full.md'), path.join(dir, '.loopboard', 'tasks', 't-cc01.md'));
  fs.copyFileSync(path.join(root, 'media', 'template-loop.md'), path.join(dir, '.loopboard', 'LOOP.md'));
  return dir;
}

function fakeTerminals() {
  const calls = [];
  return {
    calls,
    onDidChangeStatus() {},
    status: () => [
      { id: 'opus', name: 'Opus', running: true, hint: '' },
      { id: 'sonnet', name: 'Sonnet', running: false, hint: '' },
    ],
    nudge(model, text) {
      calls.push({ call: 'nudge', model, text });
      return true;
    },
    spawn: (model) => calls.push({ call: 'spawn', model }),
    recycle: (model) => calls.push({ call: 'recycle', model }),
    stop: (model) => calls.push({ call: 'stop', model }),
    clearSession: (model) => calls.push({ call: 'clearSession', model }),
  };
}

function fakeSidebar() {
  const posted = [];
  const badges = [];
  return {
    posted,
    badges,
    onMessage() {},
    post: (msg) => posted.push(msg),
    setBadge: (b) => badges.push(b),
  };
}

// Mount a workspace, wire a real Store + Controller + BoardPanel, and open the board so the
// fake webview is live. Returns the handles a test needs.
async function mount(options) {
  const opts = options || {};
  fake.reset();
  BoardPanel.current?.dispose();

  const dir = mountWorkspace(opts.index || 'index-full.md');
  const folder = { uri: vscode.Uri.file(dir), name: 'fixture-ws', index: 0 };
  const store = new Store(folder, () => opts.debug || 'off');
  const terminals = fakeTerminals();
  const sidebar = fakeSidebar();
  const controller = new Controller(vscode.Uri.file(root), store, terminals, sidebar, fake.createMemento());

  controller.openBoard();
  const panel = fake.lastPanel();
  await panel.htmlReady();
  // media/board.js's last line: `post({ type: 'ready' })`.
  await panel.webview.fire({ type: 'ready' });

  return {
    dir,
    store,
    controller,
    terminals,
    sidebar,
    panel,
    send: (msg) => panel.webview.fire(msg),
    read: (rel) => fs.readFileSync(path.join(dir, '.loopboard', rel), 'utf8'),
    exists: (rel) => fs.existsSync(path.join(dir, '.loopboard', rel)),
    posted: () => panel.webview.posted,
    board: () => {
      const m = [...panel.webview.posted].reverse().find((x) => x.type === 'board');
      return m && m.board;
    },
    toasts: () => panel.webview.posted.filter((x) => x.type === 'toast'),
  };
}

function entryLines(todoText, id) {
  const lines = todoText.split('\n');
  const start = lines.findIndex((l) => l.trim() === `- id: ${id}`);
  assert.ok(start > 0, `entry ${id} present`);
  let head = start;
  while (head > 0 && !lines[head].startsWith('- [')) head--;
  let end = head + 1;
  while (end < lines.length && lines[end].startsWith('  ')) end++;
  return lines.slice(head, end);
}

function phaseIds(board, phase) {
  return board.phases[phase].map((t) => t.id);
}

// ---------------------------------------------------------------- webview HTML (src/webview.ts)

test('renderHtml substitutes every placeholder and reuses one nonce for CSP + script tag', async () => {
  const ctx = await mount();
  const html = ctx.panel.webview.html;
  assert.ok(!/\{\{\w+\}\}/.test(html), `no placeholder left behind:\n${html}`);
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  assert.ok(csp, 'CSP meta rendered');
  const cspNonce = /script-src 'nonce-([A-Za-z0-9]{32})'/.exec(csp[1]);
  assert.ok(cspNonce, `script-src carries a 32-char nonce: ${csp[1]}`);
  const tagNonce = /<script nonce="([A-Za-z0-9]{32})"/.exec(html);
  assert.ok(tagNonce, 'script tag carries a nonce');
  assert.equal(tagNonce[1], cspNonce[1], 'the script tag uses the CSP nonce');
  assert.ok(html.includes('board.js'), 'scriptUri points at board.js');
  assert.ok(html.includes('board.css'), 'styleUri points at board.css');
  assert.ok(html.includes('codicon.css'), 'codiconUri points at codicon.css');
  assert.equal(csp[1].includes(`default-src 'none'`), true);
});

test('the ready message posts a board to BOTH surfaces and a badge to the sidebar', async () => {
  const ctx = await mount();
  const board = ctx.board();
  assert.ok(board, 'board posted to the panel');
  assert.deepEqual(phaseIds(board, 'new'), ['t-aa01', 't-aa02']);
  assert.deepEqual(phaseIds(board, 'backlog'), ['t-dd01']);
  assert.deepEqual(phaseIds(board, 'inprogress'), ['t-bb01']);
  assert.deepEqual(phaseIds(board, 'feedback'), ['t-cc01']);
  assert.deepEqual(phaseIds(board, 'review'), ['t-ee01']);
  assert.equal(board.workspaceName, 'fixture-ws');
  assert.ok(ctx.sidebar.posted.some((m) => m.type === 'board'), 'sidebar got the same board');
  assert.equal(ctx.sidebar.badges.at(-1).reviewCount, 1);
  assert.equal(ctx.sidebar.badges.at(-1).draftCount, 1);
});

// ---------------------------------------------------------------- (1) promote

test('promote: New -> Backlog rewrites TODO.md canonically and posts a refreshed board', async () => {
  const ctx = await mount();
  // media/board.js: post({ type: 'gate', taskId: t.id, action: 'promote' })
  await ctx.send({ type: 'gate', taskId: 't-aa01', action: 'promote' });

  const todo = ctx.read('TODO.md');
  assert.deepEqual(entryLines(todo, 't-aa01'), [
    '- [ ] Add rate limiting middleware to the public REST API',
    '  - id: t-aa01',
    '  - phase: backlog',
  ]);
  // Canonical write-back (CLAUDE.md non-negotiable #3): the whole file is already a fixpoint.
  assert.equal(serializeTodo(parseTodo(todo)), todo, 'TODO.md is written back canonically');

  // The gate also lands `promoted:` + a worklog line in the (previously absent) task file.
  const detail = fs.readFileSync(path.join(ctx.dir, '.loopboard', 'tasks', 't-aa01.md'), 'utf8');
  assert.match(detail, /^# Add rate limiting middleware to the public REST API \(t-aa01\)$/m);
  assert.match(detail, /- promoted: \d{4}-\d{2}-\d{2}/);

  const board = ctx.board();
  assert.deepEqual(phaseIds(board, 'new'), ['t-aa02'], 't-aa01 left New');
  assert.ok(phaseIds(board, 'backlog').includes('t-aa01'), 't-aa01 arrived in Backlog');
  assert.deepEqual(
    ctx.toasts().map((t) => [t.level, t.text]),
    [['success', 'Promoted to Backlog']]
  );
  // No native modal for a story with no questions.
  assert.deepEqual(fake.recorded.messages, []);
});

test('promote: a story with questions is gated by a native modal, and Cancel writes nothing', async () => {
  const ctx = await mount();
  // t-cc01 has two questions, one still blank -> the "unanswered questions" modal.
  const before = ctx.read('TODO.md');
  await ctx.send({ type: 'gate', taskId: 't-cc01', action: 'promote' });
  assert.equal(fake.recorded.messages.length, 1);
  assert.match(fake.recorded.messages[0].message, /unanswered questions/);
  assert.equal(fake.recorded.messages[0].options.modal, true);
  assert.equal(ctx.read('TODO.md'), before, 'cancelled promote is a no-op on disk');

  fake.answerWith('Promote anyway');
  await ctx.send({ type: 'gate', taskId: 't-cc01', action: 'promote' });
  assert.match(entryLines(ctx.read('TODO.md'), 't-cc01').join('\n'), /- phase: backlog/);
});

// ---------------------------------------------------------------- (2) accept

test('accept: Review -> DONE.md moves the entry and creates DONE.md when absent', async () => {
  const ctx = await mount();
  assert.equal(ctx.exists('DONE.md'), false, 'DONE.md is lazy — absent until the first acceptance');

  // media/board.js: post({ type: 'gate', taskId: t.id, action: 'accept' })
  await ctx.send({ type: 'gate', taskId: 't-ee01', action: 'accept' });

  assert.equal(ctx.exists('DONE.md'), true, 'DONE.md created on first acceptance');
  const done = ctx.read('DONE.md');
  assert.match(done, /- id: t-ee01/);
  assert.match(done, /- completed: \d{4}-\d{2}-\d{2}/);
  assert.ok(!done.includes('feedback:'), 'the DONE entry is slim');

  const todo = ctx.read('TODO.md');
  assert.ok(!todo.includes('t-ee01'), 'the entry left the index');
  assert.equal(serializeTodo(parseTodo(todo)), todo);

  // The task file stays in place and gains `completed:`.
  const detail = fs.readFileSync(path.join(ctx.dir, '.loopboard', 'tasks', 't-ee01.md'), 'utf8');
  assert.match(detail, /- completed: \d{4}-\d{2}-\d{2}/);

  const board = ctx.board();
  assert.deepEqual(phaseIds(board, 'review'), []);
  assert.deepEqual(phaseIds(board, 'done'), ['t-ee01']);
  assert.deepEqual(
    ctx.toasts().map((t) => [t.level, t.text]),
    [['success', 'Accepted — archived to DONE.md']]
  );
});

// ---------------------------------------------------------------- (3) demote

test('demote: Backlog -> New, and a second demote is refused as a conflict', async () => {
  const ctx = await mount();
  // media/board.js: post({ type: 'gate', taskId: t.id, action: 'demote' })
  await ctx.send({ type: 'gate', taskId: 't-dd01', action: 'demote' });

  assert.deepEqual(entryLines(ctx.read('TODO.md'), 't-dd01'), [
    '- [ ] Migrate integration tests from Jest to node:test',
    '  - id: t-dd01',
    '  - phase: new',
    '  - model: sonnet',
  ]);
  assert.ok(phaseIds(ctx.board(), 'new').includes('t-dd01'));
  assert.deepEqual(ctx.toasts().map((t) => t.text), ['Demoted to New']);

  // Non-destructive but phase-guarded: it is no longer Backlog, so disk wins.
  await ctx.send({ type: 'gate', taskId: 't-dd01', action: 'demote' });
  const last = ctx.toasts().at(-1);
  assert.equal(last.level, 'warning');
  assert.match(last.text, /no longer in Backlog/);
});

// ---------------------------------------------------------------- (4) field patch

test('a model patch is a field-level patch on ONE file (the index) and leaves everything else alone', async () => {
  const ctx = await mount();
  const before = ctx.read('TODO.md');

  // media/board.js: sendPatch(t.id, 'model', normModelValue(...), t.model || '')
  await ctx.send({ type: 'patch', patch: { taskId: 't-dd01', field: 'model', value: 'opus', base: 'sonnet' } });

  const after = ctx.read('TODO.md');
  assert.deepEqual(entryLines(after, 't-dd01'), [
    '- [ ] Migrate integration tests from Jest to node:test',
    '  - id: t-dd01',
    '  - phase: backlog',
    '  - model: opus',
  ]);
  // Only that entry's model moved; no other entry changed.
  for (const id of ['t-aa01', 't-aa02', 't-bb01', 't-cc01', 't-ee01']) {
    assert.deepEqual(entryLines(after, id), entryLines(before, id), `${id} untouched`);
  }
  // An index field never touches the detail file or DONE.md.
  assert.deepEqual(fs.readdirSync(path.join(ctx.dir, '.loopboard', 'tasks')), ['t-cc01.md']);
  assert.equal(ctx.exists('DONE.md'), false);
  assert.deepEqual(ctx.toasts(), [], 'a clean patch raises no toast');

  // The default option normalizes to '' webview-side; clearing the field drops the line entirely.
  await ctx.send({ type: 'patch', patch: { taskId: 't-dd01', field: 'model', value: '', base: 'opus' } });
  assert.deepEqual(entryLines(ctx.read('TODO.md'), 't-dd01'), [
    '- [ ] Migrate integration tests from Jest to node:test',
    '  - id: t-dd01',
    '  - phase: backlog',
  ]);
});

test('a description patch targets ONLY the detail file and never rewrites TODO.md (t-f1b0)', async () => {
  const ctx = await mount();
  const before = ctx.read('TODO.md');
  await ctx.send({
    type: 'patch',
    patch: { taskId: 't-cc01', field: 'description', value: 'Rewritten body.', base: 'Retries for failed webhook deliveries.\n\nSecond paragraph with **bold** and a `code` span.' },
  });
  const detail = fs.readFileSync(path.join(ctx.dir, '.loopboard', 'tasks', 't-cc01.md'), 'utf8');
  assert.match(detail, /## Description\n\nRewritten body\./);
  assert.match(detail, /## Worklog/, 'untouched sections survive');
  assert.equal(ctx.read('TODO.md'), before, 'one file per save: no index rev bump');
});

// ---------------------------------------------------------------- (5) conflict

test('same-field conflict: disk wins, nothing is written, and a warning toast is posted', async () => {
  const ctx = await mount();
  const before = ctx.read('TODO.md');

  // The webview rendered `fable` but disk says `opus` — a loop changed it underneath.
  await ctx.send({ type: 'patch', patch: { taskId: 't-bb01', field: 'model', value: 'sonnet', base: 'fable' } });

  assert.equal(ctx.read('TODO.md'), before, 'the on-disk value wins; nothing was written');
  const toast = ctx.toasts().at(-1);
  assert.equal(toast.level, 'warning');
  assert.equal(toast.text, 'Task changed on disk — your edit to model was not applied.');
  assert.equal(toast.taskId, 't-bb01');
  // The refreshed board still carries the disk value, so the card repaints with it.
  assert.equal(ctx.board().phases.inprogress[0].model, 'opus');
});

test('a patch for an id that no longer exists on disk reports notfound', async () => {
  const ctx = await mount();
  await ctx.send({ type: 'patch', patch: { taskId: 't-zzzz', field: 'title', value: 'x', base: 'y' } });
  assert.match(ctx.toasts().at(-1).text, /no longer exists on disk/);
});

// ---------------------------------------------------------------- (6) unparseable lines

test('unparseable sub-bullets survive a save verbatim and are flagged on the card', async () => {
  const ctx = await mount({ index: 'index-unknown.md' });
  const unknown = [
    '  - owner: @claude',
    '  - added: 2026-07-08',
    '  - description: A normal description.',
    '  - reviewer: @someone',
  ];
  assert.deepEqual(ctx.board().phases.inprogress[0].unparsedLines, [
    'owner: @claude',
    'added: 2026-07-08',
    'description: A normal description.',
    'reviewer: @someone',
  ]);

  await ctx.send({ type: 'patch', patch: { taskId: 't-ff01', field: 'title', value: 'Renamed by the board', base: 'Task with non-canonical sub-bullets' } });

  const after = ctx.read('TODO.md');
  assert.match(after, /^- \[ \] Renamed by the board$/m, 'the patched field changed');
  for (const line of unknown) {
    assert.ok(after.split('\n').includes(line), `preserved verbatim: ${line}`);
  }
  assert.equal(serializeTodo(parseTodo(after)), after, 'still canonical after the save');
  assert.deepEqual(ctx.board().phases.inprogress[0].unparsedLines.length, 4);
});

// ---------------------------------------------------------------- (7) debug sink

test('the debug sink writes at info and writes nothing at off', async () => {
  const off = await mount({ debug: 'off' });
  off.store.debugLog('info', 'unit-test', 'should never land');
  await off.store.flushDebug();
  assert.equal(off.exists('debug.log'), false, 'loopBoard.debug=off never touches the sink');

  const on = await mount({ debug: 'info' });
  await on.send({ type: 'gate', taskId: 't-aa01', action: 'promote' });
  on.store.debugLog('verbose', 'too-chatty', 'below the configured level');
  await on.store.flushDebug();
  assert.equal(on.exists('debug.log'), true);
  const log = on.read('debug.log');
  assert.match(log, /\tpromote\tt-aa01 -> backlog$/m, 'info lifecycle events land');
  assert.ok(!log.includes('too-chatty'), 'verbose events stay out at level info');
  assert.match(log, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\t/m, 'each line is ISO-timestamped and tab-separated');
});

test('the debug sink records verbose per-patch detail at level verbose', async () => {
  const ctx = await mount({ debug: 'verbose' });
  await ctx.send({ type: 'patch', patch: { taskId: 't-dd01', field: 'model', value: 'opus', base: 'sonnet' } });
  await ctx.store.flushDebug();
  const log = ctx.read('debug.log');
  assert.match(log, /\tpatch\tt-dd01 model -> applied = opus$/m);
  assert.match(log, /\tdispatch\tpatch$/m);
});

// ---------------------------------------------------------------- extras

test('createDraft appends a DRAFT entry and eagerly scaffolds its task file', async () => {
  const ctx = await mount();
  // media/board.js: post({ type: 'createDraft', text, groomer, model })
  await ctx.send({ type: 'createDraft', text: 'the  cursor   API   is  flaky', groomer: 'none', model: 'sonnet' });

  const drafts = ctx.board().phases.new.filter((t) => t.isDraft);
  assert.equal(drafts.length, 2);
  const draft = drafts.at(-1);
  assert.equal(draft.title, 'DRAFT: the cursor API is flaky', 'whitespace collapsed');
  assert.equal(draft.groomer, 'none', 'the on-hold sentinel round-trips');
  assert.equal(draft.model, 'sonnet');
  assert.equal(draft.hasDetailFile, true, 'tasks/<id>.md is eager-scaffolded (t-6ab4)');

  const detail = fs.readFileSync(path.join(ctx.dir, '.loopboard', 'tasks', `${draft.id}.md`), 'utf8');
  assert.match(detail, /^# DRAFT: the cursor API is flaky \(t-[a-z0-9]{4}\)$/m);
  assert.match(detail, /- added: \d{4}-\d{2}-\d{2}/);
  assert.match(ctx.toasts().at(-1).text, /Draft saved/);
});

test('delete is guarded by a native modal and removes both the entry and its task file', async () => {
  const ctx = await mount();
  await ctx.send({ type: 'gate', taskId: 't-cc01', action: 'delete' });
  assert.match(fake.recorded.messages.at(-1).message, /Delete .*retry logic/);
  assert.ok(ctx.read('TODO.md').includes('t-cc01'), 'a dismissed modal deletes nothing');

  fake.answerWith('Delete');
  await ctx.send({ type: 'gate', taskId: 't-cc01', action: 'delete' });
  assert.ok(!ctx.read('TODO.md').includes('t-cc01'));
  assert.equal(fs.existsSync(path.join(ctx.dir, '.loopboard', 'tasks', 't-cc01.md')), false);
});

test('openLink routes a staged attachment through vscode.open and a URL through the OS handler', async () => {
  const ctx = await mount();
  await ctx.send({ type: 'openLink', url: '.loopboard/cache/t-cc01/shot.png' });
  assert.equal(fake.recorded.commands.at(-1).command, 'vscode.open');
  assert.equal(fake.recorded.commands.at(-1).args[0].fsPath, path.join(ctx.dir, '.loopboard/cache/t-cc01/shot.png'));
  assert.deepEqual(fake.recorded.external, []);

  await ctx.send({ type: 'openLink', url: 'https://example.com/pr/141' });
  assert.deepEqual(fake.recorded.external, ['https://example.com/pr/141']);
});

test('loop-lifecycle messages reach the terminal manager only for known model ids', async () => {
  const ctx = await mount();
  await ctx.send({ type: 'spawnLoop', model: 'opus' });
  await ctx.send({ type: 'recycleLoop', model: 'sonnet' });
  await ctx.send({ type: 'stopLoop', model: 'fable' });
  await ctx.send({ type: 'spawnLoop', model: 'rm -rf /' });
  assert.deepEqual(ctx.terminals.calls.filter((c) => c.call !== 'nudge'), [
    { call: 'spawn', model: 'opus' },
    { call: 'recycle', model: 'sonnet' },
    { call: 'stop', model: 'fable' },
  ]);
});

test('armRestart validates minutes host-side and refuses a non-integer delay', async () => {
  const ctx = await mount();
  // media/sidebar.js posts `minutes` as a string.
  await ctx.send({ type: 'armRestart', model: 'opus', action: 'restart', minutes: '90m', repeat: false, force: false });
  assert.equal(ctx.toasts().at(-1).text, 'Schedule delay must be a whole number of minutes.');

  await ctx.send({ type: 'armRestart', model: 'opus', action: 'restart', minutes: '15', repeat: true, force: false });
  assert.equal(ctx.toasts().at(-1).text, 'Restarting opus every 15m.');
  const loop = ctx.board().loops.find((l) => l.id === 'opus');
  assert.equal(loop.restart.action, 'restart');
  assert.equal(loop.restart.minutes, 15);
  assert.equal(loop.restart.repeat, true);

  await ctx.send({ type: 'clearRestart', model: 'opus' });
  assert.equal(ctx.board().loops.find((l) => l.id === 'opus').restart, null);
  ctx.controller.dispose();
});

test('an empty workspace reports todoMissing and createFiles scaffolds .loopboard/', async () => {
  fake.reset();
  BoardPanel.current?.dispose();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopboard-init-'));
  mounted.push(dir);
  const store = new Store({ uri: vscode.Uri.file(dir), name: 'empty-ws', index: 0 }, () => 'off');
  const controller = new Controller(vscode.Uri.file(root), store, fakeTerminals(), fakeSidebar(), fake.createMemento());
  controller.openBoard();
  const panel = fake.lastPanel();
  await panel.htmlReady();
  await panel.webview.fire({ type: 'ready' });

  const board = () => [...panel.webview.posted].reverse().find((x) => x.type === 'board').board;
  assert.equal(board().todoMissing, true);

  // media/board.js empty state: post({ type: 'createFiles' })
  await panel.webview.fire({ type: 'createFiles' });
  assert.equal(fs.existsSync(path.join(dir, '.loopboard', 'TODO.md')), true);
  assert.equal(fs.existsSync(path.join(dir, '.loopboard', 'LOOP.md')), true);
  assert.equal(fs.existsSync(path.join(dir, '.loopboard', 'tasks')), true);
  assert.equal(fs.existsSync(path.join(dir, '.loopboard', 'DONE.md')), false, 'DONE.md stays lazy');
  assert.equal(board().todoMissing, false);
  assert.equal(fake.recorded.messages.at(-1).message, 'LoopBoard: initialized .loopboard/ (TODO.md, LOOP.md, tasks/).');
  controller.dispose();
});
