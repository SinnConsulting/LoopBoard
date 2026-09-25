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
  parseAgentStart, scanMarkers, foldAgents, describeAgent, foldAgentEdges, describeAgentEdge, describeAgentSide,
} = require('../out-test/subagents');

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const MINUTE = 60000;
const HOUR = 60 * MINUTE;

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

// Every transcript line carries its own ISO `timestamp`; a resume's is what the row's duration is
// measured from. `at` omitted = the reshaped-line case.
function sendMessageLine(to, at) {
  const line = {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_send', name: 'SendMessage', input: { to, summary: 'carry on' } }] },
  };
  if (at !== undefined) line.timestamp = new Date(at).toISOString();
  return JSON.stringify(line);
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

// Every agent id and toolUseId this session has a meta for: markers naming anything else are
// dropped, which is what keeps the accumulated event list O(agents) instead of O(tool calls).
const KNOWN = ['a111', 'toolu_01AAA'];
const scan = (lines, carry) => scanMarkers(chunk(lines), KNOWN, carry);

test('an async launch acknowledgement is NOT a finish', () => {
  // The trap this module exists around: EVERY Agent call gets a tool_result on its toolUseId at
  // spawn time. For an async agent that result is the launch receipt.
  const text = `${ASYNC_ACK}. (This tool result is internal metadata…)\nagentId: a111`;
  assert.deepStrictEqual(scan([toolResultLine('toolu_01AAA', text)]).events, []);
});

test('an ordinary tool_result on the toolUseId IS a finish (synchronous agent)', () => {
  const { events } = scan([toolResultLine('toolu_01AAA', 'Here is the summary of what I changed…')]);
  assert.deepStrictEqual(events, [{ kind: 'finished', toolUseId: 'toolu_01AAA' }]);
});

test('a tool_result for a tool that is not an agent is ignored entirely', () => {
  // Without the `known` filter every Bash/Read/Edit result in a multi-MB transcript would be
  // recorded as a synchronous agent finishing, and retained for the life of the window.
  const { events } = scan([toolResultLine('toolu_someBashCall', 'total 42\ndrwxr-xr-x  …')]);
  assert.deepStrictEqual(events, []);
});

for (const status of ['completed', 'failed', 'killed']) {
  test(`a <status>${status}</status> notification finishes the agent, deduped across its two lines`, () => {
    const { events } = scan(notificationLines('a111', status));
    // Written twice per finish (the queue-operation enqueue and the user message it becomes); one
    // finish must be one event.
    assert.deepStrictEqual(events, [{ kind: 'finished', agentId: 'a111' }]);
  });
}

test('the dedupe is by id, not by adjacency', () => {
  // The two halves of one notification are not guaranteed to be neighbours: the enqueue is written
  // when the agent stops and the user line when the queue is drained, with whatever happened in
  // between sitting between them.
  const [enqueue, delivered] = notificationLines('a111', 'completed');
  const { events } = scan([
    enqueue,
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'meanwhile…' }] } }),
    toolResultLine('toolu_someBashCall', 'unrelated'),
    delivered,
  ]);
  assert.deepStrictEqual(events, [{ kind: 'finished', agentId: 'a111' }]);
});

test('a notification without a terminal status is not a finish', () => {
  const line = JSON.stringify({ type: 'queue-operation', content: '<task-notification>\n<task-id>a111</task-id>\n<status>running</status>\n</task-notification>' });
  assert.deepStrictEqual(scan([line]).events, []);
});

test('SendMessage to a finished agent re-opens it — latest marker wins', () => {
  const resumedAt = NOW - MINUTE;
  const first = scan(notificationLines('a111', 'completed').concat([sendMessageLine('a111', resumedAt)]));
  assert.deepStrictEqual(first.events, [{ kind: 'finished', agentId: 'a111' }, { kind: 'relived', agentId: 'a111', at: resumedAt }]);
  assert.deepStrictEqual(foldAgents([entry()], first.events, NOW).rows.map((r) => r.id), ['a111']);
  // …and its NEXT notification finishes it again — the resume must have cleared the dedupe marker,
  // or the second finish would be swallowed as a duplicate of the first and the agent would hold
  // every automatic restart until the staleness cap expired.
  const second = scan(notificationLines('a111', 'completed'), first.carry);
  assert.deepStrictEqual(second.events, [{ kind: 'finished', agentId: 'a111' }]);
  assert.deepStrictEqual(foldAgents([entry()], first.events.concat(second.events), NOW).rows, []);
});

test('a resumed agent is timed from the RESUME, not from its original spawn', () => {
  // The bug this pins: a resume keeps the agent id and APPENDS to the same transcript, so the
  // first line still holds the spawn instant. Timing from it counted the idle gap in between —
  // observed as a row reading 14m for an agent 59s into its resumed stretch.
  const spawned = NOW - 14 * MINUTE;
  const resumedAt = NOW - 59000;
  const events = scan(notificationLines('a111', 'completed').concat([sendMessageLine('a111', resumedAt)])).events;
  const [row] = foldAgents([entry({ startedAt: spawned })], events, NOW).rows;
  assert.strictEqual(row.startedAt, resumedAt);
  assert.strictEqual(describeAgent(row, NOW).duration, '59s');
  // An agent that was never resumed is unchanged: it is still timed from its spawn.
  const [plain] = foldAgents([entry({ startedAt: spawned })], [], NOW).rows;
  assert.strictEqual(plain.startedAt, spawned);
  assert.strictEqual(describeAgent(plain, NOW).duration, '14m');
});

