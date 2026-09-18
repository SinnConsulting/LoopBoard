'use strict';
// Live subagents (t-sbag) — the pure half of "a running subagent blocks an automatic loop restart".
//
// Everything asserted here is a rule about Claude Code's own on-disk shape, which is undocumented
// and can be renamed by any CLI update. That is exactly why these are captured fixtures rather than
// a live read: a shape change fails loudly in this suite instead of silently in the extension host,
// where the only symptom would be a restart that kills an agent mid-edit (or one that never fires).
const test = require('node:test');
const assert = require('node:assert');
const {
  AGENT_STALE_MS, ASYNC_ACK, parseAgentMeta, agentIdFromMetaName, agentTranscriptName,
  parseAgentStart, scanMarkers, foldAgents, describeAgent,
} = require('../out-test/subagents');

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const MINUTE = 60000;

// ---- fixture builders (shapes observed on macOS, CLI 2.1.276) ----

const META = {
  agentType: 'general-purpose',
  description: 'Implement corpse whirl fix',
  toolUseId: 'toolu_01AAA',
  spawnDepth: 1,
  requestShape: 'background',
  requestNonInteractive: true,
  model: 'opus',
};

// A live-by-default entry, as ContextReader hands it to foldAgents.
function entry(over) {
  return Object.assign({
    id: 'a111',
    agentType: 'general-purpose',
    description: 'Implement corpse whirl fix',
    toolUseId: 'toolu_01AAA',
    spawnDepth: 1,
    model: 'opus',
    stoppedByUser: false,
    mtime: NOW - MINUTE,
    startedAt: NOW - 2 * MINUTE,
  }, over || {});
}

// The enqueue line and the user-message line Claude Code writes for the SAME finish.
function notificationLines(id, status) {
  const block = [
    '<task-notification>',
    `<task-id>${id}</task-id>`,
    '<tool-use-id>toolu_01AAA</tool-use-id>',
    `<status>${status}</status>`,
    '<summary>Agent "Groom DRAFT t-16d2" finished</summary>',
    '<note>A task-notification fires each time this agent stops.</note>',
    '</task-notification>',
  ].join('\n');
  return [
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: block }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: block } }),
  ];
}

function toolResultLine(toolUseId, text) {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ tool_use_id: toolUseId, type: 'tool_result', content: [{ type: 'text', text }] }] },
  });
}

function sendMessageLine(to) {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_send', name: 'SendMessage', input: { to, summary: 'carry on' } }] },
  });
}

function chunk(lines) {
  return lines.join('\n') + '\n';
}

// ---- meta ----

test('parseAgentMeta reads the fields a row and a marker match need', () => {
  const meta = parseAgentMeta(JSON.stringify(META));
  assert.strictEqual(meta.agentType, 'general-purpose');
  assert.strictEqual(meta.description, 'Implement corpse whirl fix');
  assert.strictEqual(meta.toolUseId, 'toolu_01AAA');
  assert.strictEqual(meta.spawnDepth, 1);
  assert.strictEqual(meta.model, 'opus');
  assert.strictEqual(meta.stoppedByUser, false);
});

test('parseAgentMeta keeps the optional fields optional', () => {
  // `requestShape` / `requestNonInteractive` / `isFork` are absent on most metas — including
  // asynchronous ones, which is why they are NOT the async discriminator anywhere in this module.
  const meta = parseAgentMeta(JSON.stringify({ agentType: 'story-groom', toolUseId: 'toolu_x', spawnDepth: 2, model: 'fable', parentAgentId: 'a000' }));
  assert.strictEqual(meta.description, '');
  assert.strictEqual(meta.spawnDepth, 2);
  assert.strictEqual(meta.parentAgentId, 'a000');
});

test('a meta that fails to parse is dropped, never guessed at', () => {
  assert.strictEqual(parseAgentMeta('{ not json'), undefined);
  assert.strictEqual(parseAgentMeta(''), undefined);
  assert.strictEqual(parseAgentMeta('null'), undefined);
  assert.strictEqual(parseAgentMeta('[1,2]'), undefined);
  // Reshaped: no agentType / no toolUseId means no row and no way to match a finish marker.
  assert.strictEqual(parseAgentMeta(JSON.stringify({ description: 'x' })), undefined);
  assert.strictEqual(parseAgentMeta(JSON.stringify({ agentType: 'general-purpose' })), undefined);
});

