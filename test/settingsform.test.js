'use strict';
// Manifest -> form model (t-sgrp, src/settingsform.ts). The settings page hand-lists nothing, so
// everything it draws is decided here — which makes this the suite that says what the page IS.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildSettingsForm, controlKind, humanizeKey, sectionTitle, isGridKey, isDeprecated, formKeys,
  validateValue, toConfigPatch, resetPatch, findControl, MODEL_GRID_KEYS,
} = require('../out-test/settingsform.js');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// A tiny hand-written manifest, so the mapping tests are not hostage to the real one's wording.
const SECTIONS = [
  {
    title: 'LoopBoard: Two',
    order: 2,
    properties: {
      'loopBoard.flag': { type: 'boolean', order: 20, default: false, markdownDescription: 'a `flag`' },
      'loopBoard.flag.detail': { type: 'boolean', order: 10, default: true, markdownDescription: 'depends' },
      'loopBoard.count': { type: 'number', minimum: 1, maximum: 9, order: 30, default: 3, markdownDescription: 'count' },
    },
  },
  {
    title: 'LoopBoard: One',
    order: 1,
    properties: {
      'loopBoard.mode': { type: 'string', enum: ['a', 'b'], enumDescriptions: ['A', 'B'], order: 10, default: 'a', markdownDescription: 'mode' },
      'loopBoard.name': { type: 'string', order: 20, default: '', markdownDescription: 'name' },
      'loopBoard.weird': { type: 'object', order: 30, default: {}, markdownDescription: 'weird' },
      'loopBoard.gone': { type: 'boolean', order: 40, default: false, markdownDescription: 'x', markdownDeprecationMessage: 'use something else' },
    },
  },
];

test('each manifest type maps to the right control kind', () => {
  assert.equal(controlKind({ type: 'boolean' }), 'boolean');
  assert.equal(controlKind({ type: 'string' }), 'string');
  assert.equal(controlKind({ type: 'number' }), 'number');
  assert.equal(controlKind({ type: 'integer' }), 'number');
  // enum wins over the declared type — the manifest's enums are all `type: string`.
  assert.equal(controlKind({ type: 'string', enum: ['a'] }), 'enum');
  assert.equal(controlKind({ type: 'object' }), 'unknown');
  assert.equal(controlKind({}), 'unknown');
});