test('two resumes time from the later one, and an undated resume falls back rather than lying', () => {
  const spawned = NOW - 3 * HOUR;
  const firstResume = NOW - 30 * MINUTE;
  const lastResume = NOW - 2 * MINUTE;
  const both = [
    { kind: 'relived', agentId: 'a111', at: firstResume },
    { kind: 'relived', agentId: 'a111', at: lastResume },
  ];
  assert.strictEqual(foldAgents([entry({ startedAt: spawned })], both, NOW).rows[0].startedAt, lastResume);
  // A reshaped line with no parseable timestamp keeps the last resume that HAD one — still far
  // closer than falling back to a spawn three hours ago.
  const undated = [{ kind: 'relived', agentId: 'a111', at: firstResume }, { kind: 'relived', agentId: 'a111' }];
  assert.strictEqual(foldAgents([entry({ startedAt: spawned })], undated, NOW).rows[0].startedAt, firstResume);
  // …and with NO dated resume at all there is nothing better than the spawn.
  const none = [{ kind: 'relived', agentId: 'a111' }];
  assert.strictEqual(foldAgents([entry({ startedAt: spawned })], none, NOW).rows[0].startedAt, spawned);
});

test('a resume for a DIFFERENT agent does not re-time this one', () => {
  const spawned = NOW - 10 * MINUTE;
  const events = [{ kind: 'relived', agentId: 'a999', at: NOW - MINUTE }];
  assert.strictEqual(foldAgents([entry({ startedAt: spawned })], events, NOW).rows[0].startedAt, spawned);
});

test('a truncated last line is carried into the next chunk instead of being lost', () => {
  const lines = notificationLines('a111', 'completed');
  const whole = chunk(lines);
  // Cut INSIDE the first line, so the second half of that line only becomes parseable once the
  // carry is fed back — the case a byte-delta read produces on every poll.
  const cut = Math.floor(lines[0].length / 2);
  const first = scanMarkers(whole.slice(0, cut), KNOWN);
  assert.deepStrictEqual(first.events, [], 'a half-written line must not parse');
  assert.ok(first.carry.partial.length > 0, 'the half-written last line must be held back');
  const second = scanMarkers(whole.slice(cut), KNOWN, first.carry);
  assert.strictEqual(second.carry.partial, '');
  assert.deepStrictEqual(first.events.concat(second.events), [{ kind: 'finished', agentId: 'a111' }]);
});

test('a notification pair split across two chunks is still ONE finish', () => {
  const lines = notificationLines('a111', 'completed');
  // The byte-delta cut lands exactly between the enqueue line and the user line it becomes — the
  // duplicate half arrives in the NEXT poll's chunk, so the dedupe state has to be carried.
  const first = scanMarkers(chunk([lines[0]]), KNOWN);
  assert.deepStrictEqual(first.events, [{ kind: 'finished', agentId: 'a111' }]);
  const second = scanMarkers(chunk([lines[1]]), KNOWN, first.carry);
  assert.deepStrictEqual(second.events, [], 'the duplicate half must not be reported a second time');
});

test('scanMarkers skips unparseable and irrelevant lines without throwing', () => {
  const { events } = scan([
    '',
    '   ',
    '{ not json at all',
    'null',
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'ls' } }] } }),
  ]);
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

test('the staleness cutoff drops a leftover meta an hour after its last transcript write', () => {
  // The backstop for a SIGKILLed session: metas with no finish marker, resolved through a pointer
  // file its dead process left behind, would otherwise read as live forever and hold every
  // automatic restart. NEITHER case here has a finish marker — only the mtime differs.
  const fresh = entry({ id: 'a-fresh', mtime: NOW - 59 * MINUTE });
  const old = entry({ id: 'a-old', toolUseId: 'toolu_old', mtime: NOW - 61 * MINUTE });
  const { rows, stale } = foldAgents([fresh, old], [], NOW);
  assert.deepStrictEqual(rows.map((r) => r.id), ['a-fresh']);
  assert.deepStrictEqual(stale, ['a-old'], 'a dropped agent must be reported so the log can explain the restart that follows');
  assert.strictEqual(AGENT_STALE_MS, 60 * MINUTE);
});

