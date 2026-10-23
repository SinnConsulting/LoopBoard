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
  isModel,
  isGroomerValue,
  isReviewerValue,
  isTaskEffort,
  sanitizeEffortRange,
  clampEffort,
  isNarrowed,
  aliasEnv,
  aliasEnvVar,
  effortRangeOf,
  LOOP_IDS,
  isLoopId,
  resolveOrchestrator,
  resolveTaskDefaults,
  resolveWorker,
  TASK_DEFAULTS,
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
  for (const m of ['opus', 'sonnet', 'fable', 'haiku']) {
    assert.ok(isModel(m) && isGroomerValue(m) && isReviewerValue(m), m);
  }
  assert.ok(!isModel('none'), 'the worker has no none');
  assert.ok(isGroomerValue('none') && isReviewerValue('none'), 'groomer and reviewer do');
  for (const e of ['low', 'medium', 'high', 'xhigh']) assert.ok(isTaskEffort(e), e);
  assert.ok(!isTaskEffort('max'), 'max is never a per-task effort');
  assert.deepEqual([...TASK_EFFORT_LEVELS], ['low', 'medium', 'high', 'xhigh']);
  // `auto` is no value of any role since the owner decision of 2026-10-14.
  for (const bad of ['', 'auto', 'Opus', 'gpt', 'default (opus)', null, undefined, 3]) {
    assert.ok(!isModel(bad) && !isGroomerValue(bad) && !isReviewerValue(bad) && !isTaskEffort(bad), String(bad));
  }
  assert.equal(require('../out-test/model.js').AUTO, undefined, 'the AUTO constant is gone');
});

test('EFFORT_LEVELS / isValidEffort: the five ordered session stops, rejects garbage', () => {
  assert.deepEqual(EFFORT_LEVELS, ['low', 'medium', 'high', 'xhigh', 'max']);
  for (const e of EFFORT_LEVELS) assert.ok(isValidEffort(e), `${e} valid`);
  assert.ok(!isValidEffort('HIGH'), 'case-sensitive');
  assert.ok(!isValidEffort('extreme'));
  assert.ok(!isValidEffort(''));
});

test('resolveModels defaults: Opus and Haiku on, Sonnet and Fable off, in BUILTIN_MODELS order (t-0e99 FB12)', () => {
  const r = resolveModels(undefined);
  assert.deepEqual(r.map((m) => m.id), ['opus', 'sonnet', 'fable', 'haiku']);
  assert.deepEqual(r.map((m) => m.enabled), [true, false, false, true]);
  assert.deepEqual(r.map((m) => [m.minEffort, m.maxEffort]), [['low', 'xhigh'], ['low', 'max'], ['low', 'max'], ['low', 'max']]);
  assert.deepEqual(r.map((m) => m.modelId), ['', '', '', '']);
});

test('enabled: false drops a model from enabledModels; enabled: true brings an off-by-default one back', () => {
  assert.deepEqual(enabledModels({ fable: { enabled: false } }).map((m) => m.id), ['opus', 'haiku']);
  assert.deepEqual(enabledModels({ sonnet: { enabled: true }, haiku: { enabled: false } }).map((m) => m.id), ['opus', 'sonnet']);
});

test('readModelsConfig maps the flat models.<id>.enabled keys into a ModelsConfig for resolveModels', () => {
  const store = { 'models.sonnet.enabled': true, 'models.haiku.enabled': false };
  const get = (k, d) => (k in store ? store[k] : d);
  const cfg = readModelsConfig(get);
  assert.equal(cfg.opus.enabled, true);
  assert.equal(cfg.sonnet.enabled, true);
  assert.equal(cfg.fable.enabled, false, 'unset = the shipped default');
  assert.deepEqual(enabledModels(cfg).map((m) => m.id), ['opus', 'sonnet']);
});

// ---- per-model model id and effort floor/ceiling (t-0e99 FB4, FB7) ----

test('resolveModels: model id and effort range per model; unset or invalid = the alias and the shipped range', () => {
  const store = {
    'models.opus.modelId': 'claude-opus-5-5[1m]', 'models.sonnet.modelId': 'x; rm -rf /',
    'models.haiku.minEffort': 'medium', 'models.haiku.maxEffort': 'xhigh',
    'models.fable.minEffort': 'xhigh', 'models.fable.maxEffort': 'low',
    'models.sonnet.minEffort': 'extreme',
  };
  const r = resolveModels(readModelsConfig((k, d) => (k in store ? store[k] : d)));
  const by = Object.fromEntries(r.map((m) => [m.id, m]));
  assert.equal(by.opus.modelId, 'claude-opus-5-5[1m]');
  assert.equal(by.sonnet.modelId, '', 'an invalid id is dropped, never spawned');
  assert.deepEqual([by.haiku.minEffort, by.haiku.maxEffort], ['medium', 'xhigh']);
  assert.deepEqual([by.fable.minEffort, by.fable.maxEffort], ['low', 'max'], 'an inverted pair reads as the shipped range');
  assert.deepEqual([by.sonnet.minEffort, by.sonnet.maxEffort], ['low', 'max'], 'an invalid floor reads as unset');
  assert.deepEqual([by.opus.minEffort, by.opus.maxEffort], ['low', 'xhigh'], 'Opus ships capped at xhigh');
  assert.ok(isNarrowed(by.haiku) && isNarrowed(by.opus) && !isNarrowed(by.fable));
  const inverted = resolveModels({ opus: { minEffort: 'max' } }).find((m) => m.id === 'opus');
  assert.deepEqual([inverted.minEffort, inverted.maxEffort], ['low', 'xhigh'], 'a floor above the default ceiling falls back to the default range');
});