test('agent file names round-trip', () => {
  assert.strictEqual(agentIdFromMetaName('agent-a6a5a3a8175cb9a1a.meta.json'), 'a6a5a3a8175cb9a1a');
  assert.strictEqual(agentTranscriptName('a6a5a3a8175cb9a1a'), 'agent-a6a5a3a8175cb9a1a.jsonl');
  // Everything else in that directory is not a spawn record.
  assert.strictEqual(agentIdFromMetaName('agent-a6a5a3a8175cb9a1a.jsonl'), undefined);
  assert.strictEqual(agentIdFromMetaName('notes.json'), undefined);
});

test('parseAgentStart takes the timestamp off the agent transcript first line', () => {
  const head = JSON.stringify({ isSidechain: true, agentId: 'a111', type: 'user', message: { role: 'user', content: 'go' }, timestamp: '2026-09-18T11:58:00.000Z' }) + '\n{"type":"assistant"}\n';
  assert.strictEqual(parseAgentStart(head), Date.parse('2026-09-18T11:58:00.000Z'));
  // A first line cut off before its timestamp (the prompt is longer than the decoded head) simply
  // yields no start — the row still renders, without a duration.
  assert.strictEqual(parseAgentStart('{"type":"user","message":{"role":"user","content":"a very long prompt'), undefined);
  assert.strictEqual(parseAgentStart(''), undefined);
});

// ---- markers ----

test('an async launch acknowledgement is NOT a finish', () => {
  // The trap this module exists around: EVERY Agent call gets a tool_result on its toolUseId at
  // spawn time. For an async agent that result is the launch receipt.
  const text = `${ASYNC_ACK}. (This tool result is internal metadata…)\nagentId: a111`;
  const { events } = scanMarkers(chunk([toolResultLine('toolu_01AAA', text)]));
  assert.deepStrictEqual(events, []);
});

test('an ordinary tool_result on the toolUseId IS a finish (synchronous agent)', () => {
  const { events } = scanMarkers(chunk([toolResultLine('toolu_01AAA', 'Here is the summary of what I changed…')]));
  assert.deepStrictEqual(events, [{ kind: 'finished', toolUseId: 'toolu_01AAA' }]);
});

for (const status of ['completed', 'failed', 'killed']) {
  test(`a <status>${status}</status> notification finishes the agent, deduped across its two lines`, () => {
    const { events } = scanMarkers(chunk(notificationLines('a111', status)));
    // Written twice per finish (the queue-operation enqueue and the user message it becomes); one
    // finish must be one event.
    assert.deepStrictEqual(events, [{ kind: 'finished', agentId: 'a111' }]);
  });
}

test('a notification without a terminal status is not a finish', () => {
  const line = JSON.stringify({ type: 'queue-operation', content: '<task-notification>\n<task-id>a111</task-id>\n<status>running</status>\n</task-notification>' });
  assert.deepStrictEqual(scanMarkers(chunk([line])).events, []);
});

test('SendMessage to a finished agent re-opens it — latest marker wins', () => {
  const lines = notificationLines('a111', 'completed').concat([sendMessageLine('a111')]);
  const { events } = scanMarkers(chunk(lines));
  assert.deepStrictEqual(events, [{ kind: 'finished', agentId: 'a111' }, { kind: 'relived', agentId: 'a111' }]);
  assert.deepStrictEqual(foldAgents([entry()], events, NOW).rows.map((r) => r.id), ['a111']);
  // …and its NEXT notification finishes it again.
  const after = events.concat(scanMarkers(chunk(notificationLines('a111', 'completed'))).events);
  assert.deepStrictEqual(foldAgents([entry()], after, NOW).rows, []);
});

test('a truncated last line is carried into the next chunk instead of being lost', () => {
  const lines = notificationLines('a111', 'completed');
  const whole = chunk(lines);
  const cut = Math.floor(whole.length / 2);
  const first = scanMarkers(whole.slice(0, cut));
  assert.ok(first.carry.length > 0, 'the half-written last line must be held back, not parsed');
  const second = scanMarkers(whole.slice(cut), first.carry);
  assert.strictEqual(second.carry, '');
  const events = first.events.concat(second.events);
  assert.deepStrictEqual(events, [{ kind: 'finished', agentId: 'a111' }]);
});

