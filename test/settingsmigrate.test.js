'use strict';
// Stale `loopBoard.*` settings -> migration plan (t-sgrp, src/settingsmigrate.ts).
//
// This module writes to the user's PERSONAL settings, so the thing worth pinning is not that it
// works but that it refuses to act when it is not sure: no destination is ever overwritten, no key
// the code still honours is ever removed, and a plan with nothing to do produces no writes at all.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildMigrationPlan, actionWrites, isOrphan, scanKeys, MIGRATIONS, LEGACY_HONOURED_KEYS,
  AFTER_TASK_KEY, AUTO_RECYCLE_KEY, CLEAR_SESSION_KEY,
  DELEGATE_WORK_KEY, DELEGATE_REVIEW_KEY, OLD_DELEGATE_REVIEW_KEY, DEFAULT_REVIEWER_KEY,
  AUTO_SYNC_TEMPLATES_KEY, PULSE_TEMPLATE_SYNC_KEY,
} = require('../out-test/settingsmigrate.js');
const { formKeys } = require('../out-test/settingsform.js');
const { resolveAfterTask, resolveOrchestrator, resolveTaskDefaults } = require('../out-test/model.js');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const DECLARED = formKeys(manifest.contributes.configuration);

const byKey = (plan, key) => plan.actions.find((a) => a.key === key);

// ---- nothing stale ----

test('a clean config plans nothing and writes nothing', () => {
  const plan = buildMigrationPlan(DECLARED, {
    'loopBoard.debug': 'info',
    'loopBoard.loopInterval': '2m',
    'loopBoard.models.opus.enabled': false,
  });
  assert.deepEqual(plan.actions, []);
  assert.deepEqual(plan.writes, []);
  assert.equal(plan.conflicts, 0);
  assert.equal(plan.sweeps, 0);
  assert.equal(plan.findings, 0);
});

test('an empty config plans nothing', () => {
  const plan = buildMigrationPlan(DECLARED, {});
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.writes.length, 0);
});

// ---- category 1: the review switch became a reviewer model (t-0e99) ----

test('delegateReview: true migrates to defaultReviewerModel: opus, then is removed (owner decision 2026-10-14)', () => {
  const plan = buildMigrationPlan(DECLARED, { [DELEGATE_REVIEW_KEY]: true });
  const action = byKey(plan, DELEGATE_REVIEW_KEY);
  assert.equal(action.kind, 'migrate');
  assert.equal(action.reason, 'deprecated');
  assert.equal(action.target, DEFAULT_REVIEWER_KEY);
  assert.equal(action.targetValue, 'opus');
  // Destination first, removal second: an interrupted run must never lose the value.
  assert.deepEqual(plan.writes, [
    { key: DEFAULT_REVIEWER_KEY, value: 'opus' },
    { key: DELEGATE_REVIEW_KEY, value: undefined },
  ]);
});

test('delegateReview: false carries nothing and is only removed', () => {
  const plan = buildMigrationPlan(DECLARED, { [DELEGATE_REVIEW_KEY]: false });
  assert.equal(byKey(plan, DELEGATE_REVIEW_KEY).kind, 'remove');
  assert.deepEqual(plan.writes, [{ key: DELEGATE_REVIEW_KEY, value: undefined }]);
});

test('the pre-rename delegateWork.review id never took effect, so it is removed and carries nothing', () => {
  const plan = buildMigrationPlan(DECLARED, { [OLD_DELEGATE_REVIEW_KEY]: true });
  const action = byKey(plan, OLD_DELEGATE_REVIEW_KEY);
  assert.equal(action.kind, 'remove');
  assert.equal(action.target, DEFAULT_REVIEWER_KEY);
  assert.deepEqual(plan.writes, [{ key: OLD_DELEGATE_REVIEW_KEY, value: undefined }]);
});