test('an unknown type degrades to a read-only row rather than throwing', () => {
  const form = buildSettingsForm(SECTIONS);
  const weird = findControl(form, 'loopBoard.weird');
  assert.equal(weird.kind, 'unknown');
  assert.equal(weird.readOnly, true);
  // And it is never writable through this page.
  const result = toConfigPatch(weird, { anything: 1 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Open in VSCode Settings/);
});

test('sections are ordered by `order`, properties by `order` then declaration', () => {
  const form = buildSettingsForm(SECTIONS);
  assert.deepEqual(form.sections.map((s) => s.title), ['One', 'Two']);
  assert.deepEqual(
    form.sections[1].controls.map((c) => c.key),
    ['loopBoard.flag.detail', 'loopBoard.flag', 'loopBoard.count']
  );
});

test('a deprecated property is not drawn at all', () => {
  assert.equal(isDeprecated({ markdownDeprecationMessage: 'x' }), true);
  assert.equal(isDeprecated({ deprecationMessage: 'x' }), true);
  assert.equal(isDeprecated({}), false);
  const form = buildSettingsForm(SECTIONS);
  assert.equal(findControl(form, 'loopBoard.gone'), undefined);
});

test('modified-vs-default is derived from the inspect()-shaped input', () => {
  const form = buildSettingsForm(SECTIONS, {
    'loopBoard.count': { defaultValue: 3, globalValue: 7 },
    'loopBoard.name': { defaultValue: '' },
  });
  const count = findControl(form, 'loopBoard.count');
  assert.equal(count.modified, true);
  assert.equal(count.value, 7);
  assert.equal(count.defaultValue, 3);
  const name = findControl(form, 'loopBoard.name');
  assert.equal(name.modified, false);
  assert.equal(name.value, '');
});

test('a global value equal to the default still counts as modified', () => {
  // Same rule the native editor uses: the blue bar is about the key being SET, not about the value
  // differing — so Reset stays offered and the user settings file keeps its entry visible.
  const form = buildSettingsForm(SECTIONS, { 'loopBoard.count': { defaultValue: 3, globalValue: 3 } });
  assert.equal(findControl(form, 'loopBoard.count').modified, true);
});

test('a boolean parent key becomes a dependency, derived not hard-coded', () => {
  const form = buildSettingsForm(SECTIONS);
  assert.equal(findControl(form, 'loopBoard.flag.detail').dependsOn, 'loopBoard.flag');
  // A dotted key whose parent is NOT a declared boolean depends on nothing.
  assert.equal(findControl(form, 'loopBoard.mode').dependsOn, undefined);
});

test('the model keys are claimed by the grid, never drawn as generic controls', () => {
  const form = buildSettingsForm(manifest.contributes.configuration);
  for (const key of MODEL_GRID_KEYS) {
    assert.ok(isGridKey(key), `${key} must be a grid key`);
    assert.equal(findControl(form, key), undefined, `${key} must not get a generic control`);
  }
  const models = form.sections.find((s) => s.title === 'Models & Slots');
  assert.equal(models.grid, true);
  assert.deepEqual(models.controls, [], 'the grid section draws nothing else');
});

test('MODEL_GRID_KEYS is exactly the 14-key matrix the grid replaces', () => {
  assert.equal(MODEL_GRID_KEYS.length, 14);
  assert.ok(MODEL_GRID_KEYS.includes('loopBoard.defaultWorkerModel'));
  assert.ok(MODEL_GRID_KEYS.includes('loopBoard.defaultGroomerModel'));
  for (const slot of ['opus', 'sonnet', 'fable']) {
    for (const field of ['enabled', 'model', 'effort', 'groomConcurrency']) {
      assert.ok(MODEL_GRID_KEYS.includes(`loopBoard.models.${slot}.${field}`));
    }
  }
});

test('the Beta section is beta because its properties are tagged, not because of its title', () => {
  const form = buildSettingsForm(manifest.contributes.configuration);
  const beta = form.sections.find((s) => s.title === 'Beta (experimental)');
  assert.equal(beta.beta, true);
  assert.deepEqual(beta.controls.map((c) => c.key), ['loopBoard.delegateWork', 'loopBoard.delegateWork.review']);
  assert.ok(beta.controls.every((c) => c.beta));
  // The review toggle only applies while delegation is on — derived from the manifest.
  assert.equal(beta.controls[1].dependsOn, 'loopBoard.delegateWork');
  for (const section of form.sections) {
    if (section === beta) continue;
    assert.equal(section.beta, false, `${section.title} must not read as Beta`);
  }
});

test('the real manifest renders as the four agreed sections', () => {
  const form = buildSettingsForm(manifest.contributes.configuration);
  assert.deepEqual(
    form.sections.map((s) => s.title),
    ['Models & Slots', 'Agent Setup', 'Board & Workspace', 'Beta (experimental)']
  );
  assert.deepEqual(
    form.sections.find((s) => s.title === 'Agent Setup').controls.map((c) => c.key),
    [
      'loopBoard.permissionMode', 'loopBoard.loopInterval', 'loopBoard.afterTask',
      'loopBoard.contextLimit.percent', 'loopBoard.contextLimit.action', 'loopBoard.nudgeLoops',
    ]
  );
  assert.deepEqual(
    form.sections.find((s) => s.title === 'Board & Workspace').controls.map((c) => c.key),
    ['loopBoard.maxAttachmentSizeMB', 'loopBoard.pulseTemplateSync', 'loopBoard.debug']
  );
});

test('every drawn control keeps its markdown description source for the shared renderer', () => {
  const form = buildSettingsForm(manifest.contributes.configuration);
  for (const section of form.sections) {
    for (const control of section.controls) {
      assert.ok(control.description.length > 0, `${control.key} lost its description`);
    }
  }
});

test('enum controls carry their values and per-value descriptions', () => {
  const form = buildSettingsForm(SECTIONS);
  const mode = findControl(form, 'loopBoard.mode');
  assert.deepEqual(mode.enumValues, ['a', 'b']);
  assert.deepEqual(mode.enumDescriptions, ['A', 'B']);
});

test('labels are humanised from the key', () => {
  assert.equal(humanizeKey('loopBoard.permissionMode'), 'Permission mode');
  assert.equal(humanizeKey('loopBoard.contextLimit.percent'), 'Context limit — percent');
  assert.equal(humanizeKey('loopBoard.delegateWork.review'), 'Delegate work — review');
  // An ALL-CAPS run keeps its case: "Max attachment size MB", never "... size Mb".
  assert.equal(humanizeKey('loopBoard.maxAttachmentSizeMB'), 'Max attachment size MB');
  assert.equal(humanizeKey('loopBoard.debug'), 'Debug');
});

test('section titles drop the LoopBoard: prefix the native editor needs', () => {
  assert.equal(sectionTitle('LoopBoard: Agent Setup'), 'Agent Setup');
  assert.equal(sectionTitle('Something else'), 'Something else');
  assert.equal(sectionTitle(undefined), '');
});

test('formKeys lists every declared key, grid and deprecated included', () => {
  const keys = formKeys(manifest.contributes.configuration);
  assert.ok(keys.includes('loopBoard.models.opus.effort'));
  assert.ok(keys.includes('loopBoard.autoRecycle'));
  assert.equal(new Set(keys).size, keys.length, 'a key is declared twice');
});

// ---- validation: the host's last gate before update() ----

test('a number below its minimum is rejected, with the bound in the reason', () => {
  const form = buildSettingsForm(SECTIONS);
  const count = findControl(form, 'loopBoard.count');
  const low = validateValue(count, 0);
  assert.equal(low.ok, false);
  assert.match(low.reason, /at least 1/);
  const high = validateValue(count, 10);
  assert.equal(high.ok, false);
  assert.match(high.reason, /at most 9/);
  assert.deepEqual(validateValue(count, 5), { ok: true, value: 5 });
  // A numeric string from the webview is coerced, not rejected.
  assert.deepEqual(validateValue(count, '5'), { ok: true, value: 5 });
  assert.equal(validateValue(count, 'five').ok, false);
});

test('an enum value outside the declared set is rejected', () => {
  const mode = findControl(buildSettingsForm(SECTIONS), 'loopBoard.mode');
  assert.deepEqual(validateValue(mode, 'b'), { ok: true, value: 'b' });
  const bad = validateValue(mode, 'c');
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /a, b/);
});

