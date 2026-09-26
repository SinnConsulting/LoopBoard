'use strict';
// Idle stop (t-2dd4): the pure idle clock in src/idle.ts. Idle = the slot is NOT in the
// controller's `busyModels` (In-Progress owners ∪ slots with a live subagent), and nothing else.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  IDLE_WARN_MS, DEFAULT_IDLE_MINUTES, sanitizeIdleMinutes, resetIdle, observeIdle, idleWarnAt, idleStopAt,
  markWarned, keepRunning, describeIdle, describeIdleStop, decideIdleWarn, decideIdleStop,
} = require('../out-test/idle');
const { MAX_MINUTES } = require('../out-test/schedule');

const NOW = 10_000_000;
const MIN = 60000;

test('the clock starts when the slot is not busy and no clock is running', () => {
  assert.deepEqual(observeIdle(resetIdle(), 'opus', [], NOW), { idleSince: NOW, warnedAt: undefined });
});

test('the clock clears when the slot is busy — a task in progress or a live subagent alike', () => {
  // `busy` is `busyModels`, which already unions both signals; the module only sees the set.
  const running = { idleSince: NOW, warnedAt: undefined };
  assert.deepEqual(observeIdle(running, 'opus', ['opus'], NOW + MIN), resetIdle());
  // An open warning is cleared too: a slot that turns busy during the 30 s is not stopped.
  const warned = { idleSince: NOW, warnedAt: NOW + 59 * MIN };
  assert.deepEqual(observeIdle(warned, 'opus', ['opus'], NOW + 59 * MIN + 1000), resetIdle());
  // Busy with no clock stays no clock — never a clock started while busy.
  assert.deepEqual(observeIdle(resetIdle(), 'opus', ['opus', 'sonnet'], NOW), resetIdle());
});

test('repeated idle observations leave the clock unchanged (a /loop tick does not restart it)', () => {
  const first = observeIdle(resetIdle(), 'opus', [], NOW);
  const second = observeIdle(first, 'opus', [], NOW + 5 * MIN);
  const third = observeIdle(second, 'opus', [], NOW + 30 * MIN);
  assert.equal(third.idleSince, NOW);
  assert.equal(third, first, 'an unchanged state is returned as is');
  // An open warning survives an idle observation as well.
  const warned = markWarned(first, NOW + 59 * MIN + 30000);
  assert.equal(observeIdle(warned, 'opus', [], NOW + 59 * MIN + 40000), warned);
});

test('another model in the busy set does not affect this slot\'s clock', () => {
  const running = observeIdle(resetIdle(), 'opus', ['sonnet'], NOW);
  assert.equal(running.idleSince, NOW, 'sonnet busy does not hold opus');
  assert.equal(observeIdle(running, 'opus', ['sonnet', 'fable'], NOW + MIN).idleSince, NOW);
});

test('idleWarnAt is 30 s before `minutes`, idleStopAt is 30 s after the warning', () => {
  const s = { idleSince: NOW, warnedAt: undefined };
  assert.equal(IDLE_WARN_MS, 30000);
  assert.equal(idleWarnAt(s, 60), NOW + 60 * MIN - 30000);
  assert.equal(idleWarnAt(s, 2), NOW + 90000, 'minutes: 2 warns after 90 s');
  assert.equal(idleStopAt(s), undefined, 'no warning, no stop');
  const warned = markWarned(s, NOW + 90000);
  assert.equal(idleStopAt(warned), NOW + 120000);
  assert.equal(idleWarnAt(resetIdle(), 60), undefined, 'no clock, no warning');
});

test('keepRunning restarts the clock from now; resetIdle clears everything', () => {
  const warned = markWarned({ idleSince: NOW, warnedAt: undefined }, NOW + 59.5 * MIN);
  assert.deepEqual(keepRunning(warned, NOW + 59.6 * MIN), { idleSince: NOW + 59.6 * MIN, warnedAt: undefined });
  assert.deepEqual(resetIdle(), { idleSince: undefined, warnedAt: undefined });
});

