'use strict';
// Context-usage measurement (t-2b89). The file layouts under ~/.claude are internal to Claude Code
// and known only by observation, so these tests pin the SHAPE we parse and — just as important —
// that anything unexpected yields "no measurement" instead of a wrong number or a throw.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  sessionName, encodeProjectDir, windowSizeFor, DEFAULT_WINDOW, LARGE_WINDOW,
  parseSessionPointer, matchesSlot, parseTranscriptUsage, contextPercent, describeContext,
  sanitizeContextAction, sanitizeContextPercent, shouldTrip,
} = require('../out-test/context.js');

const CWD = '/Users/x/LoopBoard';

function assistantLine(usage, extra) {
  return JSON.stringify(Object.assign({ type: 'assistant', isSidechain: false, message: { model: 'claude-opus-5', usage } }, extra || {}));
}

test('sessionName is the slot-derived --name the spawn line carries', () => {
  assert.equal(sessionName('opus'), 'loopboard-opus');
  assert.equal(sessionName('fable'), 'loopboard-fable');
});

test('encodeProjectDir folds every separator to a dash', () => {
  assert.equal(encodeProjectDir(CWD), '-Users-x-LoopBoard');
  // Windows shape is unverified in the wild; pin what we send so a future fix has a baseline.
  assert.equal(encodeProjectDir('C:\\Users\\x\\LoopBoard'), 'C--Users-x-LoopBoard');
});

// The window is nowhere on disk, so it is derived from the model id — and the `[1m]` suffix alone
// is NOT the test: a live `--model sonnet` loop reported `61k/1000k`, because the 5-series models
// are natively 1M. Assuming 200k there reported 24% for a real 6% and would have tripped a
// threshold restart four times too early (t-2b89 review feedback).
test('window size: 5-series models are 1M with no suffix, older ones are 200k', () => {
  assert.equal(windowSizeFor('sonnet'), LARGE_WINDOW, 'the bare alias is today Sonnet 5');
  assert.equal(windowSizeFor('opus'), LARGE_WINDOW);
  assert.equal(windowSizeFor('fable'), LARGE_WINDOW);
  assert.equal(windowSizeFor('claude-sonnet-4-5'), DEFAULT_WINDOW);
  assert.equal(windowSizeFor('claude-opus-4-1'), DEFAULT_WINDOW);
  assert.equal(windowSizeFor('haiku-4-5'), DEFAULT_WINDOW);
});

test('an explicit [1m] suffix always means the 1M window', () => {
  assert.equal(windowSizeFor('claude-sonnet-4-5[1m]'), LARGE_WINDOW);
  assert.equal(windowSizeFor('sonnet[1M]'), LARGE_WINDOW);
});

test("the transcript's own model id wins over the configured --model string", () => {
  // The slot spawned as `sonnet`; the line we measured says what actually ran.
  assert.equal(windowSizeFor('sonnet', 'claude-sonnet-4-5'), DEFAULT_WINDOW);
  assert.equal(windowSizeFor('some-org-alias', 'claude-opus-5'), LARGE_WINDOW);
  assert.equal(windowSizeFor('some-org-alias', ''), DEFAULT_WINDOW, 'an unknown id stays conservative');
});

test('parseSessionPointer keeps identity fields and rejects anything else', () => {
  const p = parseSessionPointer(JSON.stringify({ pid: 1, sessionId: 's1', cwd: CWD, name: 'loopboard-opus', status: 'busy' }));
  assert.deepEqual(p, { sessionId: 's1', cwd: CWD, name: 'loopboard-opus' });
  assert.equal(parseSessionPointer('not json'), undefined);
  assert.equal(parseSessionPointer(JSON.stringify({ cwd: CWD })), undefined, 'no sessionId -> no pointer');
});

test('a slot is matched by name AND cwd — cwd alone cannot separate two loops', () => {
  const base = { sessionId: 's1', cwd: CWD, name: 'loopboard-opus' };
  assert.equal(matchesSlot(base, CWD, 'opus'), true);
  assert.equal(matchesSlot(base, CWD, 'sonnet'), false, 'same cwd, different slot');
  assert.equal(matchesSlot(base, '/other', 'opus'), false, 'another workspace');
  assert.equal(matchesSlot({ ...base, name: '' }, CWD, 'opus'), false, 'a session spawned without --name');
});

test('usage = the LAST main-chain assistant line, summing the three input counters', () => {
  const tail = [
    '',
    assistantLine({ input_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 1, output_tokens: 999 }),
    assistantLine({ input_tokens: 32, cache_read_input_tokens: 49840, cache_creation_input_tokens: 5888, output_tokens: 302 }),
  ].join('\n');
  assert.deepEqual(parseTranscriptUsage(tail, true), { used: 55760, model: 'claude-opus-5' });
});

test('sidechain (subagent) lines are skipped — their usage is a different context', () => {
  const tail = [
    assistantLine({ input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    assistantLine({ input_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, { isSidechain: true }),
  ].join('\n');
  assert.equal(parseTranscriptUsage(tail, true).used, 100);
});

test('user lines, unparseable lines and an empty transcript never produce a number', () => {
  assert.equal(parseTranscriptUsage('', true), undefined);
  assert.equal(parseTranscriptUsage('{"type":"user","message":{}}\n{ broken', true), undefined);
  assert.equal(parseTranscriptUsage(assistantLine({}), true), undefined, 'a zero-token line is not a measurement');
});

test('a tail that starts mid-line drops its first, truncated line', () => {
  const good = assistantLine({ input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  const tail = 'read_input_tokens":123456}}}\n' + good;
  assert.equal(parseTranscriptUsage(tail).used, 10);
  // Same text read as a whole file keeps every line — but the broken one still fails to parse.
  assert.equal(parseTranscriptUsage(tail, true).used, 10);
});

test('percent is rounded and clamped — a reshaped transcript never yields NaN or 4000%', () => {
  assert.equal(contextPercent(55760, 200000), 28);
  assert.equal(contextPercent(0, 200000), 0);
  assert.equal(contextPercent(400000, 200000), 100);
  assert.equal(contextPercent(1, 0), 0);
});

test('describeContext renders the row label, and names a deferred restart', () => {
  assert.equal(describeContext(55760, 200000), 'ctx 56k / 200k · 28%');
  assert.equal(describeContext(55760, 200000, true), 'ctx 56k / 200k · 28% · restart waiting for task');
});

test('config values are sanitized: percent out of range means OFF, action defaults to recycle', () => {
  assert.equal(sanitizeContextPercent(50), 50);
  assert.equal(sanitizeContextPercent(0), 0);
  assert.equal(sanitizeContextPercent(101), 0);
  assert.equal(sanitizeContextPercent(-5), 0);
  assert.equal(sanitizeContextPercent('50'), 0);
  assert.equal(sanitizeContextAction('clear'), 'clear');
  assert.equal(sanitizeContextAction('stop'), 'recycle', 'an automatic action never leaves a slot dead');
  assert.equal(sanitizeContextAction(undefined), 'recycle');
});

test('shouldTrip: off at 0, fires once per session, re-arms on a new session', () => {
  assert.equal(shouldTrip(90, 0, 's1', undefined), false, 'threshold 0 disables the restart entirely');
  assert.equal(shouldTrip(49, 50, 's1', undefined), false);
  assert.equal(shouldTrip(50, 50, 's1', undefined), true);
  assert.equal(shouldTrip(80, 50, 's1', 's1'), false, 'hysteresis: this session already tripped');
  assert.equal(shouldTrip(80, 50, 's2', 's1'), true, 'a restart/clear starts a new session id');
});
