// Live subagents of a loop session (t-sbag) — pure logic only. NEVER import `vscode` or node
// typings here: this module is compiled by tsconfig.test.json (`types: []`) into out-test/ and
// unit-tested.
//
// Why it exists: a loop's Claude session can still have Agent-tool subagents working after its main
// turn ended (grooming is the common case, and grooming never sets `phase: inprogress`), so the
// tracker reads "idle" while they run. Every automatic restart path used to kill the terminal — and
// those subagents with it — mid-edit. This module turns the files Claude Code leaves behind into
// the one answer the controller needs: which agents of a session are LIVE right now.
//
// The layout below is INTERNAL to Claude Code and documented by observation only (macOS, CLI
// 2.1.276), exactly like src/context.ts's transcript reading:
//
//   ~/.claude/projects/<slug>/<sessionId>.jsonl                     the parent transcript
//   ~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.meta.json   one spawn record per agent
//   ~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.jsonl       that agent's own transcript
//
// An agent is live when its meta exists, it was not stopped by the user, the LATEST finish/resume
// marker for it in the parent transcript is not a finish, and its own transcript was written within
// the staleness window. Every read of all that is guarded by the caller; a miss means "no rows",
// never an error.

// How long an agent may go without writing its own transcript before it stops counting as live.
// The cut exists for one reason: a SIGKILLed session leaves metas with no finish marker, and
// `findSessionId` can still resolve it through a `<pid>.json` its dead process left behind — so
// without a cap those leftovers would hold every automatic restart FOREVER.
//
// It is not free, though, and the cost falls on exactly the agents this feature protects: an agent
// blocked on ONE long operation (a Docker image build, a slow test suite, a network wait) writes
// nothing for the duration, and dropping it lets a held restart kill it mid-work. 60 minutes, not
// 30, is the compromise: long enough to cover the silent stretches real work produces, still
// bounded, and paired with an explicit `agents-stale` log line saying the agent was dropped for
// SILENCE rather than for finishing, so a restart that follows stays explicable.
//
// A marker-aware cut was considered and rejected: every cheaper liveness signal available here is
// either the stale-pointer risk itself (the pointer file exists), documented as unreliable (its
// `updatedAt`/`statusUpdatedAt`), or goes quiet for the very same reason the agent does (the parent
// transcript's mtime — a parent waiting on silent agents writes nothing either). Trading a bounded
// 60-minute exposure for an unbounded "held forever" would be the worse bug.
export const AGENT_STALE_MS = 60 * 60 * 1000;

// EVERY Agent call gets a `tool_result` on its `toolUseId` at spawn time. For an asynchronous agent
// that result is an ACKNOWLEDGEMENT, not a finish, and it is the one trap in this whole file (it
// cost a full debugging round in grooming): `requestShape` is NOT the discriminator — metas without
// it were asynchronous too. The text is. A `tool_result` starting with this phrase is the launch
// receipt and is ignored; any other `tool_result` on the same id is the agent's real result.
export const ASYNC_ACK = 'Async agent launched successfully';

// ---- spawn record: subagents/agent-<id>.meta.json ----

export interface AgentMeta {
  agentType: string;   // e.g. 'general-purpose', 'story-groom'
  description: string; // the short task description the spawner gave
  toolUseId: string;   // the Agent tool_use this agent came from — its synchronous finish marker
  spawnDepth: number;  // 1 for a top-level agent; nested agents are listed flat, never grouped
  model: string;
  // Written into the meta when the human stops the agent from the UI. There is no finish marker in
  // the parent transcript for that case, so this flag is the only record of it.
  stoppedByUser: boolean;
  parentAgentId?: string;
}

export function parseAgentMeta(text: string): AgentMeta | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  // Only these two are load-bearing: without an id to show and a tool-use id to match markers on,
  // the record cannot produce a row or be resolved as finished. Everything else degrades.
  if (typeof o.agentType !== 'string' || typeof o.toolUseId !== 'string') return undefined;
  return {
    agentType: o.agentType,
    description: typeof o.description === 'string' ? o.description : '',
    toolUseId: o.toolUseId,
    spawnDepth: typeof o.spawnDepth === 'number' ? o.spawnDepth : 1,
    model: typeof o.model === 'string' ? o.model : '',
    stoppedByUser: o.stoppedByUser === true,
    parentAgentId: typeof o.parentAgentId === 'string' ? o.parentAgentId : undefined,
  };
}

// `agent-<id>.meta.json` -> `<id>`. Kept here so the host side is a plain directory listing with no
// filename knowledge of its own.
export function agentIdFromMetaName(name: string): string | undefined {
  const m = /^agent-(.+)\.meta\.json$/.exec(name);
  return m ? m[1] : undefined;
}

export function agentTranscriptName(id: string): string {
  return `agent-${id}.jsonl`;
}