test('sanitizeIdleMinutes keeps a valid whole number and maps anything else to 60', () => {
  assert.equal(DEFAULT_IDLE_MINUTES, 60);
  for (const ok of [1, 2, 60, 240, MAX_MINUTES]) assert.equal(sanitizeIdleMinutes(ok), ok);
  for (const bad of [0, -1, 1.5, MAX_MINUTES + 1, NaN, Infinity, '30', null, undefined, true, {}]) {
    assert.equal(sanitizeIdleMinutes(bad), 60, `${String(bad)} must fall back to 60`);
  }
});

test('describeIdle wording: idle minutes and the stop mark, then the 30 s countdown', () => {
  const s = { idleSince: NOW, warnedAt: undefined };
  assert.equal(describeIdle(s, 60, NOW), 'idle 0m · stop at 60m');
  assert.equal(describeIdle(s, 60, NOW + 12 * MIN + 59000), 'idle 12m · stop at 60m');
  const warned = markWarned(s, NOW + 59.5 * MIN);
  assert.equal(describeIdle(warned, 60, NOW + 59.5 * MIN), 'stopping in 30s');
  assert.equal(describeIdle(warned, 60, NOW + 59.5 * MIN + 20500), 'stopping in 10s');
  assert.equal(describeIdle(warned, 60, NOW + 61 * MIN), 'stopping in 0s', 'never negative');
  assert.equal(describeIdle(resetIdle(), 60, NOW), '', 'no clock draws no line');
});

test('describeIdleStop states the basis and names the fail-open of an unreadable session', () => {
  const s = { idleSince: NOW, warnedAt: NOW + 59.5 * MIN };
  assert.equal(describeIdleStop(s, NOW + 60 * MIN, false), 'idle 60m — no task in progress, no live subagents seen');
  const failOpen = describeIdleStop(s, NOW + 60 * MIN, true);
  assert.match(failOpen, /^idle 60m — no task in progress, no live subagents seen \(session unreadable/);
  assert.match(failOpen, /fail-open/);
});

const ctx = (over) => ({ enabled: true, running: true, busy: false, minutes: 60, now: NOW + 59.5 * MIN, ...over });

test('warning timer: warns when due, never while busy, re-arms after a minutes increase', () => {
  const s = { idleSince: NOW, warnedAt: undefined };
  assert.deepEqual(decideIdleWarn(s, ctx()), { act: 'warn' });
  assert.deepEqual(decideIdleWarn(s, ctx({ busy: true })), { act: 'hold' }, 'a claim or a subagent raced the timer');
  assert.deepEqual(decideIdleWarn(s, ctx({ minutes: 90 })), { act: 'rearm', at: NOW + 90 * MIN - 30000 });
});

test('warning timer: a feature switched off (even with the settings page closed) or a closed loop drops the clock', () => {
  const s = { idleSince: NOW, warnedAt: undefined };
  assert.deepEqual(decideIdleWarn(s, ctx({ enabled: false })), { act: 'reset', reason: 'disabled' });
  assert.deepEqual(decideIdleWarn(s, ctx({ running: false })), { act: 'reset', reason: 'loop is not running' });
});

test('stop: goes ahead only for the same warning on a still-idle, running, enabled slot', () => {
  const stamp = NOW + 59.5 * MIN;
  const warned = { idleSince: NOW, warnedAt: stamp };
  assert.equal(decideIdleStop(warned, stamp, ctx({ now: stamp + 30000 })), 'stop');
  // Turned busy during the 30 s, by either signal (busyModels carries both) → never stopped.
  assert.equal(decideIdleStop(warned, stamp, ctx({ busy: true })), 'hold');
  // Recycled / stopped / closed / feature off during the 30 s → a late answer is ignored.
  assert.equal(decideIdleStop(undefined, stamp, ctx()), 'superseded');
  assert.equal(decideIdleStop({ idleSince: stamp + 1000, warnedAt: stamp + 5000 }, stamp, ctx()), 'superseded', 'a newer warning is not this one');
  assert.equal(decideIdleStop({ idleSince: stamp + 1000, warnedAt: undefined }, stamp, ctx()), 'superseded', 'kept running since');
  assert.equal(decideIdleStop(warned, stamp, ctx({ enabled: false })), 'superseded');
  assert.equal(decideIdleStop(warned, stamp, ctx({ running: false })), 'superseded');
});

test('src/idle.ts imports neither vscode nor node typings', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'idle.ts'), 'utf8');
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./model', './schedule']);
  assert.ok(!/require\(|node:/.test(src.replace(/\/\/.*$/gm, '')), 'no node module use');
});

