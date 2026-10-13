'use strict';
// Task models + the orchestrator's own settings (t-c1a7, reshaped by t-0e99: one orchestrator loop
// replaced the per-model slots, so the slot keys became `orchestrator.*` with a read-both fallback).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  BUILTIN_MODEL_IDS,
  isValidModelString,
  resolveModels,
  enabledModels,
  readModelsConfig,
  sanitizeGroomConcurrency,
  EFFORT_LEVELS,
  TASK_EFFORT_LEVELS,
  isValidEffort,
  isModelValue,
  isGroomerValue,
  isReviewerValue,
  isEffortValue,
  LOOP_IDS,
  isLoopId,
  resolveOrchestrator,
  resolveTaskDefaults,
  resolveWorker,
  TASK_DEFAULTS,
  AFTER_TASK_MODES,
  resolveAfterTask,
  resolveHeldAfterTask,
} = require('../out-test/model.js');

// An explicit-value lookup over a plain object, the shape the host builds from inspect().
const lookup = (set) => (key) => set[key];

test('the built-in task models are opus/sonnet/fable/haiku (t-0e99: Haiku is a full peer)', () => {
  assert.deepEqual(BUILTIN_MODEL_IDS, ['opus', 'sonnet', 'fable', 'haiku']);
});

test('the only loop id is the orchestrator, and loop ids are validated at runtime', () => {
  assert.deepEqual(LOOP_IDS, ['orchestrator']);
  assert.ok(isLoopId('orchestrator'));
  for (const bad of ['opus', 'sonnet', 'fable', 'haiku', '', undefined, null, 'Orchestrator']) assert.ok(!isLoopId(bad), String(bad));
});

test('isValidModelString admits the [1m] suffix and org aliases, rejects shell metachars', () => {
  assert.ok(isValidModelString('opus'));
  assert.ok(isValidModelString('opus[1m]'));
  assert.ok(isValidModelString('claude-opus-4-8'));
  assert.ok(isValidModelString('my.org_alias-1'));
  assert.ok(!isValidModelString('opus; rm -rf'));
  assert.ok(!isValidModelString('opus $(x)'));
  assert.ok(!isValidModelString(''));
});

test('role value checks: model/groomer/reviewer/effort each accept exactly their listed values', () => {
  for (const m of ['opus', 'sonnet', 'fable', 'haiku', 'auto']) {
    assert.ok(isModelValue(m) && isGroomerValue(m) && isReviewerValue(m), m);
  }
  assert.ok(!isModelValue('none'), 'the worker has no none');
  assert.ok(isGroomerValue('none') && isReviewerValue('none'), 'groomer and reviewer do');
  for (const e of ['low', 'medium', 'high', 'xhigh', 'auto']) assert.ok(isEffortValue(e), e);
  assert.ok(!isEffortValue('max'), 'max is never a per-task effort');
  assert.deepEqual([...TASK_EFFORT_LEVELS], ['low', 'medium', 'high', 'xhigh']);
  for (const bad of ['', 'Opus', 'gpt', 'default (opus)', null, undefined, 3]) {
    assert.ok(!isModelValue(bad) && !isGroomerValue(bad) && !isReviewerValue(bad) && !isEffortValue(bad), String(bad));
  }
});

test('EFFORT_LEVELS / isValidEffort: the five ordered session stops, rejects garbage', () => {
  assert.deepEqual(EFFORT_LEVELS, ['low', 'medium', 'high', 'xhigh', 'max']);
  for (const e of EFFORT_LEVELS) assert.ok(isValidEffort(e), `${e} valid`);
  assert.ok(!isValidEffort('HIGH'), 'case-sensitive');
  assert.ok(!isValidEffort('extreme'));
  assert.ok(!isValidEffort(''));
});

test('resolveModels defaults: every model enabled, in BUILTIN_MODELS order', () => {
  const r = resolveModels(undefined);
  assert.deepEqual(r.map((m) => m.id), ['opus', 'sonnet', 'fable', 'haiku']);
  for (const m of r) assert.equal(m.enabled, true);
});

test('enabled: false drops a model from enabledModels', () => {
  const en = enabledModels({ fable: { enabled: false } });
  assert.deepEqual(en.map((m) => m.id), ['opus', 'sonnet', 'haiku']);
});

test('readModelsConfig maps the flat models.<id>.enabled keys into a ModelsConfig for resolveModels', () => {
  const store = { 'models.sonnet.enabled': false, 'models.haiku.enabled': false };
  const get = (k, d) => (k in store ? store[k] : d);
  const cfg = readModelsConfig(get);
  assert.equal(cfg.opus.enabled, true);
  assert.equal(cfg.sonnet.enabled, false);
  assert.deepEqual(enabledModels(cfg).map((m) => m.id), ['opus', 'fable']);
});