// The first line of `agent-<id>.jsonl` is the agent's opening user message and carries the spawn
// `timestamp` — the agent's start, which nothing else records (the meta has no timestamp of its
// own). Matched with a regex rather than JSON.parse because that first line holds the whole prompt
// and can be longer than the head the caller decodes; the timestamp sits after it, so a truncated
// line simply yields no start and the row shows no duration. A `"timestamp":"…"` inside the prompt
// text cannot match: its quotes are escaped in JSON.
export function parseAgentStart(head: string): number | undefined {
  const firstLine = head.split('\n', 1)[0];
  const m = /"timestamp":"([^"]+)"/.exec(firstLine);
  if (!m) return undefined;
  const at = Date.parse(m[1]);
  return Number.isFinite(at) ? at : undefined;
}

// ---- finish / resume markers: the PARENT transcript ----

// `finished` carries whichever id the marker identified the agent by: a notification names the
// agent id, a synchronous `tool_result` only its `toolUseId`. `relived` re-opens a finished agent —
// a `SendMessage` to it makes it live again until its next notification — and carries WHEN, because
// a resumed agent keeps its id and appends to the same transcript, so its first line still holds
// the original spawn. Without the resume instant the row would report spawn-to-now and count the
// idle gap in between (observed: a row reading 14m for an agent 59s into its resumed stretch).
// `at` is absent only when the transcript line carried no parseable timestamp.
export type MarkerEvent =
  | { kind: 'finished'; agentId?: string; toolUseId?: string }
  | { kind: 'relived'; agentId: string; at?: number };

// Everything one scan has to hand the next one, because the caller feeds this parser a BYTE DELTA
// of a file that is still being appended to. Both fields exist for a correctness reason, not for
// caching: without `partial` the line straddling the cut is lost, and without `seen` the duplicate
// half of a notification pair split across that same cut is emitted twice.
export interface MarkerCarry {
  // The trailing, possibly incomplete line — a transcript's last line is routinely half-written.
  partial: string;
  // Ids (agent ids and toolUseIds) already reported finished. A `relived` clears its own id, which
  // is what keeps a resumed agent's NEXT finish from being swallowed as a duplicate.
  seen: string[];
}

export interface MarkerScan {
  events: MarkerEvent[];
  carry: MarkerCarry;
}

const NOTIFICATION_ID = /<task-id>([^<]+)<\/task-id>/;
const NOTIFICATION_STATUS = /<status>(?:completed|failed|killed)<\/status>/;

// A transcript line's ISO `timestamp` as ms epoch, or undefined for anything unparseable.
function parseStamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : undefined;
}

// Text of a transcript `content` field, which is either a plain string or an array of blocks.
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
      ? (part as { text: string }).text
      : ''))
    .join('\n');
}

// Scans a chunk of the parent transcript for everything that ENDS or RE-OPENS an agent, in file
// order. Callers read the transcript once and then feed only the delta, so this must never depend
// on having seen the whole file — it does not: each marker is self-contained on its line, and
// `foldAgents` takes the accumulated event list.
//
// `known` is every agent id and toolUseId this session currently has a meta for. Markers naming
// anything else are DROPPED, and that filter is load-bearing rather than tidy: a `tool_result` is
// how a synchronous agent finishes, so without it every tool call in the transcript — thousands in
// a 10 MB file — would be recorded as an agent finish and retained for the life of the window. With
// it the accumulated list really is a handful per agent. Metas are written at spawn, before any
// marker for them can exist, so filtering against the CURRENT set can never drop a marker for an
// agent that is about to appear.
export function scanMarkers(
  chunk: string,
  known: readonly string[],
  carry: MarkerCarry = { partial: '', seen: [] }
): MarkerScan {
  const lines = (carry.partial + chunk).split('\n');
  // The final element is either '' (the chunk ended on a newline) or a partial line: hold it back.
  const nextPartial = lines.pop() ?? '';
  const events: MarkerEvent[] = [];
  const wanted = new Set(known);
  // Dedupe BY ID, not by adjacency: a finish notification is written TWICE (a `queue-operation`
  // enqueue line and the `user` message line it becomes), the two can be separated by other lines,
  // and the byte-delta cut can land between them — so the state is carried across chunks.
  const seen = new Set(carry.seen);
  const finish = (id: string, event: MarkerEvent): void => {
    if (!wanted.has(id) || seen.has(id)) return;
    seen.add(id);
    events.push(event);
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const o = raw as { content?: unknown; timestamp?: unknown; message?: { content?: unknown } | null };
    const message = o.message && typeof o.message === 'object' ? o.message : undefined;
    // Every transcript line carries its own ISO `timestamp`; only a resume needs it (see below).
    const at = parseStamp(o.timestamp);
    // A `<task-notification>` block reports an ASYNCHRONOUS agent's finish. It reaches the
    // transcript either as a queued operation (top-level `content`) or as the user message it is
    // turned into (`message.content`), so both places are checked.
    const note = `${textOf(o.content)}\n${textOf(message?.content)}`;
    if (note.includes('<task-notification>')) {
      const id = NOTIFICATION_ID.exec(note);
      // Only a terminal status finishes the agent; anything else is a note about a still-live one.
      if (id && NOTIFICATION_STATUS.test(note)) finish(id[1], { kind: 'finished', agentId: id[1] });
    }
    const parts = Array.isArray(message?.content) ? (message!.content as unknown[]) : [];
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      const block = part as { type?: unknown; tool_use_id?: unknown; content?: unknown; name?: unknown; input?: unknown };
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        // See ASYNC_ACK: the launch receipt is not a finish.
        if (textOf(block.content).trimStart().startsWith(ASYNC_ACK)) continue;
        finish(block.tool_use_id, { kind: 'finished', toolUseId: block.tool_use_id });
      } else if (block.type === 'tool_use' && block.name === 'SendMessage') {
        const to = (block.input as { to?: unknown } | null | undefined)?.to;
        if (typeof to !== 'string' || !wanted.has(to)) continue;
        // A resume re-opens the agent, so its next finish is a new one and must not be deduped
        // away against the one this resume just cancelled.
        seen.delete(to);
        events.push({ kind: 'relived', agentId: to, at });
      }
    }
  }
  return { events, carry: { partial: nextPartial, seen: [...seen] } };
}