test('the cut is on SILENCE, not on age — a long-running agent that keeps writing stays live', () => {
  // The hole the hour buys room for: an agent blocked on one long operation (a Docker build, a
  // slow suite) writes nothing while it waits, and dropping it lets a held restart kill it
  // mid-work — the exact outcome the hold exists to prevent. An agent that has merely LIVED a
  // long time was never at risk: the cut reads mtime, not the start.
  const ancient = entry({ id: 'a-old-but-working', startedAt: NOW - 8 * HOUR, mtime: NOW - MINUTE });
  const { rows, stale } = foldAgents([ancient], [], NOW);
  assert.deepStrictEqual(rows.map((r) => r.id), ['a-old-but-working']);
  assert.deepStrictEqual(stale, []);
  // A 45-minute silent stretch used to be fatal and now is not.
  const quiet = entry({ id: 'a-quiet', mtime: NOW - 45 * MINUTE });
  assert.deepStrictEqual(foldAgents([quiet], [], NOW).rows.map((r) => r.id), ['a-quiet']);
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

// ---- lifecycle edges + the agent side of a restart (t-aglg) ----

function row(id, over) {
  return Object.assign({ id, agentType: 'story-groom', description: `Groom ${id}`, startedAt: NOW - 3 * MINUTE }, over);
}

test('foldAgentEdges: a new id is a start', () => {
  const a = row('a1');
  const b = row('b2');
  assert.deepStrictEqual(foldAgentEdges([a], [a, b]), { started: [b], gone: [] });
});

test('foldAgentEdges: a missing id is a departure, carrying the row as it was BEFORE it left', () => {
  const a = row('a1', { startedAt: NOW - 7 * MINUTE });
  const b = row('b2');
  const edges = foldAgentEdges([a, b], [b]);
  assert.deepStrictEqual(edges, { started: [], gone: [a] });
  // The departing row still holds its start, so the line can say how long it ran.
  assert.strictEqual(edges.gone[0].startedAt, NOW - 7 * MINUTE);
});

test('foldAgentEdges: an unchanged set and empty→empty produce no edges', () => {
  const a = row('a1');
  assert.deepStrictEqual(foldAgentEdges([a], [row('a1')]), { started: [], gone: [] });
  assert.deepStrictEqual(foldAgentEdges([], []), { started: [], gone: [] });
});

test('foldAgentEdges: a reorder without a membership change produces no edges', () => {
  const a = row('a1');
  const b = row('b2');
  assert.deepStrictEqual(foldAgentEdges([a, b], [b, a]), { started: [], gone: [] });
});

test('foldAgentEdges: a resumed agent re-enters — gone, then started again, same id', () => {
  const a = row('a1');
  const finished = foldAgentEdges([a], []);
  assert.deepStrictEqual(finished, { started: [], gone: [a] });
  // A SendMessage re-opens it with `startedAt` at the resume instant.
  const resumed = row('a1', { startedAt: NOW - 10000 });
  assert.deepStrictEqual(foldAgentEdges([], [resumed]), { started: [resumed], gone: [] });
});

test('foldAgentEdges: a FAILED read over a non-empty baseline produces no edges at all', () => {
  const a = row('a1');
  const b = row('b2');
  // The fail-open guard: `undefined` is not "nothing live", so nothing is reported gone…
  assert.deepStrictEqual(foldAgentEdges([a, b], undefined), { started: [], gone: [] });
  assert.deepStrictEqual(foldAgentEdges([], undefined), { started: [], gone: [] });
  // …and since the caller keeps its baseline, the next good read diffs against the last good one:
  // the same set again is silent, not a burst of starts.
  assert.deepStrictEqual(foldAgentEdges([a, b], [a, b]), { started: [], gone: [] });
});

test('describeAgentEdge renders a start and a departure with label, id and duration', () => {
  const a = row('a1', { description: 'Fold monster speed answers', startedAt: NOW - 4 * MINUTE });
  assert.strictEqual(describeAgentEdge('start', a, NOW), 'story-groom · Fold monster speed answers (agent a1)');
  assert.strictEqual(describeAgentEdge('gone', a, NOW),
    'story-groom · Fold monster speed answers (agent a1) — no longer live after 4m');
  // Never claims a finish: the snapshot cannot tell a finish from a stop, a drop or a lost session.
  assert.ok(!/finished/.test(describeAgentEdge('gone', a, NOW)));
});

test('describeAgentEdge: a departing row with no startedAt still reads cleanly', () => {
  const a = row('a1', { startedAt: undefined });
  assert.strictEqual(describeAgentEdge('gone', a, NOW), 'story-groom · Groom a1 (agent a1) — no longer live');
});

test('describeAgentSide names no agents, the fail-open, a kill, and a swallowed action', () => {
  assert.strictEqual(describeAgentSide([], false, true, NOW), 'no live subagents');
  assert.strictEqual(describeAgentSide([], true, true, NOW), 'no live subagents (session unreadable)');
  assert.strictEqual(describeAgentSide([row('a1')], false, true, NOW), 'killed 1 live subagent: story-groom · Groom a1');
  assert.strictEqual(describeAgentSide([row('a1'), row('b2')], false, true, NOW),
    'killed 2 live subagents: story-groom · Groom a1, story-groom · Groom b2');
  // A swallowed action (restart-skip) must not claim to have killed anything.
  assert.strictEqual(describeAgentSide([row('a1')], false, false, NOW), '1 live subagent left running: story-groom · Groom a1');
});