// The controller touches vscode, so the Docker suite cannot run it; these pin its wiring as source
// text (the t-2047 technique in test/manifest-settings.test.js).
const controller = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.ts'), 'utf8');
function methodBody(name) {
  const start = Math.max(controller.indexOf(`  private ${name}(`), controller.indexOf(`  private async ${name}(`));
  assert.ok(start >= 0, `src/controller.ts must define ${name}`);
  let depth = 0;
  for (let i = controller.indexOf('{', controller.indexOf(')', start)); i < controller.length; i++) {
    if (controller[i] === '{') depth++;
    else if (controller[i] === '}' && --depth === 0) return controller.slice(start, i + 1);
  }
  throw new Error('unbalanced ' + name);
}

test('the ■ button and the idle stop call the same stopLoop, which cancels, clears and disposes', () => {
  const body = methodBody('stopLoop');
  const order = ['clearContextTrip(', 'cancelRestart(', 'resetIdleClock(', 'terminals.stop('].map((s) => body.indexOf(s));
  for (const at of order) assert.ok(at > 0, body);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'trip, schedule, clock, then the terminal');
  const handler = controller.slice(controller.indexOf("case 'stopLoop':"), controller.indexOf("case 'armRestart':"));
  assert.match(handler, /this\.stopLoop\(msg\.model,/);
  assert.ok(!handler.includes('terminals.stop('), 'the ■ handler must not stop the terminal on its own');
  assert.match(methodBody('onIdleStopDue'), /this\.stopLoop\(model, 'idle stop'/);
  // No other path disposes a terminal on its own except the scheduled stop (t-77d1), which stays.
  assert.equal([...controller.matchAll(/this\.terminals\.stop\(/g)].length, 2);
});

test('idle is busyModels: the observation, both fire-time checks and the poll all read it', () => {
  assert.match(methodBody('observeIdleClocks'), /this\.busyModels\(board\)/);
  assert.match(methodBody('idleFireContext'), /this\.busyModels\(this\.lastBoard\)/);
  // A hold during the warning is logged with describeBusy's reason.
  assert.match(methodBody('observeIdleClocks'), /'idle-hold'/);
  assert.match(methodBody('observeIdleClocks'), /this\.describeBusy\(model, board\)/);
  assert.match(methodBody('onIdleStopDue'), /'idle-hold', `\$\{model\} — \$\{this\.idleBusyReason\(model\)\}/);
  assert.match(methodBody('idleBusyReason'), /this\.describeBusy\(model, this\.lastBoard\)/);
  // The context poll observes after the busyChanged flushes, with no .loopboard/ write involved.
  const poll = methodBody('pollContextOnce');
  const flushes = poll.indexOf('if (busyChanged && this.lastBoard)');
  const observe = poll.indexOf('this.observeIdleClocks(this.lastBoard)');
  assert.ok(flushes > 0 && observe > flushes, 'the poll must observe the idle clocks after the busyChanged flushes');
  assert.match(controller.slice(controller.indexOf('async refresh('), controller.indexOf('openBoard()')), /this\.observeIdleClocks\(board\)/);
});

test('the idle-stop line names the fail-open, and the feature off leaves no state behind', () => {
  assert.match(methodBody('onIdleStopDue'), /describeIdleStop\(.*this\.agentsUnreadable\.has\(model\)\)/);
  const observe = methodBody('observeIdleClocks');
  assert.ok(observe.indexOf('if (!cfg.idleStopEnabled)') < observe.indexOf('this.busyModels('), 'the off check comes first');
  assert.match(controller, /l\.idle = idleLabel \?/);
  assert.match(controller, /const idle = cfg\.idleStopEnabled && l\.running \?/);
  assert.match(controller.slice(controller.indexOf('  dispose(): void {'), controller.indexOf('  private config()')), /clearIdleTimer/);
});
