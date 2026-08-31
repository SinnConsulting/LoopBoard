'use strict';
// Marker-based LOOP.md section sync + TODO.md preamble sync (src/sync.ts).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { markedSectionIds, hasMarkers, syncMarkedSections, syncTodoPreamble, isEmptyOrMissing } = require('../out-test/sync.js');

test('markedSectionIds finds every begin marker in document order', () => {
  const text = [
    '<!-- loopboard:sync:a:begin -->',
    'A content',
    '<!-- loopboard:sync:a:end -->',
    '<!-- loopboard:sync:b:begin -->',
    'B content',
    '<!-- loopboard:sync:b:end -->',
  ].join('\n');
  assert.deepEqual(markedSectionIds(text), ['a', 'b']);
});

test('hasMarkers is false for plain text', () => {
  assert.equal(hasMarkers('# Just prose\nNo markers here.'), false);
});

test('syncMarkedSections replaces only sections whose content changed', () => {
  const current = [
    '<!-- loopboard:sync:a:begin -->',
    'old A',
    '<!-- loopboard:sync:a:end -->',
    '<!-- loopboard:sync:b:begin -->',
    'same B',
    '<!-- loopboard:sync:b:end -->',
  ].join('\n');
  const template = [
    '<!-- loopboard:sync:a:begin -->',
    'new A',
    '<!-- loopboard:sync:a:end -->',
    '<!-- loopboard:sync:b:begin -->',
    'same B',
    '<!-- loopboard:sync:b:end -->',
  ].join('\n');
  const { text, changedIds } = syncMarkedSections(current, template);
  assert.deepEqual(changedIds, ['a']);
  assert.match(text, /new A/);
  assert.match(text, /same B/);
  assert.doesNotMatch(text, /old A/);
});

test('syncMarkedSections preserves user content outside the markers', () => {
  const current = [
    '# My custom LOOP.md',
    'Some hand-written prose I added.',
    '<!-- loopboard:sync:a:begin -->',
    'old A',
    '<!-- loopboard:sync:a:end -->',
    'More hand-written prose after the section.',
  ].join('\n');
  const template = ['<!-- loopboard:sync:a:begin -->', 'new A', '<!-- loopboard:sync:a:end -->'].join('\n');
  const { text, changedIds } = syncMarkedSections(current, template);
  assert.deepEqual(changedIds, ['a']);
  assert.match(text, /Some hand-written prose I added\./);
  assert.match(text, /More hand-written prose after the section\./);
  assert.match(text, /new A/);
});

test('syncMarkedSections leaves a hand-owned loopboard:custom block byte-identical (t-4a04)', () => {
  const customBlock = [
    '<!-- loopboard:custom:begin -->',
    '## Custom rules (workspace)',
    '',
    'Standing instructions for THIS workspace — free text, edited here.',
    '',
    '1. PRs must be created before moving to in review. Otherwise task not done.',
    '<!-- loopboard:custom:end -->',
  ].join('\n');
  const current = [
    '<!-- loopboard:sync:a:begin -->',
    'old A',
    '<!-- loopboard:sync:a:end -->',
    '',
    customBlock,
  ].join('\n');
  const template = ['<!-- loopboard:sync:a:begin -->', 'new A', '<!-- loopboard:sync:a:end -->'].join('\n');
  const { text, changedIds } = syncMarkedSections(current, template);
  assert.deepEqual(changedIds, ['a']);
  assert.ok(text.includes(customBlock), 'custom block survives Sync byte-identical');
});

test('syncMarkedSections inserts a template id the current (already-marked) file lacks, next to its nearest neighbor', () => {
  const current = ['<!-- loopboard:sync:a:begin -->', 'old A', '<!-- loopboard:sync:a:end -->'].join('\n');
  const template = [
    '<!-- loopboard:sync:a:begin -->', 'new A', '<!-- loopboard:sync:a:end -->',
    '<!-- loopboard:sync:b:begin -->', 'new B', '<!-- loopboard:sync:b:end -->',
  ].join('\n');
  const { text, changedIds } = syncMarkedSections(current, template);
  assert.deepEqual(changedIds, ['a', 'b']);
  assert.match(text, /new A/);
  assert.match(text, /new B/);
  const aIdx = text.indexOf('new A');
  const bIdx = text.indexOf('new B');
  assert.ok(aIdx < bIdx, 'b (later in template order) should land after a');
});

test('syncMarkedSections inserts a leading template id before its first-present neighbor', () => {
  const current = ['<!-- loopboard:sync:b:begin -->', 'same B', '<!-- loopboard:sync:b:end -->'].join('\n');
  const template = [
    '<!-- loopboard:sync:a:begin -->', 'new A', '<!-- loopboard:sync:a:end -->',
    '<!-- loopboard:sync:b:begin -->', 'same B', '<!-- loopboard:sync:b:end -->',
  ].join('\n');
  const { text, changedIds } = syncMarkedSections(current, template);
  assert.deepEqual(changedIds, ['a']);
  const aIdx = text.indexOf('new A');
  const bIdx = text.indexOf('same B');
  assert.ok(aIdx < bIdx, 'a (earlier in template order) should land before b');
});