// ---- the orchestrator's own settings (t-0e99), with the read-both fallback ----

test('resolveOrchestrator defaults: opus, medium, groom cap 3', () => {
  assert.deepEqual(resolveOrchestrator(lookup({})), { model: 'opus', effort: 'medium', groomConcurrency: 3 });
});

test('a valid orchestrator --model REPLACES the default; an invalid or empty one falls back to opus', () => {
  assert.equal(resolveOrchestrator(lookup({ 'orchestrator.model': 'opus[1m]' })).model, 'opus[1m]');
  assert.equal(resolveOrchestrator(lookup({ 'orchestrator.model': 'sonnet; rm -rf /' })).model, 'opus');
  assert.equal(resolveOrchestrator(lookup({ 'orchestrator.model': '   ' })).model, 'opus');
});

test('a valid orchestrator effort REPLACES the default; invalid falls back to medium', () => {
  assert.equal(resolveOrchestrator(lookup({ 'orchestrator.effort': 'xhigh' })).effort, 'xhigh');
  assert.equal(resolveOrchestrator(lookup({ 'orchestrator.effort': 'max' })).effort, 'max', 'max stays a session level');
  assert.equal(resolveOrchestrator(lookup({ 'orchestrator.effort': 'extreme' })).effort, 'medium');
});

test('a valid orchestrator groomConcurrency REPLACES the default; invalid falls back to 3', () => {
  assert.equal(resolveOrchestrator(lookup({ 'orchestrator.groomConcurrency': 6 })).groomConcurrency, 6);
  for (const bad of [0, 2.5, 100, '4']) {
    assert.equal(resolveOrchestrator(lookup({ 'orchestrator.groomConcurrency': bad })).groomConcurrency, 3, String(bad));
  }
});

test('until migrated, the old Opus slot keys still steer the orchestrator; Sonnet/Fable slot keys never do', () => {
  const legacy = { 'models.opus.model': 'opus[1m]', 'models.opus.effort': 'high', 'models.opus.groomConcurrency': 5 };
  assert.deepEqual(resolveOrchestrator(lookup(legacy)), { model: 'opus[1m]', effort: 'high', groomConcurrency: 5 });
  const others = { 'models.sonnet.model': 'sonnet[1m]', 'models.fable.effort': 'xhigh', 'models.sonnet.groomConcurrency': 9 };
  assert.deepEqual(resolveOrchestrator(lookup(others)), { model: 'opus', effort: 'medium', groomConcurrency: 3 });
});

test('a set orchestrator key always wins over the legacy Opus slot key', () => {
  const both = {
    'orchestrator.model': 'sonnet', 'models.opus.model': 'opus[1m]',
    'orchestrator.effort': 'low', 'models.opus.effort': 'high',
    'orchestrator.groomConcurrency': 2, 'models.opus.groomConcurrency': 5,
  };
  assert.deepEqual(resolveOrchestrator(lookup(both)), { model: 'sonnet', effort: 'low', groomConcurrency: 2 });
});

test('sanitizeGroomConcurrency rejects everything that is not a plain in-range integer', () => {
  assert.equal(sanitizeGroomConcurrency(1), 1);
  assert.equal(sanitizeGroomConcurrency(99), 99);
  // No `0 = unlimited` sentinel: unbounded fan-out is the defect the cap removes.
  for (const bad of [0, -1, 1.5, 100, NaN, Infinity, '3', null, undefined, {}]) {
    assert.equal(sanitizeGroomConcurrency(bad), 3, `expected ${JSON.stringify(bad)} -> 3`);
  }
});

// ---- the five per-task defaults (t-0e99) ----

test('resolveTaskDefaults with nothing set: groomer opus, worker sonnet, efforts auto, reviewer none', () => {
  assert.deepEqual(resolveTaskDefaults(lookup({})), TASK_DEFAULTS);
  assert.deepEqual(TASK_DEFAULTS, { groomer: 'opus', groomerEffort: 'auto', worker: 'sonnet', workerEffort: 'auto', reviewer: 'none' });
});

test('set defaults are used; haiku and auto are valid models, an off-list value falls back', () => {
  const d = resolveTaskDefaults(lookup({
    defaultGroomerModel: 'auto', defaultGroomerEffort: 'xhigh', defaultWorkerModel: 'haiku',
    defaultWorkerEffort: 'low', defaultReviewerModel: 'fable',
  }));
  assert.deepEqual(d, { groomer: 'auto', groomerEffort: 'xhigh', worker: 'haiku', workerEffort: 'low', reviewer: 'fable' });
  const bad = resolveTaskDefaults(lookup({
    defaultGroomerModel: 'none', defaultGroomerEffort: 'max', defaultWorkerModel: 'gpt', defaultWorkerEffort: 'max', defaultReviewerModel: 'all',
  }));
  assert.deepEqual(bad, TASK_DEFAULTS);
});

