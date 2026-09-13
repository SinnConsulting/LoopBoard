/* Board payloads for the webview suite, built by the SAME code path the extension host uses.
 *
 * Nothing here hand-writes JSON: test/fixtures/*.md is parsed with the shipped parser, composed
 * into a Board exactly as store.ts's `compose` does, and handed to view.ts's `toWebviewBoard` —
 * then decorated with the fields controller.ts's `buildWebBoard` adds (todoMissing, helpUrl,
 * maxAttachmentSizeMB, templatesOutOfDate, and each loop row's restart/context). If the payload
 * shape changes, these fixtures change with it and the DOM assertions move in lockstep.
 *
 * Reads out-test/ (built by `make test`, which `make e2e` depends on) rather than out/, because
 * out/ modules pull in `vscode`.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');
const OUT = path.join(ROOT, 'out-test');

const { parseTodo, parseDone } = require(path.join(OUT, 'parser.js'));
const { parseTaskFile } = require(path.join(OUT, 'taskfile.js'));
const { toWebviewBoard } = require(path.join(OUT, 'view.js'));

const MODELS = ['opus', 'sonnet', 'fable'];

function emptyDetail() {
  return { worklog: [], links: [], dependsOn: [], unknownLines: [], raw: '' };
}

// store.ts's compose(): index entry + (possibly empty) task file, index fields winning.
function compose(entry, detail, hasDetailFile) {
  return {
    ...detail,
    ...entry,
    completed: detail.completed,
    unknownLines: [...entry.unknownLines, ...detail.unknownLines],
    raw: entry.raw,
    hasDetailFile,
  };
}

// The one task file the fixture set ships; every other entry composes against an empty detail,
// which is exactly what store.load() does for a missing tasks/<id>.md.
const DETAILS = { 't-cc01': path.join(FIXTURES, 'taskfile-full.md') };

function loadBoard(indexFixture, doneText) {
  // `null` = no tracker at all, which is what the init empty state renders against.
  const doc = parseTodo(indexFixture === null ? '' : fs.readFileSync(path.join(FIXTURES, indexFixture), 'utf8'));
  const tasks = doc.entries.map((entry) => {
    const file = DETAILS[entry.id];
    const has = !!file && fs.existsSync(file);
    return compose(entry, has ? parseTaskFile(fs.readFileSync(file, 'utf8')) : emptyDetail(), has);
  });
  const done = parseDone(doneText || '').map((entry) => ({ ...entry, description: undefined, delivered: undefined }));
  return { preamble: doc.preamble, tasks, done };
}

// LoopStatus rows as terminals.status() produces them, decorated the way buildWebBoard does.
function loops(overrides) {
  const base = [
    { id: 'fable', name: 'Fable', running: false, hint: '', restart: null, context: null },
    { id: 'opus', name: 'Opus', running: false, hint: '', restart: null, context: null },
    { id: 'sonnet', name: 'Sonnet', running: false, hint: '', restart: null, context: null },
  ];
  return base.map((l) => Object.assign(l, (overrides || {})[l.id] || {}));
}

/* A full board payload. `options`:
 *   index       — fixture filename (default index-full.md; null for no tracker)
 *   done        — raw DONE.md text
 *   loops       — per-model LoopStatus overrides
 *   todoMissing — render the init empty state instead of a board
 */
function board(options) {
  const opts = options || {};
  const index = 'index' in opts ? opts.index : opts.todoMissing ? null : 'index-full.md';
  const b = loadBoard(index, opts.done);
  const web = toWebviewBoard(b, 'loopboard', 'opus', loops(opts.loops), MODELS, 'opus');
  web.todoMissing = !!opts.todoMissing;
  web.helpUrl = 'https://github.com/SinnConsulting/LoopBoard#get-started';
  web.maxAttachmentSizeMB = 10;
  web.templatesOutOfDate = !!opts.templatesOutOfDate;
  return web;
}

// The message BoardPanel.post()/SidebarProvider.post() send for a repaint.
function boardMessage(options) {
  return { type: 'board', board: board(options) };
}

module.exports = { board, boardMessage, MODELS };