test('clampEffort raises to the floor and lowers to the ceiling; sanitizeEffortRange guards the pair', () => {
  const r = sanitizeEffortRange('medium', 'high');
  assert.equal(clampEffort('low', r), 'medium');
  assert.equal(clampEffort('medium', r), 'medium');
  assert.equal(clampEffort('high', r), 'high');
  assert.equal(clampEffort('max', r), 'high');
  assert.deepEqual(sanitizeEffortRange(undefined, undefined), { minEffort: 'low', maxEffort: 'max' });
  assert.deepEqual(sanitizeEffortRange('max', 'low'), { minEffort: 'low', maxEffort: 'max' });
  for (const e of EFFORT_LEVELS) assert.equal(clampEffort(e, sanitizeEffortRange()), e, 'the full range clamps nothing');
});

test('aliasEnv points each overridden alias at its model id through the CLI env var; none set = no env', () => {
  assert.equal(aliasEnvVar('haiku'), 'ANTHROPIC_DEFAULT_HAIKU_MODEL');
  assert.deepEqual(aliasEnv(resolveModels(undefined)), {});
  const r = resolveModels({ opus: { modelId: 'claude-opus-5-5[1m]' }, fable: { modelId: '$(evil)' } });
  assert.deepEqual(aliasEnv(r), { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5[1m]' });
});

test('until migrated, an old per-slot --model string is read as that model id; the bare alias carries nothing', () => {
  const set = (k) => ({ 'models.opus.model': 'claude-opus-5-5[1m]', 'models.sonnet.model': 'sonnet' })[k];
  const cfg = readModelsConfig((k, d) => d, set);
  assert.equal(cfg.opus.modelId, 'claude-opus-5-5[1m]');
  assert.equal(cfg.sonnet.modelId, '');
  const newer = readModelsConfig((k, d) => (k === 'models.opus.modelId' ? 'claude-opus-5-5' : d), set);
  assert.equal(newer.opus.modelId, 'claude-opus-5-5', 'the new key wins');
});

// ---- the orchestrator's own settings (t-0e99), with the read-both fallback ----

test('resolveOrchestrator defaults: opus, low, groom cap 3 (owner decision 2026-10-14, t-0e99 feedback)', () => {
  assert.deepEqual(resolveOrchestrator(lookup({})), { model: 'opus', effort: 'low', groomConcurrency: 3 });
});

test('the orchestrator model is one of the four aliases; anything else falls back to opus', () => {
  assert.equal(resolveOrchestrator(lookup({ 'orchestrator.model': 'haiku' })).model, 'haiku');
  for (const bad of ['opus[1m]', 'sonnet; rm -rf /', '   ', 'auto', 3]) {
    assert.equal(resolveOrchestrator(lookup({ 'orchestrator.model': bad })).model, 'opus', String(bad));
  }
});

test('a valid orchestrator effort REPLACES the default; invalid falls back to low', () => {
  assert.equal(resolveOrchestrator(lookup({ 'orchestrator.effort': 'xhigh' })).effort, 'xhigh');
  assert.equal(resolveOrchestrator(lookup({ 'orchestrator.effort': 'max' })).effort, 'max', 'max stays a session level');
  assert.equal(resolveOrchestrator(lookup({ 'orchestrator.effort': 'extreme' })).effort, 'low');
});

test('a valid orchestrator groomConcurrency REPLACES the default; invalid falls back to 3', () => {
  assert.equal(resolveOrchestrator(lookup({ 'orchestrator.groomConcurrency': 6 })).groomConcurrency, 6);
  for (const bad of [0, 2.5, 100, '4']) {
    assert.equal(resolveOrchestrator(lookup({ 'orchestrator.groomConcurrency': bad })).groomConcurrency, 3, String(bad));
  }
});

test('until migrated, the old Opus slot effort and cap still steer the orchestrator; its model string and the Sonnet/Fable keys never do', () => {
  const legacy = { 'models.opus.model': 'opus[1m]', 'models.opus.effort': 'high', 'models.opus.groomConcurrency': 5 };
  assert.deepEqual(resolveOrchestrator(lookup(legacy)), { model: 'opus', effort: 'high', groomConcurrency: 5 });
  const others = { 'models.sonnet.model': 'sonnet[1m]', 'models.fable.effort': 'xhigh', 'models.sonnet.groomConcurrency': 9 };
  assert.deepEqual(resolveOrchestrator(lookup(others)), { model: 'opus', effort: 'low', groomConcurrency: 3 });
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

test('resolveTaskDefaults with nothing set: groomer, worker and reviewer opus, efforts medium (owner decision 2026-10-14)', () => {
  assert.deepEqual(resolveTaskDefaults(lookup({})), TASK_DEFAULTS);
  assert.deepEqual(TASK_DEFAULTS, { groomer: 'opus', groomerEffort: 'medium', worker: 'opus', workerEffort: 'medium', reviewer: 'opus' });
  // Every role default sits on a model that ships on.
  const on = resolveModels(undefined).filter((m) => m.enabled).map((m) => m.id);
  for (const m of [TASK_DEFAULTS.groomer, TASK_DEFAULTS.worker, TASK_DEFAULTS.reviewer, resolveOrchestrator(lookup({})).model]) assert.ok(on.includes(m), m);
});

test('set defaults are used; haiku is a valid model and max a valid role effort; auto and off-list values fall back', () => {
  const d = resolveTaskDefaults(lookup({
    defaultGroomerModel: 'fable', defaultGroomerEffort: 'xhigh', defaultWorkerModel: 'haiku',
    defaultWorkerEffort: 'max', defaultReviewerModel: 'fable',
  }));
  assert.deepEqual(d, { groomer: 'fable', groomerEffort: 'xhigh', worker: 'haiku', workerEffort: 'max', reviewer: 'fable' });
  const bad = resolveTaskDefaults(lookup({
    defaultGroomerModel: 'auto', defaultGroomerEffort: 'auto', defaultWorkerModel: 'gpt', defaultWorkerEffort: 'extreme', defaultReviewerModel: 'auto',
  }));
  assert.deepEqual(bad, TASK_DEFAULTS);
});

test('the pre-split loopBoard.defaultModel steers only the worker, never the groomer (t-403e)', () => {
  const d = resolveTaskDefaults(lookup({ defaultModel: 'fable' }));
  assert.equal(d.groomer, 'opus');
  assert.equal(d.worker, 'fable');
  assert.equal(resolveTaskDefaults(lookup({ defaultModel: 'fable', defaultWorkerModel: 'opus' })).worker, 'opus');
});

test('worker keys never steer the groomer default (t-403e)', () => {
  const d = resolveTaskDefaults(lookup({ defaultWorkerModel: 'sonnet', defaultWorkerEffort: 'high' }));
  assert.equal(d.groomer, 'opus');
  assert.equal(d.groomerEffort, 'medium');
});

test('an explicit defaultGroomerModel wins; an invalid one falls back to TASK_DEFAULTS, not defaultModel (t-403e)', () => {
  assert.equal(resolveTaskDefaults(lookup({ defaultModel: 'fable', defaultGroomerModel: 'sonnet' })).groomer, 'sonnet');
  assert.equal(resolveTaskDefaults(lookup({ defaultModel: 'fable', defaultGroomerModel: 'gpt' })).groomer, TASK_DEFAULTS.groomer);
});

test('until migrated, delegateReview: true reads as reviewer opus, an explicit false as none, unset as the default; a set reviewer wins', () => {
  assert.equal(resolveTaskDefaults(lookup({ delegateReview: true })).reviewer, 'opus');
  assert.equal(resolveTaskDefaults(lookup({ delegateReview: false })).reviewer, 'none', 'an explicit opt-out survives the new review default');
  assert.equal(resolveTaskDefaults(lookup({})).reviewer, 'opus');
  assert.equal(resolveTaskDefaults(lookup({ delegateReview: true, defaultReviewerModel: 'none' })).reviewer, 'none');
});

test('resolveWorker: a task own model/effort, else the worker defaults, clamped into the model range (FB7)', () => {
  const d = { worker: 'sonnet', workerEffort: 'max' };
  assert.deepEqual(resolveWorker({}, d), { model: 'sonnet', effort: 'max' });
  assert.deepEqual(resolveWorker({ model: 'haiku', effort: 'high' }, d), { model: 'haiku', effort: 'high' });
  const models = resolveModels({ sonnet: { maxEffort: 'xhigh' }, haiku: { minEffort: 'xhigh' } });
  assert.deepEqual(resolveWorker({}, d, models), { model: 'sonnet', effort: 'xhigh' }, 'the default is lowered to the ceiling');
  assert.deepEqual(resolveWorker({ model: 'haiku', effort: 'low' }, d, models), { model: 'haiku', effort: 'xhigh' }, 'the task value is raised to the floor');
  assert.deepEqual(effortRangeOf(models, 'opus'), { minEffort: 'low', maxEffort: 'xhigh' }, 'the shipped Opus range');
  assert.deepEqual(effortRangeOf([], 'opus'), { minEffort: 'low', maxEffort: 'max' }, 'no model data = no clamp');
});

// ---- afterTask is gone (t-0e99 FB13): no mode, no held action, no read-both of the old pair ----

test('the after-task recycle/clear left the model: no AfterTask mode or resolver remains', () => {
  const model = require('../out-test/model.js');
  for (const name of ['AFTER_TASK_MODES', 'resolveAfterTask', 'resolveHeldAfterTask']) assert.equal(model[name], undefined, name);
});
