'use strict';
// Manifest -> form model (t-sgrp, src/settingsform.ts). The settings page hand-lists nothing, so
// everything it draws is decided here — which makes this the suite that says what the page IS.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildSettingsForm, controlKind, humanizeKey, sectionTitle, sectionSlug, isGridKey, isDeprecated, formKeys,
  validateValue, toConfigPatch, resetPatch, findControl, MODEL_GRID_KEYS,
  appliesOf, stripAppliesSentence,
  APPLIES_RESTART_NOTE, APPLIES_RESTART_SENTENCE, APPLIES_RESTART_TAIL,
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
      'loopBoard.detail': {
        type: 'boolean', order: 10, default: true, markdownDescription: 'depends',
        loopBoardDependsOn: 'loopBoard.flag',
      },
      'loopBoard.count': { type: 'number', minimum: 1, maximum: 9, order: 30, default: 3, markdownDescription: 'count' },
      // A dependency that names a key which is not a declared boolean: ignored, never drawn.
      'loopBoard.dangling': {
        type: 'boolean', order: 40, default: false, markdownDescription: 'dangling',
        loopBoardDependsOn: 'loopBoard.count',
      },
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
    ['loopBoard.detail', 'loopBoard.flag', 'loopBoard.count', 'loopBoard.dangling']
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

test('a dependency is DECLARED in the manifest, never inferred from a dotted name', () => {
  // t-sgrp follow-up: the old rule paired `x.y` with a boolean `x`. That pair cannot legally exist
  // — VSCode drops the child key whenever the scalar parent is set (which is exactly when the child
  // matters), and test/manifest-settings.test.js now forbids it — so the dependency is stated with
  // `loopBoardDependsOn` instead.
  const form = buildSettingsForm(SECTIONS);
  assert.equal(findControl(form, 'loopBoard.detail').dependsOn, 'loopBoard.flag');
  // No declaration, no dependency.
  assert.equal(findControl(form, 'loopBoard.mode').dependsOn, undefined);
  // A reference to a declared key that is not a boolean draws nothing rather than greying forever.
  assert.equal(findControl(form, 'loopBoard.dangling').dependsOn, undefined);
  // Same for a reference to a key that is not declared at all, and for a self-reference.
  const odd = buildSettingsForm([
    {
      title: 'LoopBoard: Odd',
      order: 1,
      properties: {
        'loopBoard.ghost': { type: 'boolean', order: 10, default: false, markdownDescription: 'g', loopBoardDependsOn: 'loopBoard.nope' },
        'loopBoard.self': { type: 'boolean', order: 20, default: false, markdownDescription: 's', loopBoardDependsOn: 'loopBoard.self' },
      },
    },
  ]);
  assert.equal(findControl(odd, 'loopBoard.ghost').dependsOn, undefined);
  assert.equal(findControl(odd, 'loopBoard.self').dependsOn, undefined);
  // And a dotted key is no longer enough on its own: `loopBoard.contextLimit.percent` has no
  // scalar `loopBoard.contextLimit` to depend on, and must not acquire one by accident.
  const real = buildSettingsForm(manifest.contributes.configuration);
  assert.equal(findControl(real, 'loopBoard.contextLimit.action').dependsOn, undefined);
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
  assert.deepEqual(beta.controls.map((c) => c.key), ['loopBoard.delegateWork', 'loopBoard.delegateReview']);
  assert.ok(beta.controls.every((c) => c.beta));
  // The review toggle only applies while delegation is on — declared in the manifest, not inferred
  // from the key name (the two ids no longer share a prefix, and must not).
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
    ['loopBoard.maxAttachmentSizeMB', 'loopBoard.autoSyncTemplates', 'loopBoard.sidebarMarquee', 'loopBoard.debug']
  );
});

test('a control carries WHEN its change lands, taken from the manifest', () => {
  assert.equal(appliesOf({ loopBoardApplies: 'restart' }), 'restart');
  assert.equal(appliesOf({ loopBoardApplies: 'live' }), 'live');
  // Unclassified or misspelt degrades to `live`, i.e. to NO marker: the page must never claim a
  // fact the manifest does not state. `test/manifest-settings.test.js` is what forbids the case.
  assert.equal(appliesOf({}), 'live');
  assert.equal(appliesOf({ loopBoardApplies: 'Restart' }), 'live');

  const form = buildSettingsForm([
    {
      title: 'LoopBoard: T',
      order: 1,
      properties: {
        'loopBoard.frozen': { type: 'string', order: 10, default: '', markdownDescription: 'f', loopBoardApplies: 'restart' },
        'loopBoard.hot': { type: 'string', order: 20, default: '', markdownDescription: 'h', loopBoardApplies: 'live' },
      },
    },
  ]);
  assert.equal(findControl(form, 'loopBoard.frozen').applies, 'restart');
  assert.equal(findControl(form, 'loopBoard.hot').applies, 'live');
  // The marker text travels WITH the form, so the webview never keeps its own copy of the wording.
  assert.equal(form.appliesNote, APPLIES_RESTART_NOTE);
});

