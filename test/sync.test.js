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

// ---- activation auto-sync (t-4dce): pure plan, decision, popup ----

const fs = require('node:fs');
const path = require('node:path');
const { planSync, decideAutoSync, autoSyncPopup, describeSyncChanges, LOOP_BACKUP_PATH } = require('../out-test/sync.js');

const TODO_TPL = fs.readFileSync(path.join(__dirname, '..', 'media', 'template-todo.md'), 'utf8');
const LOOP_TPL = fs.readFileSync(path.join(__dirname, '..', 'media', 'template-loop.md'), 'utf8');

const ENTRIES = ['- [ ] Keep me', '  - id: t-aaaa', '  - phase: new', '', '- [x] Me too', '  - id: t-bbbb', '  - phase: backlog', ''].join('\n');
const withEntries = (todo) => todo.replace('_(none)_\n', ENTRIES);
const CUSTOM_RULES = [
  '<!-- loopboard:custom:begin -->',
  '## Custom rules (workspace)',
  '',
  '1. PRs must be created before moving to in review. Otherwise task not done.',
  '<!-- loopboard:custom:end -->',
].join('\n');
const withCustom = (loop) => loop.replace(/<!-- loopboard:custom:begin -->[\s\S]*<!-- loopboard:custom:end -->/, CUSTOM_RULES);
// Stale the prose inside one marked block of `text`, leaving its markers in place.
const staleBlock = (text, id) =>
  text.replace(new RegExp(`(<!-- loopboard:sync:${id}:begin -->\\n)`), '$1Stale line from an older build.\n');

// Apply a plan's writes the way store.syncTemplates does and return the resulting files.
function applyPlan(todo, loop, plan) {
  return {
    todo: plan.writes.todo ?? todo,
    loop: plan.writes.loop ?? loop,
    backup: plan.writes.loopBackup,
  };
}

const TODO_CUR = withEntries(TODO_TPL);
const LOOP_CUR = withCustom(LOOP_TPL);

test('planSync: files that already match the templates are up to date and write nothing', () => {
  const plan = planSync(TODO_CUR, LOOP_CUR, TODO_TPL, LOOP_TPL);
  assert.equal(plan.upToDate, true);
  assert.equal(plan.todo, 'none');
  assert.equal(plan.loop, 'none');
  assert.deepEqual(plan.summary, []);
  assert.deepEqual(plan.writes, {});
});

test('planSync: a missing or empty file is created whole from its template', () => {
  for (const absent of [undefined, '', '  \n']) {
    const plan = planSync(absent, absent, TODO_TPL, LOOP_TPL);
    assert.equal(plan.todo, 'create');
    assert.equal(plan.loop, 'create');
    assert.equal(plan.writes.todo, TODO_TPL);
    assert.equal(plan.writes.loop, LOOP_TPL);
    assert.equal(plan.writes.loopBackup, undefined, 'nothing to back up');
    assert.equal(plan.summary.length, 2);
  }
});

test('planSync: marked LOOP.md drift updates only the drifted blocks, no backup', () => {
  const loop = staleBlock(staleBlock(LOOP_CUR, 'rules'), 'automation');
  const plan = planSync(TODO_CUR, loop, TODO_TPL, LOOP_TPL);
  assert.equal(plan.todo, 'none');
  assert.equal(plan.loop, 'sections');
  assert.deepEqual(plan.loopSectionIds, ['rules', 'automation']);
  assert.equal(plan.writes.loopBackup, undefined);
  assert.deepEqual(plan.summary, ['LOOP.md: 2 section(s) out of date (rules, automation).']);
});

test('planSync: marked TODO.md intro drift is an intro update', () => {
  const plan = planSync(staleBlock(TODO_CUR, 'todo-intro'), LOOP_CUR, TODO_TPL, LOOP_TPL);
  assert.equal(plan.todo, 'intro');
  assert.equal(plan.loop, 'none');
  assert.deepEqual(plan.summary, ['TODO.md: intro out of date.']);
});

test('planSync: an unmarked TODO.md preamble is a legacy replacement', () => {
  const legacy = ['# TODO', '', 'Old intro from before markers.', '', '## Tasks', '', ENTRIES].join('\n');
  const plan = planSync(legacy, LOOP_CUR, TODO_TPL, LOOP_TPL);
  assert.equal(plan.todo, 'legacy');
  assert.match(plan.writes.todo, /loopboard:sync:todo-intro:begin/);
  assert.doesNotMatch(plan.writes.todo, /Old intro from before markers\./);
  assert.ok(plan.writes.todo.includes(ENTRIES), 'every task entry survives the legacy preamble replacement');
});

test('planSync: an unmarked LOOP.md is a legacy full replacement, backed up first', () => {
  const legacy = '# LOOP\n\nHand-written rules from before markers.\n';
  const plan = planSync(TODO_CUR, legacy, TODO_TPL, LOOP_TPL);
  assert.equal(plan.loop, 'legacy');
  assert.equal(plan.writes.loopBackup, legacy, 'the previous LOOP.md is what the backup holds');
  assert.equal(plan.writes.loop, LOOP_TPL);
  assert.match(plan.summary[0], /LOOP\.md\.bkp/);
});