test('an explicit delegateReview: false is never turned into a review by the old child key', () => {
  // Pass 1: delegateWork shadows the child, delegateReview: false is removed, nothing is written.
  const first = buildMigrationPlan(DECLARED, { [DELEGATE_WORK_KEY]: true, [DELEGATE_REVIEW_KEY]: false });
  assert.ok(first.writes.every((w) => w.value === undefined), 'pass 1 writes no value');
  // Pass 2: with delegateWork gone the stale child `true` is readable, and is only removed.
  const second = buildMigrationPlan(DECLARED, { [OLD_DELEGATE_REVIEW_KEY]: true });
  assert.ok(!second.writes.some((w) => w.key === DEFAULT_REVIEWER_KEY), 'no reviewer is written');
  assert.equal(resolveTaskDefaults((k) => (k === 'delegateWork.review' ? true : undefined)).reviewer, 'none', 'and it was never in force');
});

test('the migrated reviewer IS what resolveTaskDefaults honours today', () => {
  // The guarantee that migrating changes no behaviour: until applied, the reader treats
  // `delegateReview: true` as `opus` and `false` as `none`.
  for (const value of [true, false]) {
    const honoured = resolveTaskDefaults((k) => (k === 'delegateReview' ? value : undefined)).reviewer;
    const write = buildMigrationPlan(DECLARED, { [DELEGATE_REVIEW_KEY]: value }).writes.find((w) => w.key === DEFAULT_REVIEWER_KEY);
    if (honoured === 'none') assert.equal(write, undefined, `${value}: none is the default, so nothing is written`);
    else assert.equal(write.value, honoured);
  }
});

test('a reviewer migration whose destination is already set is a conflict: reported, never written', () => {
  const plan = buildMigrationPlan(DECLARED, {
    [DELEGATE_REVIEW_KEY]: true,
    [DEFAULT_REVIEWER_KEY]: 'opus',
  });
  const action = byKey(plan, DELEGATE_REVIEW_KEY);
  assert.equal(action.kind, 'conflict');
  assert.equal(action.targetValue, 'opus');
  assert.match(action.detail, /already set to "opus"/);
  assert.deepEqual(plan.writes, [], 'a conflict must plan no write at all');
  assert.equal(plan.conflicts, 1);
});

test('delegateWork is offered for removal with nothing carried: delegation is always on now', () => {
  for (const value of [true, false]) {
    const plan = buildMigrationPlan(DECLARED, { [DELEGATE_WORK_KEY]: value });
    const action = byKey(plan, DELEGATE_WORK_KEY);
    assert.equal(action.kind, 'remove', String(value));
    assert.deepEqual(actionWrites(action), [{ key: DELEGATE_WORK_KEY, value: undefined }]);
    assert.ok(plan.writes.some((w) => w.key === DELEGATE_WORK_KEY && w.value === undefined));
    assert.ok(!plan.writes.some((w) => w.value !== undefined), 'nothing is carried over');
  }
});

// ---- the key that cannot be READ but can be REMOVED ----
// VSCode resolves a read through `toValuesTree`, which drops a child of a scalar, but computes a
// removal as a JSON text edit on settings.json itself (`setProperty`, one literal path segment).
// So with `loopBoard.delegateWork` set the old child key is invisible AND deletable: the plan
// offers the removal blind rather than asking the user to go and edit JSON by hand.

test('the pre-rename key hidden behind its scalar parent is offered as a blind removal', () => {
  const plan = buildMigrationPlan(DECLARED, { [DELEGATE_WORK_KEY]: true });
  const action = byKey(plan, OLD_DELEGATE_REVIEW_KEY);
  assert.equal(action.kind, 'sweep');
  assert.equal(action.value, undefined, 'the scan cannot see a value, and must not invent one');
  assert.match(action.detail, /cannot be READ while loopBoard\.delegateWork is set/);
  assert.match(action.detail, /changes nothing if it is not/);
  assert.equal(plan.sweeps, 1);
  // It is executable, but ONLY through its own button.
  assert.deepEqual(actionWrites(action), [{ key: OLD_DELEGATE_REVIEW_KEY, value: undefined }]);
});

test('a blind removal is NOT a finding: only the parent the scan really saw is counted', () => {
  // The verdict the panel prints comes from `findings`. A sweep is an offer, not evidence: the one
  // finding here is the stale `delegateWork` itself, never the unreadable child.
  const plan = buildMigrationPlan(DECLARED, { [DELEGATE_WORK_KEY]: true });
  assert.equal(plan.findings, 1);
  assert.equal(plan.actions.length, 2);
});