test('the page marker, the grid note and the manifest sentence are one wording', () => {
  assert.equal(APPLIES_RESTART_NOTE, `Applies ${APPLIES_RESTART_TAIL}`);
  assert.ok(APPLIES_RESTART_SENTENCE.startsWith(APPLIES_RESTART_NOTE));
  assert.ok(APPLIES_RESTART_SENTENCE.endsWith('.'), 'the native editor shows a SENTENCE, not a chip');
  assert.match(APPLIES_RESTART_TAIL, /▶/);
  assert.match(APPLIES_RESTART_TAIL, /♻/);
});

test('the page strips the manifest sentence it draws as a marker — one fact, one voice', () => {
  // t-sgrp follow-up: every `restart` description ENDS with APPLIES_RESTART_SENTENCE so the native
  // editor states the fact it cannot draw. LoopBoard's own page draws the marker instead, so it
  // must not render the sentence too. Exact-suffix strip against the constant, never a prose regex.
  assert.equal(stripAppliesSentence(`Some text. ${APPLIES_RESTART_SENTENCE}`), 'Some text.');
  assert.equal(stripAppliesSentence(APPLIES_RESTART_SENTENCE), '');
  // Trailing whitespace on either side is tolerated.
  assert.equal(stripAppliesSentence(`Some text. ${APPLIES_RESTART_SENTENCE}\n`), 'Some text.');
  // Absent: returned untouched, including a description that only MENTIONS restarting loops.
  assert.equal(stripAppliesSentence('Some text.'), 'Some text.');
  assert.equal(stripAppliesSentence(''), '');
  assert.equal(
    stripAppliesSentence('Restart the loop (♻) after each task.'),
    'Restart the loop (♻) after each task.'
  );
  // Only a SUFFIX is stripped — the sentence mid-description stays, because the marker replaces the
  // closing statement, not a reference inside the prose.
  const mid = `${APPLIES_RESTART_SENTENCE} And then more.`;
  assert.equal(stripAppliesSentence(mid), mid);

  // And on the real page: no drawn control repeats the marker's fact in its description.
  const form = buildSettingsForm(manifest.contributes.configuration);
  for (const section of form.sections) {
    for (const control of section.controls) {
      assert.ok(
        !control.description.includes(APPLIES_RESTART_SENTENCE),
        `${control.key} renders the applies sentence AND the ⟳ marker — the same fact twice`
      );
    }
  }
});

test('every drawn generic control on the real page is classified', () => {
  const form = buildSettingsForm(manifest.contributes.configuration);
  for (const section of form.sections) {
    for (const control of section.controls) {
      assert.ok(['live', 'restart'].includes(control.applies), `${control.key} reached the page unclassified`);
    }
  }
  // The 4 rows that must wear the marker (the other 9 restart keys are the grid's, which carries
  // the same note for the whole table).
  const marked = form.sections.flatMap((s) => s.controls).filter((c) => c.applies === 'restart').map((c) => c.key);
  assert.deepEqual(marked, [
    'loopBoard.permissionMode', 'loopBoard.loopInterval',
    'loopBoard.delegateWork', 'loopBoard.delegateReview',
  ]);
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
  assert.equal(humanizeKey('loopBoard.delegateReview'), 'Delegate review');
  // An ALL-CAPS run keeps its case: "Max attachment size MB", never "... size Mb".
  assert.equal(humanizeKey('loopBoard.maxAttachmentSizeMB'), 'Max attachment size MB');
  assert.equal(humanizeKey('loopBoard.debug'), 'Debug');
});

test('section titles drop the LoopBoard: prefix the native editor needs', () => {
  assert.equal(sectionTitle('LoopBoard: Agent Setup'), 'Agent Setup');
  assert.equal(sectionTitle('Something else'), 'Something else');
  assert.equal(sectionTitle(undefined), '');
});

test('every section carries a unique, title-derived anchor slug', () => {
  // The settings page's topic list links to these. Title-derived, never index-derived, so
  // reordering contributes.configuration cannot repoint an entry at a different section.
  assert.equal(sectionSlug('Board & Workspace'), 'board-workspace');
  assert.equal(sectionSlug('Beta (experimental)'), 'beta-experimental');
  assert.equal(sectionSlug('???'), 'section'); // a title with nothing sluggable still gets an id

  const real = buildSettingsForm(manifest.contributes.configuration).sections;
  assert.ok(real.length > 1);
  assert.equal(new Set(real.map((s) => s.slug)).size, real.length, 'two sections share an anchor');
  assert.equal(real.find((s) => s.title === 'Models & Slots').slug, 'models-slots');

  // Same title twice: the second gets its own id rather than stealing the first one's.
  const dup = buildSettingsForm([
    { title: 'LoopBoard: Same', order: 1, properties: { 'loopBoard.a': { type: 'boolean', default: false } } },
    { title: 'LoopBoard: Same', order: 2, properties: { 'loopBoard.b': { type: 'boolean', default: false } } },
  ]);
  assert.deepEqual(dup.sections.map((s) => s.slug), ['same', 'same-2']);
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
  const empty = { sections: [], appliesNote: APPLIES_RESTART_NOTE };
  assert.deepEqual(buildSettingsForm([]), empty);
  assert.deepEqual(buildSettingsForm([{ title: 'LoopBoard: Empty', order: 1 }]), empty);
});
