'use strict';
// The Mutex serializes the store's read -> modify -> write cycles. These tests reproduce the
// t-rac1 lost-update race at the primitive level: overlapping async cycles against a shared cell
// lose updates without the Mutex, and are correct with it. Also covers ordering, result/error
// passthrough, and that one rejection does not break the chain for later callers.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Mutex } = require('../out-test/serialize.js');

const tick = () => new Promise((r) => setTimeout(r, 0));

// Mirror the store's cycle: read the shared value, await an async gap (the atomicWrite round
// trip), then write read+1. Concurrent cycles without serialization clobber each other.
async function racyIncrement(cell) {
  const read = cell.value;
  await tick();
  cell.value = read + 1;
}

test('without serialization concurrent read-modify-write loses updates (the bug)', async () => {
  const cell = { value: 0 };
  await Promise.all([racyIncrement(cell), racyIncrement(cell), racyIncrement(cell)]);
  assert.ok(cell.value < 3, `expected a lost update, got ${cell.value}`);
});

test('Mutex.run serializes the cycles so no update is lost', async () => {
  const m = new Mutex();
  const cell = { value: 0 };
  await Promise.all([
    m.run(() => racyIncrement(cell)),
    m.run(() => racyIncrement(cell)),
    m.run(() => racyIncrement(cell)),
  ]);
  assert.equal(cell.value, 3);
});

test('Mutex preserves enqueue order and never overlaps', async () => {
  const m = new Mutex();
  const log = [];
  let active = 0;
  const op = (id) =>
    m.run(async () => {
      active++;
      assert.equal(active, 1, 'operations must not overlap');
      log.push(`start-${id}`);
      await tick();
      log.push(`end-${id}`);
      active--;
    });
  await Promise.all([op('a'), op('b'), op('c')]);
  assert.deepEqual(log, ['start-a', 'end-a', 'start-b', 'end-b', 'start-c', 'end-c']);
});

test('Mutex.run returns the operation result', async () => {
  const m = new Mutex();
  const out = await m.run(async () => 42);
  assert.equal(out, 42);
});

test('a rejected op propagates to its caller but does not break the chain', async () => {
  const m = new Mutex();
  const boom = m.run(async () => {
    throw new Error('boom');
  });
  await assert.rejects(boom, /boom/);
  // A later op still runs and resolves normally.
  const after = await m.run(async () => 'ok');
  assert.equal(after, 'ok');
});

test('a later op still runs strictly after an earlier rejected one', async () => {
  const m = new Mutex();
  const log = [];
  const failing = m.run(async () => {
    log.push('first');
    await tick();
    throw new Error('nope');
  });
  const next = m.run(async () => {
    log.push('second');
  });
  await Promise.allSettled([failing, next]);
  assert.deepEqual(log, ['first', 'second']);
});