test('a blind removal is NEVER carried by a bulk apply', () => {
  // The scan has no evidence anything is there, so it must not ride along on a click the user made
  // about something else, and the count on the Apply button must be a count of certain changes.
  // Its own button in the page's collapsed "legacy keys" disclosure is the only way it runs.
  assert.deepEqual(buildMigrationPlan(DECLARED, { [DELEGATE_WORK_KEY]: true }).writes, [{ key: DELEGATE_WORK_KEY, value: undefined }]);
});

test('a real finding alongside a blind removal is counted separately, and only the findings are bulk', () => {
  const plan = buildMigrationPlan(DECLARED, { [DELEGATE_WORK_KEY]: true, [AUTO_RECYCLE_KEY]: true });
  assert.equal(plan.sweeps, 1);
  assert.equal(plan.findings, 2);
  assert.deepEqual(plan.writes, [
    { key: AFTER_TASK_KEY, value: 'recycle' },
    { key: AUTO_RECYCLE_KEY, value: undefined },
    { key: DELEGATE_WORK_KEY, value: undefined },
  ]);
  assert.equal(plan.writes.some((w) => w.key === OLD_DELEGATE_REVIEW_KEY), false);
});

test('no blind removal is offered when the old key IS visible', () => {
  const plan = buildMigrationPlan(DECLARED, { [OLD_DELEGATE_REVIEW_KEY]: true });
  assert.equal(plan.sweeps, 0);
  assert.equal(plan.findings, 1);
  assert.equal(byKey(plan, OLD_DELEGATE_REVIEW_KEY).kind, 'remove');
});

test('no blind removal is offered when nothing shadows the key', () => {
  assert.equal(buildMigrationPlan(DECLARED, {}).sweeps, 0);
  assert.equal(buildMigrationPlan(DECLARED, { [DELEGATE_REVIEW_KEY]: true }).sweeps, 0);
});

// ---- t-0e99: the per-model loop slots became the one orchestrator ----

const slot = (m, f) => `loopBoard.models.${m}.${f}`;

test('the Opus slot effort/groomConcurrency move to orchestrator.*', () => {
  const plan = buildMigrationPlan(DECLARED, { [slot('opus', 'effort')]: 'high', [slot('opus', 'groomConcurrency')]: 5 });
  for (const [field, value] of [['effort', 'high'], ['groomConcurrency', 5]]) {
    const action = byKey(plan, slot('opus', field));
    assert.equal(action.kind, 'migrate', field);
    assert.equal(action.target, `loopBoard.orchestrator.${field}`);
    assert.equal(action.targetValue, value);
    assert.deepEqual(actionWrites(action), [{ key: `loopBoard.orchestrator.${field}`, value }, { key: slot('opus', field), value: undefined }]);
  }
  // Destination writes come first in a bulk apply.
  assert.deepEqual(plan.writes.slice(0, 2).map((w) => w.key), ['loopBoard.orchestrator.effort', 'loopBoard.orchestrator.groomConcurrency']);
});

test('each slot --model string becomes that model id (t-0e99 FB4); the bare alias carries nothing', () => {
  const plan = buildMigrationPlan(DECLARED, {
    [slot('opus', 'model')]: 'claude-opus-5-5[1m]', [slot('sonnet', 'model')]: 'sonnet[1m]', [slot('fable', 'model')]: 'fable',
  });
  for (const [m, value] of [['opus', 'claude-opus-5-5[1m]'], ['sonnet', 'sonnet[1m]']]) {
    const action = byKey(plan, slot(m, 'model'));
    assert.equal(action.kind, 'migrate', m);
    assert.equal(action.reason, 'renamed');
    assert.equal(action.target, slot(m, 'modelId'));
    assert.equal(action.targetValue, value);
  }
  assert.equal(byKey(plan, slot('fable', 'model')).kind, 'remove', 'the bare alias is what an unset id already means');
  assert.ok(!plan.writes.some((w) => w.key === 'loopBoard.orchestrator.model'), 'the orchestrator model is an alias select now, never a migrated string');
});

