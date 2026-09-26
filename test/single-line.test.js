'use strict';
// The single-line rule (t-c4d1). Every index value is ONE line (grammar v5): the host helper
// `canonicalLine` (src/merge.ts) folds a value on its way to disk, and the board's `canonAnswer`
// (media/board.js) is the same fold, so what the board holds and echoes equals what disk holds.
// `canonAnswer` is lifted out of the SOURCE TEXT into a bare vm (the test/question-status.test.js
// technique); the store's debug line is pinned as source text, since store.ts imports vscode.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { canonicalLine, applyPatch } = require('../out-test/merge.js');
const { parseTodo } = require('../out-test/parser.js');
const { serializeTodo } = require('../out-test/writer.js');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const board = read('media', 'board.js');
const store = read('src', 'store.ts');
const merge = read('src', 'merge.ts');

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'must define ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}

const canonAnswer = vm.runInNewContext('(' + extractFunction(board, 'canonAnswer') + ')');

// [input, canonical] — scenario F1's table.
const F1 = [
  ['a\n', 'a'],
  ['a\nb', 'a b'],
  ['a\r\nb', 'a b'],
  ['a\rb', 'a b'],
  ['  a  ', 'a'],
  ['\ta\t', 'a'],
  ['a\tb', 'a\tb'],
  ['a\n\n  b', 'a b'],
  ['   ', ''],
  ['', ''],
  ['yes accepted', 'yes accepted'],
  ['[img.png](.loopboard/cache/t-1/img.png)\nnote', '[img.png](.loopboard/cache/t-1/img.png) note'],
];

test('[F1] canonAnswer (lifted from media/board.js into a vm) folds line breaks and trims', () => {
  for (const [input, want] of F1) assert.equal(canonAnswer(input), want, JSON.stringify(input));
});

test('[F2] canonAnswer equals the host canonicalLine, and its output survives write→parse unchanged', () => {
  for (const [input] of F1) {
    const out = canonAnswer(input);
    assert.equal(out, canonicalLine(input), JSON.stringify(input));
    const doc = parseTodo('## Tasks\n\n- [ ] T\n  - id: t-1\n  - phase: feedback\n  - question: Q?\n    - answer:\n');
    doc.entries[0].questions[0].answer = out;
    const back = parseTodo(serializeTodo(doc));
    assert.equal(back.entries[0].questions[0].answer, out, JSON.stringify(input));
  }
});

test('[A14] a canonicalised patch value is logged at verbose through the store; a canonical one is not', () => {
  // merge reports the fold as data (it stays logger-free) ...
  const doc = () => parseTodo('## Tasks\n\n- [ ] T\n  - id: t-1\n  - phase: new\n');
  const folded = applyPatch(doc(), { taskId: 't-1', field: 'title', value: 'a\nb', base: 'T' });
  assert.deepEqual({ ...folded.canonicalized }, { raw: 'a\nb', stored: 'a b' });
  const canonical = applyPatch(doc(), { taskId: 't-1', field: 'title', value: 'a b', base: 'T' });
  assert.equal(canonical.canonicalized, undefined, 'an already-canonical value reports nothing');
  const fb = applyPatch(doc(), { taskId: 't-1', field: 'feedbackAdd', value: 'x\ny', base: '' });
  assert.deepEqual({ ...fb.canonicalized }, { raw: 'x\ny', stored: 'x y' });
  assert.equal(applyPatch(doc(), { taskId: 't-1', field: 'feedbackAdd', value: 'xy', base: '' }).canonicalized, undefined);
  // ... and the store logs it, only when it is set: task id, field, raw → stored.
  const at = store.indexOf('if (result.canonicalized) {');
  assert.ok(at > 0, 'the store logs only when merge canonicalised the value');
  const line = store.slice(at, store.indexOf('\n', store.indexOf('debugLog', at)));
  assert.match(line, /this\.debugLog\('verbose', 'canonicalize', `\$\{patch\.taskId\} \$\{fb \?\? patch\.field\} -> \$\{JSON\.stringify\(result\.canonicalized\.raw\)\} → \$\{JSON\.stringify\(result\.canonicalized\.stored\)\}`\);/);
  assert.equal(store.split("'canonicalize'").length - 1, 1, 'one canonicalize line, in applyFieldPatch');
});

test('[A15] src/merge.ts imports only ./model and exports the helper', () => {
  const imports = merge.split('\n').filter((l) => /^\s*import\b/.test(l) || /\brequire\(/.test(l));
  assert.deepEqual(imports.map((l) => l.match(/from '([^']+)'/)[1]), ['./model']);
  assert.match(merge, /^export function canonicalLine\(value: string\): string \{$/m);
  assert.doesNotMatch(merge, /debugLog|console\./, 'merge stays logger-free');
});