test('scanMarkers skips unparseable and irrelevant lines without throwing', () => {
  const { events } = scanMarkers(chunk([
    '',
    '   ',
    '{ not json at all',
    'null',
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'ls' } }] } }),
  ]));
  assert.deepStrictEqual(events, []);
});

// ---- the fold ----

test('foldAgents keeps an agent with no finish marker', () => {
  const { rows, stale } = foldAgents([entry()], [], NOW);
  assert.deepStrictEqual(stale, []);
  assert.deepStrictEqual(rows, [{ id: 'a111', agentType: 'general-purpose', description: 'Implement corpse whirl fix', startedAt: NOW - 2 * MINUTE }]);
});

test('foldAgents drops an agent the human stopped', () => {
  // `stoppedByUser` is written into the meta and there is NO finish marker for that case, so this
  // flag is the only record of it.
  assert.deepStrictEqual(foldAgents([entry({ stoppedByUser: true })], [], NOW).rows, []);
});

test('foldAgents matches a synchronous finish by toolUseId and an async one by agent id', () => {
  const byTool = foldAgents([entry()], [{ kind: 'finished', toolUseId: 'toolu_01AAA' }], NOW);
  assert.deepStrictEqual(byTool.rows, []);
  const byId = foldAgents([entry()], [{ kind: 'finished', agentId: 'a111' }], NOW);
  assert.deepStrictEqual(byId.rows, []);
  // Another agent's markers leave this one alone.
  const other = foldAgents([entry()], [{ kind: 'finished', agentId: 'a999' }, { kind: 'finished', toolUseId: 'toolu_other' }], NOW);
  assert.deepStrictEqual(other.rows.map((r) => r.id), ['a111']);
});

test('nested agents are listed flat', () => {
  const rows = foldAgents([entry(), entry({ id: 'a222', spawnDepth: 2, parentAgentId: 'a111', toolUseId: 'toolu_nested' })], [], NOW).rows;
  assert.deepStrictEqual(rows.map((r) => r.id), ['a111', 'a222']);
});

test('the staleness cutoff drops a leftover meta 30 minutes after its last transcript write', () => {
  // The backstop for a SIGKILLed session: metas with no finish marker, resolved through a pointer
  // file its dead process left behind, would otherwise read as live forever and hold every
  // automatic restart. NEITHER case here has a finish marker — only the mtime differs.
  const fresh = entry({ id: 'a-fresh', mtime: NOW - 29 * MINUTE });
  const old = entry({ id: 'a-old', toolUseId: 'toolu_old', mtime: NOW - 31 * MINUTE });
  const { rows, stale } = foldAgents([fresh, old], [], NOW);
  assert.deepStrictEqual(rows.map((r) => r.id), ['a-fresh']);
  assert.deepStrictEqual(stale, ['a-old'], 'a dropped agent must be reported so the log can explain the restart that follows');
  assert.strictEqual(AGENT_STALE_MS, 30 * MINUTE);
});

test('an empty subagents directory folds to no rows', () => {
  assert.deepStrictEqual(foldAgents([], [], NOW), { rows: [], stale: [] });
});

// ---- rendering ----

test('describeAgent renders `agentType · description` plus a duration', () => {
  assert.deepStrictEqual(describeAgent({ id: 'a111', agentType: 'story-groom', description: 'Fold monster speed answers', startedAt: NOW - MINUTE }, NOW), {
    id: 'a111', label: 'story-groom · Fold monster speed answers', duration: '1m',
  });
  assert.strictEqual(describeAgent({ id: 'a', agentType: 'general-purpose', description: '', startedAt: NOW - 20000 }, NOW).label, 'general-purpose');
  assert.strictEqual(describeAgent({ id: 'a', agentType: 'x', description: 'y', startedAt: NOW - 20000 }, NOW).duration, '20s');
  assert.strictEqual(describeAgent({ id: 'a', agentType: 'x', description: 'y', startedAt: NOW - 125 * MINUTE }, NOW).duration, '2h 5m');
  // An unknown start (first transcript line unreadable) still renders a row — it is live, which is
  // the whole point — just without a duration.
  assert.strictEqual(describeAgent({ id: 'a', agentType: 'x', description: 'y' }, NOW).duration, '');
});