test('the Sonnet and Fable slot effort/groomConcurrency are only removed, nothing carried', () => {
  const values = {};
  for (const m of ['sonnet', 'fable']) {
    values[slot(m, 'effort')] = 'xhigh';
    values[slot(m, 'groomConcurrency')] = 7;
  }
  const plan = buildMigrationPlan(DECLARED, values);
  for (const key of Object.keys(values)) {
    const action = byKey(plan, key);
    assert.equal(action.kind, 'remove', key);
    assert.equal(action.reason, 'deprecated', `${key} is listed as deprecated, not as an anonymous orphan`);
  }
  assert.ok(plan.writes.every((w) => w.value === undefined), 'no orchestrator value is written from a non-Opus slot');
  assert.equal(plan.writes.length, 4);
});

test('a Sonnet/Fable slot key is a plain removal even when the orchestrator key is set by hand', () => {
  const plan = buildMigrationPlan(DECLARED, { [slot('sonnet', 'effort')]: 'xhigh', 'loopBoard.orchestrator.effort': 'low' });
  const action = byKey(plan, slot('sonnet', 'effort'));
  assert.equal(action.kind, 'remove', 'it carries nothing, so there is no choice to protect');
  assert.equal(plan.conflicts, 0);
  assert.deepEqual(plan.writes, [{ key: slot('sonnet', 'effort'), value: undefined }], 'and a bulk apply removes it');
});

test('an invalid Opus slot value carries nothing, and a set target key makes it a conflict', () => {
  const bad = buildMigrationPlan(DECLARED, { [slot('opus', 'model')]: 'opus; rm -rf /', [slot('opus', 'effort')]: 'ludicrous', [slot('opus', 'groomConcurrency')]: 0 });
  assert.ok(bad.writes.every((w) => w.value === undefined), 'nothing invalid is ever written');
  const conflict = buildMigrationPlan(DECLARED, { [slot('opus', 'effort')]: 'high', 'loopBoard.orchestrator.effort': 'low' });
  assert.equal(byKey(conflict, slot('opus', 'effort')).kind, 'conflict');
  assert.deepEqual(conflict.writes, []);
  const idConflict = buildMigrationPlan(DECLARED, { [slot('opus', 'model')]: 'opus[1m]', [slot('opus', 'modelId')]: 'claude-opus-5-5' });
  assert.equal(byKey(idConflict, slot('opus', 'model')).kind, 'conflict');
});

test('the migrated values ARE what the readers honour today', () => {
  const { readModelsConfig, resolveModels } = require('../out-test/model.js');
  const values = { [slot('opus', 'model')]: 'opus[1m]', [slot('opus', 'effort')]: 'xhigh', [slot('opus', 'groomConcurrency')]: 4, [slot('sonnet', 'effort')]: 'low' };
  const set = (k) => values[`loopBoard.${k}`];
  const honoured = resolveOrchestrator(set);
  const ids = Object.fromEntries(resolveModels(readModelsConfig((k, d) => d, set)).map((m) => [m.id, m.modelId]));
  const written = Object.fromEntries(buildMigrationPlan(DECLARED, values).writes.filter((w) => w.value !== undefined).map((w) => [w.key, w.value]));
  assert.deepEqual(written, {
    'loopBoard.orchestrator.effort': honoured.effort,
    'loopBoard.orchestrator.groomConcurrency': honoured.groomConcurrency,
    'loopBoard.models.opus.modelId': ids.opus,
  });
});

// ---- per-row actions ----
// Every row carries its own button, so a user can act on one finding and leave another. The host
// looks the key up in a REBUILT plan and asks for exactly these writes.

test('every planned action is executable on its own', () => {
  const values = {
    [OLD_DELEGATE_REVIEW_KEY]: false,
    [AFTER_TASK_KEY]: 'none',
    [AUTO_RECYCLE_KEY]: true,
    'loopBoard.gone': 1,
  };
  const plan = buildMigrationPlan(DECLARED, values);
  assert.ok(plan.actions.length >= 3);
  for (const action of plan.actions) {
    const writes = actionWrites(action);
    assert.ok(writes.length >= 1, `${action.key} must have something to do`);
    // Its own key is always removed, and it is always the LAST write, so an interrupted row cannot
    // drop the source before its destination is stored.
    assert.deepEqual(writes[writes.length - 1], { key: action.key, value: undefined });
  }
});

