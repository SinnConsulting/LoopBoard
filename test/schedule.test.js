const test = require('node:test');
const assert = require('node:assert');
const {
  PRESET_MINUTES, MAX_MINUTES, parseMinutes, armSchedule, delayUntilFire,
  mayFire, deferSchedule, afterFire, describeSchedule,
} = require('../out-test/schedule');

const NOW = 1000000;

test('PRESET_MINUTES are ascending positive integers', () => {
  assert.ok(PRESET_MINUTES.length > 0);
  for (const m of PRESET_MINUTES) assert.ok(Number.isInteger(m) && m > 0);
  for (let i = 1; i < PRESET_MINUTES.length; i++) assert.ok(PRESET_MINUTES[i] > PRESET_MINUTES[i - 1]);
});

test('parseMinutes accepts a positive whole number of minutes', () => {
  assert.strictEqual(parseMinutes('1'), 1);
  assert.strictEqual(parseMinutes('240'), 240);
  assert.strictEqual(parseMinutes('  90  '), 90);
});

test('parseMinutes rejects everything that is not a plain positive integer', () => {
  // Empty / non-numeric / decimals / signs / unit suffixes: the dialog speaks minutes only, so a
  // value like "90m" or "1.5" must be refused rather than silently reinterpreted.
  for (const bad of ['', '   ', '0', '-5', '+5', '1.5', '90m', '2h', 'abc', '1e3', '0x10', '1 2']) {
    assert.strictEqual(parseMinutes(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
  assert.strictEqual(parseMinutes(null), null);
  assert.strictEqual(parseMinutes(undefined), null);
});

test('parseMinutes rejects a value that would overflow setTimeout', () => {
  assert.strictEqual(parseMinutes(String(MAX_MINUTES)), MAX_MINUTES);
  assert.strictEqual(parseMinutes(String(MAX_MINUTES + 1)), null);
});

test('armSchedule sets nextFireAt N minutes out and starts un-pending', () => {
  const s = armSchedule('opus', 15, false, false, NOW);
  assert.deepStrictEqual(s, {
    model: 'opus', minutes: 15, repeat: false, force: false,
    nextFireAt: NOW + 15 * 60000, pending: false,
  });
});

test('delayUntilFire counts down and floors at 0 once due', () => {
  const s = armSchedule('opus', 10, false, false, NOW);
  assert.strictEqual(delayUntilFire(s, NOW), 10 * 60000);
  assert.strictEqual(delayUntilFire(s, NOW + 4 * 60000), 6 * 60000);
  // Armed in the past (e.g. the main thread stalled) fires on the next tick, never negative.
  assert.strictEqual(delayUntilFire(s, NOW + 99 * 60000), 0);
});

test('mayFire defers a non-forced restart only while its own model is In Progress', () => {
  const s = armSchedule('opus', 30, false, false, NOW);
  assert.strictEqual(mayFire(s, []), true);
  assert.strictEqual(mayFire(s, ['sonnet']), true, 'another model being busy is irrelevant');
  assert.strictEqual(mayFire(s, ['opus']), false);
});

test('mayFire ignores In Progress entirely when force is on', () => {
  const forced = armSchedule('opus', 30, false, true, NOW);
  assert.strictEqual(mayFire(forced, ['opus']), true);
});

test('deferSchedule marks pending and is idempotent', () => {
  const s = armSchedule('opus', 30, true, false, NOW);
  const once = deferSchedule(s);
  assert.strictEqual(once.pending, true);
  // At most one restart is ever pending per model — deferring again must not stack or re-create.
  assert.strictEqual(deferSchedule(once), once);
});

test('afterFire disarms a one-shot schedule', () => {
  assert.strictEqual(afterFire(armSchedule('opus', 15, false, false, NOW), NOW + 15 * 60000), null);
});

test('afterFire re-arms a repeating schedule from the moment it actually fired', () => {
  const s = deferSchedule(armSchedule('opus', 15, true, false, NOW));
  // Fired late (deferred while the task ran): the next interval starts now, not from the original
  // slot, so a long deferral can never produce a burst of catch-up restarts.
  const late = NOW + 60 * 60000;
  const next = afterFire(s, late);
  assert.strictEqual(next.nextFireAt, late + 15 * 60000);
  assert.strictEqual(next.pending, false, 'a re-armed schedule is no longer pending');
  assert.strictEqual(next.repeat, true);
});

test('describeSchedule reports the countdown, repeat and force', () => {
  const one = armSchedule('opus', 60, false, false, NOW);
  assert.strictEqual(describeSchedule(one, NOW), 'restart in 60m');
  assert.strictEqual(describeSchedule(one, NOW + 30 * 60000), 'restart in 30m');
  assert.strictEqual(describeSchedule(armSchedule('opus', 60, true, false, NOW), NOW), 'restart in 60m · every 60m');
  assert.strictEqual(describeSchedule(armSchedule('opus', 60, false, true, NOW), NOW), 'restart in 60m · force');
});

test('describeSchedule says it is waiting once deferred', () => {
  const s = deferSchedule(armSchedule('opus', 15, true, false, NOW));
  assert.strictEqual(describeSchedule(s, NOW + 99 * 60000), 'restart waiting for task · every 15m');
});