test('syncMarkedSections leaves a file with no markers at all untouched (route via hasMarkers instead)', () => {
  const current = 'Plain prose, no markers here.';
  const template = ['<!-- loopboard:sync:a:begin -->', 'new A', '<!-- loopboard:sync:a:end -->'].join('\n');
  const { text, changedIds } = syncMarkedSections(current, template);
  assert.deepEqual(changedIds, []);
  assert.equal(text, current);
});

test('syncMarkedSections wraps a newly-introduced id whose prose already exists unfenced, instead of duplicating it', () => {
  const current = [
    '# Intro title',
    'Some intro prose that predates the marker.',
    '',
    '<!-- loopboard:sync:a:begin -->',
    'same A',
    '<!-- loopboard:sync:a:end -->',
  ].join('\n');
  const template = [
    '<!-- loopboard:sync:intro:begin -->',
    '# Intro title',
    'Some intro prose that predates the marker.',
    '<!-- loopboard:sync:intro:end -->',
    '',
    '<!-- loopboard:sync:a:begin -->',
    'same A',
    '<!-- loopboard:sync:a:end -->',
  ].join('\n');
  const { text, changedIds } = syncMarkedSections(current, template);
  assert.deepEqual(changedIds, ['intro']);
  const occurrences = text.split('Some intro prose that predates the marker.').length - 1;
  assert.equal(occurrences, 1, 'the prose must appear exactly once, not duplicated');
  assert.match(text, /<!-- loopboard:sync:intro:begin -->/);
  assert.match(text, /<!-- loopboard:sync:intro:end -->/);
});

test('syncTodoPreamble (legacy, no marker) replaces an out-of-date intro but keeps every task entry', () => {
  const current = [
    '# TODO',
    '',
    'Old stale intro line.',
    '',
    '## Tasks',
    '',
    '- [ ] Keep me',
    '  - id: t-aaaa',
    '  - phase: new',
    '',
  ].join('\n');
  const template = ['# TODO', '', 'New intro line.', '', '## Tasks', '', '_(none)_', ''].join('\n');
  const { text, changed, legacy } = syncTodoPreamble(current, template);
  assert.equal(changed, true);
  assert.equal(legacy, true);
  assert.match(text, /New intro line\./);
  assert.doesNotMatch(text, /Old stale intro line\./);
  assert.match(text, /Keep me/);
  assert.match(text, /id: t-aaaa/);
});

test('syncTodoPreamble reports unchanged when the intro already matches', () => {
  const same = ['# TODO', '', 'Matching intro.', '', '## Tasks', '', '_(none)_', ''].join('\n');
  const { changed, legacy } = syncTodoPreamble(same, same);
  assert.equal(changed, false);
  assert.equal(legacy, false);
});

test('isEmptyOrMissing is true for undefined (file does not exist)', () => {
  assert.equal(isEmptyOrMissing(undefined), true);
});

test('isEmptyOrMissing is true for an empty string and whitespace-only text', () => {
  assert.equal(isEmptyOrMissing(''), true);
  assert.equal(isEmptyOrMissing('   \n\t  \n'), true);
});

test('isEmptyOrMissing is false for any non-blank text', () => {
  assert.equal(isEmptyOrMissing('# LOOP'), false);
  assert.equal(isEmptyOrMissing(' x '), false);
});

test('syncTodoPreamble treats missing/empty TODO.md the same as legacy — recreates the full scaffold, no entries to keep', () => {
  const template = ['# TODO', '', 'New intro line.', '', '## Tasks', '', '_(none)_', ''].join('\n');
  for (const current of ['', '   \n  ']) {
    const { text, changed, legacy } = syncTodoPreamble(current, template);
    assert.equal(changed, true);
    assert.equal(legacy, true);
    assert.match(text, /New intro line\./);
    assert.match(text, /## Tasks/);
  }
});

test('syncTodoPreamble (marked) is surgical and preserves prose outside the marker', () => {
  const current = [
    '<!-- loopboard:sync:todo-intro:begin -->',
    '# TODO',
    '',
    'Old stale intro line.',
    '<!-- loopboard:sync:todo-intro:end -->',
    '',
    'A hand-written note the user added below the marker.',
    '',
    '## Tasks',
    '',
    '- [ ] Keep me',
    '  - id: t-aaaa',
    '  - phase: new',
    '',
  ].join('\n');
  const template = [
    '<!-- loopboard:sync:todo-intro:begin -->',
    '# TODO',
    '',
    'New intro line.',
    '<!-- loopboard:sync:todo-intro:end -->',
    '',
    '## Tasks',
    '',
    '_(none)_',
    '',
  ].join('\n');
  const { text, changed, legacy } = syncTodoPreamble(current, template);
  assert.equal(changed, true);
  assert.equal(legacy, false);
  assert.match(text, /New intro line\./);
  assert.doesNotMatch(text, /Old stale intro line\./);
  assert.match(text, /A hand-written note the user added below the marker\./);
  assert.match(text, /Keep me/);
});