test('a single migrate row writes its destination first, then drops the source', () => {
  const plan = buildMigrationPlan(DECLARED, { [AUTO_RECYCLE_KEY]: true });
  assert.deepEqual(actionWrites(byKey(plan, AUTO_RECYCLE_KEY)), [
    { key: AFTER_TASK_KEY, value: 'recycle' },
    { key: AUTO_RECYCLE_KEY, value: undefined },
  ]);
});

test('a conflict row can be resolved by dropping the OLD key, never by overwriting the new one', () => {
  const plan = buildMigrationPlan(DECLARED, { [OLD_DELEGATE_REVIEW_KEY]: false, [DEFAULT_REVIEWER_KEY]: 'opus' });
  const action = byKey(plan, OLD_DELEGATE_REVIEW_KEY);
  assert.equal(action.kind, 'conflict');
  assert.deepEqual(actionWrites(action), [{ key: OLD_DELEGATE_REVIEW_KEY, value: undefined }]);
  assert.deepEqual(plan.writes, [], 'and it still contributes nothing to a bulk apply');
});

test('a blind removal row removes exactly one key, never its shadowing parent', () => {
  // The risk worth pinning: VSCode treats a dotted key as ONE literal property name, so the sweep's
  // own write must name the child alone. The parent (stale itself since t-0e99) has its OWN row.
  const plan = buildMigrationPlan(DECLARED, { [DELEGATE_WORK_KEY]: true });
  assert.deepEqual(actionWrites(byKey(plan, OLD_DELEGATE_REVIEW_KEY)), [
    { key: OLD_DELEGATE_REVIEW_KEY, value: undefined },
  ]);
  assert.equal(plan.actions.filter((a) => a.key === DELEGATE_WORK_KEY).length, 1, 'the parent is its own, separate row');
});

// ---- category 2: deprecated pair -> afterTask ----

test('autoRecycle migrates to afterTask: "recycle"', () => {
  const plan = buildMigrationPlan(DECLARED, { [AUTO_RECYCLE_KEY]: true });
  const action = byKey(plan, AUTO_RECYCLE_KEY);
  assert.equal(action.kind, 'migrate');
  assert.equal(action.reason, 'deprecated');
  assert.equal(action.targetValue, 'recycle');
  assert.deepEqual(plan.writes, [
    { key: AFTER_TASK_KEY, value: 'recycle' },
    { key: AUTO_RECYCLE_KEY, value: undefined },
  ]);
});

test('clearSessionAfterTask migrates to afterTask: "clear"', () => {
  const plan = buildMigrationPlan(DECLARED, { [CLEAR_SESSION_KEY]: true });
  assert.equal(byKey(plan, CLEAR_SESSION_KEY).targetValue, 'clear');
  assert.deepEqual(plan.writes, [
    { key: AFTER_TASK_KEY, value: 'clear' },
    { key: CLEAR_SESSION_KEY, value: undefined },
  ]);
});

test('both booleans on: autoRecycle decides, clearSessionAfterTask is only removed', () => {
  // The same precedence `resolveAfterTask` applies at run time — a recycle always won, which made
  // clear moot. Migrating must reproduce that, not pick the other one.
  const plan = buildMigrationPlan(DECLARED, { [AUTO_RECYCLE_KEY]: true, [CLEAR_SESSION_KEY]: true });
  assert.equal(byKey(plan, AUTO_RECYCLE_KEY).kind, 'migrate');
  assert.equal(byKey(plan, AUTO_RECYCLE_KEY).targetValue, 'recycle');
  assert.equal(byKey(plan, CLEAR_SESSION_KEY).kind, 'remove');
  assert.match(byKey(plan, CLEAR_SESSION_KEY).detail, /loopBoard\.autoRecycle is what decides/);
  assert.deepEqual(plan.writes, [
    { key: AFTER_TASK_KEY, value: 'recycle' },
    { key: AUTO_RECYCLE_KEY, value: undefined },
    { key: CLEAR_SESSION_KEY, value: undefined },
  ]);
});