test('booleans are coerced to a real boolean — a truthy webview payload is not enough', () => {
  const flag = findControl(buildSettingsForm(SECTIONS), 'loopBoard.flag');
  assert.deepEqual(validateValue(flag, true), { ok: true, value: true });
  assert.deepEqual(validateValue(flag, 'true'), { ok: true, value: false });
  assert.deepEqual(validateValue(flag, 1), { ok: true, value: false });
});

test('an edit becomes a (key, value) config patch', () => {
  const count = findControl(buildSettingsForm(SECTIONS), 'loopBoard.count');
  assert.deepEqual(toConfigPatch(count, 4), { ok: true, patch: { key: 'loopBoard.count', value: 4 } });
  assert.equal(toConfigPatch(count, 0).ok, false);
});

test('a reset patches the key to undefined — what update() reads as "remove"', () => {
  const patch = resetPatch('loopBoard.count');
  assert.equal(patch.key, 'loopBoard.count');
  assert.equal(patch.value, undefined);
  assert.ok('value' in patch, 'the key must be present with an undefined value, not absent');
});

test('buildSettingsForm tolerates an empty or malformed manifest', () => {
  assert.deepEqual(buildSettingsForm([]), { sections: [] });
  assert.deepEqual(buildSettingsForm([{ title: 'LoopBoard: Empty', order: 1 }]), { sections: [] });
});