test('the pre-split loopBoard.defaultModel still steers both default models while neither is set', () => {
  const d = resolveTaskDefaults(lookup({ defaultModel: 'fable' }));
  assert.equal(d.groomer, 'fable');
  assert.equal(d.worker, 'fable');
  assert.equal(resolveTaskDefaults(lookup({ defaultModel: 'fable', defaultWorkerModel: 'opus' })).worker, 'opus');
});

test('until migrated, delegateReview: true reads as reviewer auto; false or unset as none; a set reviewer wins', () => {
  assert.equal(resolveTaskDefaults(lookup({ delegateReview: true })).reviewer, 'auto');
  assert.equal(resolveTaskDefaults(lookup({ delegateReview: false })).reviewer, 'none');
  assert.equal(resolveTaskDefaults(lookup({})).reviewer, 'none');
  assert.equal(resolveTaskDefaults(lookup({ delegateReview: true, defaultReviewerModel: 'none' })).reviewer, 'none');
});

test('resolveWorker: a task own model/effort, else the worker defaults', () => {
  const d = { worker: 'sonnet', workerEffort: 'auto' };
  assert.deepEqual(resolveWorker({}, d), { model: 'sonnet', effort: 'auto' });
  assert.deepEqual(resolveWorker({ model: 'haiku', effort: 'high' }, d), { model: 'haiku', effort: 'high' });
});

// ---- afterTask: one 3-state mode replacing the recycle boolean pair (t-1f1e) ----

test('the after-task modes are exactly none/clear/recycle', () => {
  assert.deepEqual(AFTER_TASK_MODES, ['none', 'clear', 'recycle']);
});

test('an explicitly set afterTask always wins over the deprecated booleans', () => {
  assert.equal(resolveAfterTask('none', true, true), 'none');
  assert.equal(resolveAfterTask('clear', true, false), 'clear');
  assert.equal(resolveAfterTask('recycle', false, false), 'recycle');
});

test('with afterTask unset the legacy booleans map losslessly', () => {
  assert.equal(resolveAfterTask(undefined, false, false), 'none');
  assert.equal(resolveAfterTask(undefined, false, true), 'clear');
  assert.equal(resolveAfterTask(undefined, true, false), 'recycle');
  // autoRecycle already suppressed clearSessionAfterTask at the only call site, so the combination
  // has always meant "recycle" — the merge loses nothing.
  assert.equal(resolveAfterTask(undefined, true, true), 'recycle');
});

test('an unrecognized afterTask value falls back rather than disabling the feature', () => {
  assert.equal(resolveAfterTask('RECYCLE', true, false), 'recycle');
  assert.equal(resolveAfterTask('', false, true), 'clear');
  assert.equal(resolveAfterTask('nonsense', false, false), 'none');
});

test('a HELD afterTask action on a stopped loop is swallowed, never turned into a start', () => {
  // t-sbag: an afterTask recycle deferred by a live subagent waits indefinitely, so the human can
  // click ■ (or ♻, which disposes and respawns) in between. `TerminalManager.recycle` disposes
  // only IF a terminal exists but ALWAYS respawns 400 ms later — so firing a held recycle at a
  // stopped slot would start a fresh loop seconds after the human stopped it, and firing a second
  // one into a manual restart's respawn window would tear down the terminal it just created. Same
  // rule as `appliesTo` for scheduled actions: an action that no longer applies does NOTHING.
  assert.deepEqual(resolveHeldAfterTask('recycle', false), { act: 'skip', reason: 'not-running' });
  assert.deepEqual(resolveHeldAfterTask('clear', false), { act: 'skip', reason: 'not-running' });
  // ...and 'not-running' outranks 'off', so the log never explains a swallowed hold with the wrong
  // reason.
  assert.deepEqual(resolveHeldAfterTask('none', false), { act: 'skip', reason: 'not-running' });
});

test('a HELD afterTask action on a running loop performs the CURRENT mode', () => {
  // The mode is re-read at fire time rather than remembered: what is configured now is what should
  // happen now, and `none` drops the hold instead of acting on a setting the user has since turned
  // off. `clear` must also be gated on running — `clearSession` early-returns with no terminal,
  // which would otherwise log a success for something that did not happen.
  assert.deepEqual(resolveHeldAfterTask('recycle', true), { act: 'recycle' });
  assert.deepEqual(resolveHeldAfterTask('clear', true), { act: 'clear' });
  assert.deepEqual(resolveHeldAfterTask('none', true), { act: 'skip', reason: 'off' });
});

test('afterTask defaults to none with no config at all', () => {
  assert.equal(resolveAfterTask(undefined), 'none');
});
