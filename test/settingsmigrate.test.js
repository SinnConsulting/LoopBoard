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
  buildMigrationPlan, isOrphan, manualAckKeys, scanKeys, MIGRATIONS, LEGACY_HONOURED_KEYS,
  AFTER_TASK_KEY, AUTO_RECYCLE_KEY, CLEAR_SESSION_KEY,
  DELEGATE_WORK_KEY, DELEGATE_REVIEW_KEY, OLD_DELEGATE_REVIEW_KEY,
} = require('../out-test/settingsmigrate.js');
const { formKeys } = require('../out-test/settingsform.js');
const { resolveAfterTask } = require('../out-test/model.js');

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
  assert.equal(plan.manual, 0);
});

test('an empty config plans nothing', () => {
  const plan = buildMigrationPlan(DECLARED, {});
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.writes.length, 0);
});

// ---- category 1: renamed ----

test('a renamed key present alone is migrated to its new id and then removed', () => {
  const plan = buildMigrationPlan(DECLARED, { [OLD_DELEGATE_REVIEW_KEY]: false });
  const action = byKey(plan, OLD_DELEGATE_REVIEW_KEY);
  assert.equal(action.kind, 'migrate');
  assert.equal(action.reason, 'renamed');
  assert.equal(action.target, DELEGATE_REVIEW_KEY);
  assert.equal(action.targetValue, false);
  // Destination first, removal second — an interrupted run must never lose the value.
  assert.deepEqual(plan.writes, [
    { key: DELEGATE_REVIEW_KEY, value: false },
    { key: OLD_DELEGATE_REVIEW_KEY, value: undefined },
  ]);
});

test('a renamed key whose destination is already set is a conflict: reported, never written', () => {
  const plan = buildMigrationPlan(DECLARED, {
    [OLD_DELEGATE_REVIEW_KEY]: false,
    [DELEGATE_REVIEW_KEY]: true,
  });
  const action = byKey(plan, OLD_DELEGATE_REVIEW_KEY);
  assert.equal(action.kind, 'conflict');
  assert.equal(action.targetValue, true);
  assert.match(action.detail, /already set to true/);
  assert.deepEqual(plan.writes, [], 'a conflict must plan no write at all');
  assert.equal(plan.conflicts, 1);
});

test('a renamed key hidden behind its scalar parent is reported as a by-hand case, not silence', () => {
  // VSCode drops a child of a plain value, so with `loopBoard.delegateWork` set the old key cannot
  // be read at all. Reporting nothing would be a clean bill of health the API cannot actually give.
  const plan = buildMigrationPlan(DECLARED, { [DELEGATE_WORK_KEY]: true });
  const action = byKey(plan, OLD_DELEGATE_REVIEW_KEY);
  assert.equal(action.kind, 'manual');
  assert.equal(action.value, undefined);
  assert.match(action.detail, /cannot be read while loopBoard\.delegateWork is set/);
  assert.deepEqual(plan.writes, []);
  assert.equal(plan.manual, 1);
});

test('the by-hand report is not raised when the old key IS visible', () => {
  const plan = buildMigrationPlan(DECLARED, { [OLD_DELEGATE_REVIEW_KEY]: true });
  assert.equal(plan.manual, 0);
  assert.equal(byKey(plan, OLD_DELEGATE_REVIEW_KEY).kind, 'migrate');
});

// ---- acknowledging a by-hand report ----
// It is the one finding the scan can never see resolved (it exists BECAUSE the key is unreadable),
// so without this it would be listed on every scan of an already-clean config, forever.

test('an acknowledged by-hand report is not raised again', () => {
  const values = { [DELEGATE_WORK_KEY]: true };
  assert.equal(buildMigrationPlan(DECLARED, values, []).manual, 1, 'first scan must still say it');
  const plan = buildMigrationPlan(DECLARED, values, [OLD_DELEGATE_REVIEW_KEY]);
  assert.deepEqual(plan.actions, [], 'a clean config must report nothing at all once settled');
  assert.equal(plan.manual, 0);
  assert.deepEqual(plan.writes, []);
  assert.deepEqual(plan.staleAcks, [], 'nothing disproved it, so the acknowledgement stands');
});

test('an acknowledgement for another key does not silence the report', () => {
  const plan = buildMigrationPlan(DECLARED, { [DELEGATE_WORK_KEY]: true }, [AUTO_RECYCLE_KEY]);
  assert.equal(plan.manual, 1);
  assert.equal(byKey(plan, OLD_DELEGATE_REVIEW_KEY).kind, 'manual');
});

test('an acknowledgement can NEVER suppress a real, readable finding — and is revoked by it', () => {
  // Parent unset ⇒ the key is readable again. It is set after all, so the acknowledgement was
  // wrong: the migration is planned exactly as if it had never been given, and the host is told to
  // forget it so the advisory is armed again the next time the parent hides the key.
  const plan = buildMigrationPlan(DECLARED, { [OLD_DELEGATE_REVIEW_KEY]: false }, [OLD_DELEGATE_REVIEW_KEY]);
  const action = byKey(plan, OLD_DELEGATE_REVIEW_KEY);
  assert.equal(action.kind, 'migrate');
  assert.deepEqual(plan.writes, [
    { key: DELEGATE_REVIEW_KEY, value: false },
    { key: OLD_DELEGATE_REVIEW_KEY, value: undefined },
  ]);
  assert.deepEqual(plan.staleAcks, [OLD_DELEGATE_REVIEW_KEY]);
});

test('a conflict on an acknowledged key is reported too, and revokes the acknowledgement', () => {
  const plan = buildMigrationPlan(
    DECLARED,
    { [OLD_DELEGATE_REVIEW_KEY]: false, [DELEGATE_REVIEW_KEY]: true },
    [OLD_DELEGATE_REVIEW_KEY]
  );
  assert.equal(byKey(plan, OLD_DELEGATE_REVIEW_KEY).kind, 'conflict');
  assert.deepEqual(plan.staleAcks, [OLD_DELEGATE_REVIEW_KEY]);
});

test('a scan that CONFIRMS the key is gone keeps the acknowledgement', () => {
  // Readable (no shadowing parent) and absent: the claim is true, so re-setting the parent later
  // must not re-ask a question already answered.
  const plan = buildMigrationPlan(DECLARED, {}, [OLD_DELEGATE_REVIEW_KEY]);
  assert.deepEqual(plan.actions, []);
  assert.deepEqual(plan.staleAcks, []);
});

test('only a shadowed source is acknowledgeable at all', () => {
  const keys = manualAckKeys();
  assert.deepEqual(keys, MIGRATIONS.filter((r) => r.shadowedBy).map((r) => r.sources[0]));
  assert.ok(keys.includes(OLD_DELEGATE_REVIEW_KEY));
  // The host validates the webview's key against this list, so a message naming any other key —
  // including a perfectly ordinary migration source — must be refused.
  assert.equal(keys.includes(AUTO_RECYCLE_KEY), false);
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

// ---- category 3: orphans ----

test('an undeclared key nothing reads is planned for removal', () => {
  const plan = buildMigrationPlan(DECLARED, { 'loopBoard.customRules': ['a', 'b'] });
  const action = byKey(plan, 'loopBoard.customRules');
  assert.equal(action.kind, 'remove');
  assert.equal(action.reason, 'orphan');
  assert.deepEqual(plan.writes, [{ key: 'loopBoard.customRules', value: undefined }]);
});

test('a legacy key the code still honours is NOT an orphan', () => {
  // `readDefaultModel` falls back to `loopBoard.defaultModel`; removing it would change which model
  // a pre-split config spawns.
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
