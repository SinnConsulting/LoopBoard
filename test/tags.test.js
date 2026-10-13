'use strict';
// Story tags (t-0b10): the name rule and the `.loopboard/tags.md` registry (pure, src/tags.ts).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeTag, normalizeTags, parseRegistry, serializeRegistry, registryEntries, registryUnparsedCount,
  setTagColor, applyTagColor, tagColorOf, tagColorToast,
} = require('../out-test/tags.js');

test('normalizeTags trims, lower-cases, joins inner whitespace with -, de-duplicates and drops empties', () => {
  assert.equal(normalizeTag('  Bug  '), 'bug');
  assert.equal(normalizeTag('Two   Words'), 'two-words');
  assert.equal(normalizeTag('a,b'), 'a-b', 'a comma cannot be part of a name');
  assert.equal(normalizeTag('a:b'), 'a-b', 'a colon cannot be part of a name');
  assert.deepEqual(normalizeTags([' Bug', 'bug', '', '   ', 'UI', 'Two Words', 'two-words']), ['bug', 'ui', 'two-words']);
  assert.deepEqual(normalizeTags([]), []);
});

const REG = '# Tags\n\n- bug: red\n- feature: blue\n- docs\n';

test('the registry parses `- name: color` and `- name` lines', () => {
  assert.deepEqual(registryEntries(parseRegistry(REG)), [
    { name: 'bug', color: 'red' },
    { name: 'feature', color: 'blue' },
    { name: 'docs' },
  ]);
});

test('unknown lines and unknown colors are kept verbatim, and empty text is an empty registry', () => {
  const text = '# Tags\n\nsome note\n- bug: pink\n- ui: purple\n- weird: red extra\n';
  const reg = parseRegistry(text);
  assert.deepEqual(registryEntries(reg), [{ name: 'bug' }, { name: 'ui', color: 'purple' }], 'pink reads as no color');
  assert.equal(registryUnparsedCount(reg), 2);
  assert.equal(serializeRegistry(reg), text, 'every line survives');
  assert.deepEqual(registryEntries(parseRegistry('')), []);
  assert.equal(serializeRegistry(parseRegistry('')), '');
});

test('parse -> write is a text fixpoint', () => {
  for (const text of [REG, '', '\n', '# Tags\n- a\n\n\n', '- a: red\r\n- b\r\n']) {
    const once = serializeRegistry(parseRegistry(text));
    assert.equal(serializeRegistry(parseRegistry(once)), once);
  }
  assert.equal(serializeRegistry(parseRegistry(REG)), REG);
});

test('setting one tag color changes or appends only that tag line', () => {
  const reg = parseRegistry(REG);
  assert.equal(serializeRegistry(setTagColor(reg, 'bug', 'green')), '# Tags\n\n- bug: green\n- feature: blue\n- docs\n');
  assert.equal(serializeRegistry(setTagColor(reg, 'docs', 'orange')), '# Tags\n\n- bug: red\n- feature: blue\n- docs: orange\n');
  assert.equal(serializeRegistry(setTagColor(reg, 'bug', '')), '# Tags\n\n- bug\n- feature: blue\n- docs\n', 'none drops the color');
  assert.equal(serializeRegistry(setTagColor(reg, 'New Tag', 'purple')), REG + '- new-tag: purple\n');
  assert.equal(serializeRegistry(reg), REG, 'the input registry is not mutated');
  assert.equal(serializeRegistry(setTagColor(parseRegistry(''), 'bug', 'red')), '# Tags\n\n- bug: red\n', 'a missing file is created with its heading');
  assert.equal(tagColorOf(reg, 'Bug'), 'red');
  assert.equal(tagColorOf(reg, 'docs'), '');
});

test('a color patch is a same-field conflict when disk changed that tag line, disk wins', () => {
  const reg = parseRegistry(REG);
  const ok = applyTagColor(reg, 'bug', 'green', 'red');
  assert.equal(ok.status, 'applied');
  assert.equal(ok.before, 'red');
  assert.equal(tagColorOf(ok.registry, 'bug'), 'green');
  const stale = applyTagColor(reg, 'bug', 'green', 'blue');
  assert.equal(stale.status, 'conflict');
  assert.equal(serializeRegistry(stale.registry), REG, 'nothing applied');
  assert.equal(applyTagColor(reg, 'bug', 'red', 'blue').status, 'applied', 'already the requested color is no conflict');
  assert.equal(applyTagColor(reg, 'bug', 'pink', 'red').status, 'unsupported');
  assert.ok(tagColorToast('conflict') && tagColorToast('unsupported'));
  assert.equal(tagColorToast('applied'), undefined);
});

test('the store reads and writes tags.md only through the registry module, with its debug events', () => {
  const store = fs.readFileSync(path.join(process.cwd(), 'src', 'store.ts'), 'utf8');
  assert.match(store, /this\.tagsUri = vscode\.Uri\.joinPath\(this\.loopboardUri, 'tags\.md'\)/);
  assert.match(store, /this\.debugLog\('verbose', 'tags-read',/);
  assert.match(store, /this\.debugLog\('verbose', 'tags-color',/);
  assert.match(store, /this\.debugLog\('info', result\.status,/, 'a conflict/unsupported colour patch is logged at info');
  assert.match(store, /await this\.atomicWrite\(this\.tagsUri, serializeRegistry\(result\.registry\)\)/);
});