test('decideAutoSync: none when the setting is off or nothing drifted; apply for marked AND legacy drift', () => {
  const upToDate = planSync(TODO_CUR, LOOP_CUR, TODO_TPL, LOOP_TPL);
  const marked = planSync(TODO_CUR, staleBlock(LOOP_CUR, 'rules'), TODO_TPL, LOOP_TPL);
  const legacyLoop = planSync(TODO_CUR, '# old LOOP\n', TODO_TPL, LOOP_TPL);
  const legacyTodo = planSync('# TODO\n\nold\n\n## Tasks\n\n' + ENTRIES, LOOP_CUR, TODO_TPL, LOOP_TPL);
  assert.equal(decideAutoSync(upToDate, true), 'none');
  assert.equal(decideAutoSync(upToDate, false), 'none');
  for (const plan of [marked, legacyLoop, legacyTodo]) {
    assert.equal(decideAutoSync(plan, true), 'apply');
    assert.equal(decideAutoSync(plan, false), 'none', 'setting off: activation never writes template content');
  }
});

test('autoSyncPopup: nothing for an up-to-date plan', () => {
  assert.equal(autoSyncPopup(planSync(TODO_CUR, LOOP_CUR, TODO_TPL, LOOP_TPL)), undefined);
});

test('autoSyncPopup: marked-section updates and created files are an info naming each change', () => {
  const sections = autoSyncPopup(planSync(TODO_CUR, staleBlock(staleBlock(LOOP_CUR, 'rules'), 'automation'), TODO_TPL, LOOP_TPL));
  assert.deepEqual(sections, { level: 'info', message: 'LoopBoard: synced templates — LOOP.md: 2 section(s) updated (rules, automation).' });
  const both = autoSyncPopup(planSync(staleBlock(TODO_CUR, 'todo-intro'), undefined, TODO_TPL, LOOP_TPL));
  assert.equal(both.level, 'info');
  assert.match(both.message, /TODO\.md: intro updated/);
  assert.match(both.message, /LOOP\.md created from the template/);
});

test('autoSyncPopup: a legacy LOOP.md is a warning that says it was replaced and names LOOP.md.bkp', () => {
  const popup = autoSyncPopup(planSync(staleBlock(TODO_CUR, 'todo-intro'), '# old LOOP\n', TODO_TPL, LOOP_TPL));
  assert.equal(popup.level, 'warning');
  assert.match(popup.message, /LOOP\.md predated the marker format and was replaced/);
  assert.ok(popup.message.includes(LOOP_BACKUP_PATH), 'names the backup path');
  assert.equal(LOOP_BACKUP_PATH, '.loopboard/LOOP.md.bkp');
  assert.match(popup.message, /Also synced: TODO\.md: intro updated\./, 'routine changes riding along are still named');
});

test('autoSyncPopup: a legacy TODO.md is a warning that the intro was replaced with task entries untouched', () => {
  const popup = autoSyncPopup(planSync('# TODO\n\nold\n\n## Tasks\n\n' + ENTRIES, LOOP_CUR, TODO_TPL, LOOP_TPL));
  assert.equal(popup.level, 'warning');
  assert.match(popup.message, /TODO\.md's intro predated the marker format and was replaced \(task entries untouched\)\./);
});

test('describeSyncChanges: the debug reason spells out legacy replacements with the backup path', () => {
  const plan = planSync('# TODO\n\nold\n\n## Tasks\n\n' + ENTRIES, '# old LOOP\n', TODO_TPL, LOOP_TPL);
  assert.equal(describeSyncChanges(plan), 'LEGACY: LOOP.md replaced whole, backup .loopboard/LOOP.md.bkp; LEGACY: TODO.md preamble replaced whole');
  const marked = planSync(TODO_CUR, staleBlock(LOOP_CUR, 'rules'), TODO_TPL, LOOP_TPL);
  assert.equal(describeSyncChanges(marked), 'LOOP.md: 1 section(s) updated (rules)');
});

test('fixpoint: re-planning after applying any plan is up to date, so the next activation is a no-op', () => {
  const cases = {
    missing: [undefined, undefined],
    empty: ['', '  \n'],
    marked: [staleBlock(TODO_CUR, 'todo-intro'), staleBlock(staleBlock(LOOP_CUR, 'rules'), 'loop-intro')],
    legacy: ['# TODO\n\nold\n\n## Tasks\n\n' + ENTRIES, '# old LOOP\n\nhand text\n'],
  };
  for (const [name, [todo, loop]] of Object.entries(cases)) {
    const plan = planSync(todo, loop, TODO_TPL, LOOP_TPL);
    assert.equal(plan.upToDate, false, `${name}: starts out of date`);
    const after = applyPlan(todo, loop, plan);
    const again = planSync(after.todo, after.loop, TODO_TPL, LOOP_TPL);
    assert.equal(again.upToDate, true, `${name}: ${again.summary.join(' | ')}`);
    assert.deepEqual(again.writes, {}, `${name}: nothing left to write`);
  }
});

test('auto-sync on the marked path leaves the loopboard:custom block and every task entry byte-identical (t-4a04)', () => {
  const todo = staleBlock(TODO_CUR, 'todo-intro');
  const loop = staleBlock(staleBlock(LOOP_CUR, 'rules'), 'automation');
  const plan = planSync(todo, loop, TODO_TPL, LOOP_TPL);
  assert.equal(decideAutoSync(plan, true), 'apply');
  const after = applyPlan(todo, loop, plan);
  assert.ok(after.loop.includes(CUSTOM_RULES), 'custom block survives auto-sync byte-identical');
  assert.equal(after.loop.split(CUSTOM_RULES).length - 1, 1, 'custom block appears exactly once');
  assert.equal(after.todo.slice(after.todo.indexOf('## Tasks')), todo.slice(todo.indexOf('## Tasks')), 'task entries byte-identical');
  assert.equal(after.backup, undefined, 'the marked path takes no backup');
});