test('deprecated booleans explicitly set to false are removed without writing afterTask', () => {
  const plan = buildMigrationPlan(DECLARED, { [AUTO_RECYCLE_KEY]: false, [CLEAR_SESSION_KEY]: false });
  assert.equal(byKey(plan, AUTO_RECYCLE_KEY).kind, 'remove');
  assert.equal(byKey(plan, CLEAR_SESSION_KEY).kind, 'remove');
  assert.deepEqual(plan.writes, [
    { key: AUTO_RECYCLE_KEY, value: undefined },
    { key: CLEAR_SESSION_KEY, value: undefined },
  ]);
  assert.ok(!plan.writes.some((w) => w.key === AFTER_TASK_KEY), 'afterTask must not be written for a no-op pair');
});

test('afterTask already set makes the deprecated pair a conflict, not an overwrite', () => {
  const plan = buildMigrationPlan(DECLARED, {
    [AFTER_TASK_KEY]: 'none',
    [AUTO_RECYCLE_KEY]: true,
  });
  assert.equal(byKey(plan, AUTO_RECYCLE_KEY).kind, 'conflict');
  assert.deepEqual(plan.writes, []);
  assert.equal(plan.conflicts, 1);
});

test('the migrated afterTask value IS what resolveAfterTask honours today, for every combination', () => {
  // The guarantee that migrating changes no behaviour. If the honouring rule ever changes, this
  // fails rather than leaving a second, drifting copy of the mapping in the migration table.
  for (const recycle of [true, false]) {
    for (const clear of [true, false]) {
      const values = { [AUTO_RECYCLE_KEY]: recycle, [CLEAR_SESSION_KEY]: clear };
      const honoured = resolveAfterTask(undefined, recycle, clear);
      const write = buildMigrationPlan(DECLARED, values).writes.find((w) => w.key === AFTER_TASK_KEY);
      if (honoured === 'none') {
        assert.equal(write, undefined, `${recycle}/${clear}: "none" is the default, so nothing is written`);
      } else {
        assert.equal(write.value, honoured, `${recycle}/${clear} must migrate to the honoured mode`);
      }
    }
  }
});

test('a stored pulseTemplateSync (either value) is removed as deprecated, never migrated onto autoSyncTemplates (t-4dce)', () => {
  for (const value of [true, false]) {
    const plan = buildMigrationPlan(DECLARED, { [PULSE_TEMPLATE_SYNC_KEY]: value });
    const action = byKey(plan, PULSE_TEMPLATE_SYNC_KEY);
    assert.equal(action.kind, 'remove', `${value}: a pulse preference carries nothing over`);
    assert.equal(action.reason, 'deprecated', `${value}: listed as deprecated, not as an anonymous orphan`);
    assert.equal(action.target, AUTO_SYNC_TEMPLATES_KEY);
    assert.deepEqual(plan.writes, [{ key: PULSE_TEMPLATE_SYNC_KEY, value: undefined }]);
    assert.ok(!plan.writes.some((w) => w.key === AUTO_SYNC_TEMPLATES_KEY), `${value}: the target must never be written`);
  }
});

// ---- category 3: orphans ----

test('an undeclared key nothing reads is planned for removal', () => {
  const plan = buildMigrationPlan(DECLARED, { 'loopBoard.customRules': ['a', 'b'] });
  const action = byKey(plan, 'loopBoard.customRules');
  assert.equal(action.kind, 'remove');
  assert.equal(action.reason, 'orphan');
  assert.deepEqual(plan.writes, [{ key: 'loopBoard.customRules', value: undefined }]);
});

test('a legacy key the code still honours is NOT an orphan', () => {
  // `resolveTaskDefaults` falls back to `loopBoard.defaultModel`; removing it would change which
  // model a pre-split config runs.
  assert.ok(LEGACY_HONOURED_KEYS.includes('loopBoard.defaultModel'));
  const plan = buildMigrationPlan(DECLARED, { 'loopBoard.defaultModel': 'sonnet' });
  assert.deepEqual(plan.actions, []);
  assert.deepEqual(plan.writes, []);
});