// ---- the fold: which agents are live ----

// One agent as the fold sees it: its meta plus the two facts only the host can supply.
export interface AgentEntry extends AgentMeta {
  id: string;
  mtime: number;       // last write of `agent-<id>.jsonl` — the liveness heartbeat
  startedAt?: number;  // SPAWN, from `parseAgentStart`; absent until the host has read that line
}

export interface AgentRow {
  id: string;
  agentType: string;
  description: string;
  // Start of the CURRENT working stretch, which is not the same thing as the spawn: a resumed
  // agent keeps its id and appends to the same transcript, so its first line still says when it
  // was originally spawned. `foldAgents` substitutes the latest resume instant when there is one.
  startedAt?: number;
}

export interface AgentFold {
  rows: AgentRow[];
  // Agents dropped by the staleness cutoff, so the poll can log WHY a restart it was holding back
  // suddenly fired. A deferral nobody can explain is the failure mode of this whole feature.
  stale: string[];
}

function matchesAgent(event: MarkerEvent, entry: AgentEntry): boolean {
  if (event.agentId !== undefined) return event.agentId === entry.id;
  if (event.kind === 'finished' && event.toolUseId !== undefined) return event.toolUseId === entry.toolUseId;
  return false;
}

// live = meta exists AND NOT stoppedByUser AND the LATEST marker for it is not a finish AND its own
// transcript has been written within AGENT_STALE_MS. Events are applied in file order and the last
// one wins, which is what makes a resumed agent (`SendMessage` after a notification) live again —
// and what makes its row measure the RESUMED stretch rather than everything since its spawn.
export function foldAgents(metas: readonly AgentEntry[], events: readonly MarkerEvent[], now: number): AgentFold {
  const rows: AgentRow[] = [];
  const stale: string[] = [];
  for (const entry of metas) {
    if (entry.stoppedByUser) continue;
    let finished = false;
    let resumedAt: number | undefined;
    for (const event of events) {
      if (!matchesAgent(event, entry)) continue;
      finished = event.kind === 'finished';
      // Keep the last resume that had a usable timestamp rather than letting an undated later one
      // fall all the way back to the spawn: a stretch measured from an EARLIER resume is still
      // far closer to the truth than one that includes every idle gap since the agent was created.
      if (event.kind === 'relived' && event.at !== undefined) resumedAt = event.at;
    }
    if (finished) continue;
    if (now - entry.mtime > AGENT_STALE_MS) {
      stale.push(entry.id);
      continue;
    }
    rows.push({
      id: entry.id,
      agentType: entry.agentType,
      description: entry.description,
      startedAt: resumedAt ?? entry.startedAt,
    });
  }
  return { rows, stale };
}

// ---- rendering ----

export interface AgentLabel {
  id: string;
  label: string;    // `<agentType> · <description>`
  duration: string; // how long it has been running, e.g. '2m'
}

// The sidebar row's text, and the wording the debug log names a held-back restart with. Kept here
// (like describeSchedule/describeContext) so it is unit-tested and the webview stays a renderer.
// Recomputed per repaint from `startedAt`, so the duration ticks between polls.
export function describeAgent(row: AgentRow, now: number): AgentLabel {
  return {
    id: row.id,
    label: row.description ? `${row.agentType} · ${row.description}` : row.agentType,
    duration: formatDuration(row.startedAt, now),
  };
}

// Empty when the start is unknown — an agent whose first transcript line could not be read still
// gets a row (it is live, and that is the point), just without a duration.
function formatDuration(startedAt: number | undefined, now: number): string {
  if (startedAt === undefined || !Number.isFinite(startedAt)) return '';
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