test('a legacy CONTAINER that declared keys live inside is not an orphan', () => {
  // `{"loopBoard.models": {...}}` resolves through the same dotted lookups as the flat keys.
  assert.equal(isOrphan('loopBoard.models', DECLARED, []), false);
  assert.equal(isOrphan('loopBoard.contextLimit', DECLARED, []), false);
  assert.deepEqual(buildMigrationPlan(DECLARED, { 'loopBoard.models': { opus: {} } }).writes, []);
});

test('no declared key — including a deprecated one — is ever treated as an orphan', () => {
  for (const key of DECLARED) {
    assert.equal(isOrphan(key, DECLARED, []), false, `${key} is declared and must be left alone`);
  }
});

test('a key a migration rule already owns is not double-reported as an orphan', () => {
  const plan = buildMigrationPlan(DECLARED, { [OLD_DELEGATE_REVIEW_KEY]: true });
  assert.equal(plan.actions.filter((a) => a.key === OLD_DELEGATE_REVIEW_KEY).length, 1);
  assert.equal(plan.actions.every((a) => a.reason !== 'orphan'), true);
});

test('keys outside the loopBoard namespace are never touched', () => {
  assert.equal(isOrphan('editor.fontSize', DECLARED, []), false);
  assert.deepEqual(buildMigrationPlan(DECLARED, { 'editor.fontSize': 14 }).writes, []);
});

// ---- the table itself ----

test('every migration destination is a key the manifest actually declares', () => {
  for (const rule of MIGRATIONS) {
    assert.ok(DECLARED.includes(rule.target), `${rule.target} must be a declared setting`);
  }
});

test('no migration SOURCE may also be a destination — that would be a migration loop', () => {
  const targets = MIGRATIONS.map((r) => r.target);
  for (const rule of MIGRATIONS) {
    for (const source of rule.sources) {
      assert.ok(!targets.includes(source), `${source} is both migrated FROM and TO`);
    }
  }
});

test('scanKeys covers every declared key plus every id enumeration cannot reach', () => {
  const keys = scanKeys(DECLARED);
  for (const key of DECLARED) assert.ok(keys.includes(key), `${key} must be scanned`);
  for (const rule of MIGRATIONS) {
    assert.ok(keys.includes(rule.target));
    for (const source of rule.sources) assert.ok(keys.includes(source), `${source} must be scanned by name`);
    if (rule.shadowedBy) assert.ok(keys.includes(rule.shadowedBy));
  }
  for (const key of LEGACY_HONOURED_KEYS) assert.ok(keys.includes(key), `${key} must be read so it is recognised`);
  assert.equal(new Set(keys).size, keys.length, 'scanKeys must not repeat a key');
});

// ---- the whole point: a write is only ever planned deliberately ----

test('every planned write is either a removal or a value bound for a DECLARED key', () => {
  // VSCode refuses `update(unregisteredKey, <value>)` with ERROR_UNKNOWN_KEY but allows
  // `update(unregisteredKey, undefined)`. This is what keeps the plan inside that rule.
  const plan = buildMigrationPlan(DECLARED, {
    [OLD_DELEGATE_REVIEW_KEY]: true,
    [AUTO_RECYCLE_KEY]: true,
    'loopBoard.longGone': 1,
  });
  for (const write of plan.writes) {
    if (write.value === undefined) continue;
    assert.ok(DECLARED.includes(write.key), `${write.key} gets a VALUE, so it must be declared`);
  }
  assert.equal(plan.actions.length, 3);
});

test('every action carries a detail sentence naming what happens', () => {
  const plan = buildMigrationPlan(DECLARED, {
    [OLD_DELEGATE_REVIEW_KEY]: true,
    [AUTO_RECYCLE_KEY]: true,
    [CLEAR_SESSION_KEY]: true,
    'loopBoard.longGone': 1,
  });
  for (const action of plan.actions) {
    assert.equal(typeof action.detail, 'string');
    assert.ok(action.detail.length > 10, `${action.key} needs a readable detail line`);
  }
});
