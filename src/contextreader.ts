// Thin vscode wrapper around src/context.ts (t-2b89): locates a loop slot's live Claude Code
// session and reads its transcript tail. All the parsing lives in the pure module; this file only
// knows where the files are and how to read them.
//
// These paths are OUTSIDE the workspace, so they deliberately do not go through `store.ts` (which
// owns `.loopboard/` paths and nothing else). `vscode.workspace.fs` works on any local path.
import * as vscode from 'vscode';
import { Model } from './model';
import {
  ContextUsage, matchesSlot, newestPointer, parseSessionPointer, parseTranscriptUsage,
  contextPercent, windowSizeFor, SessionPointer,
} from './context';
import {
  AGENT_STALE_MS, AgentEntry, AgentRow, MarkerEvent, agentIdFromMetaName, agentTranscriptName,
  foldAgents, parseAgentMeta, parseAgentStart, scanMarkers,
} from './subagents';

// The extension host is Node, so the environment is available at runtime — but `@types/node` is
// forbidden (zero devDependencies beyond typescript + @types/vscode), hence this minimal ambient
// declaration. Nothing else in `src/` touches `process`.
declare const process: { env: Record<string, string | undefined> };

// Transcripts grow to tens of MB and only the LAST assistant line matters, so decode just the tail.
// 256 KB comfortably spans several turns even with large tool results.
const TAIL_BYTES = 256 * 1024;

// How much of an agent's own transcript is decoded to find its start timestamp (t-sbag). Only the
// FIRST line carries it, but that line holds the agent's whole prompt — 64 KB covers every prompt
// observed and keeps a multi-MB agent transcript from being turned into a string. A longer first
// line simply yields no start, and the row renders without a duration.
const AGENT_HEAD_BYTES = 64 * 1024;

const DECODER = new TextDecoder();

export interface ContextReading {
  sessionId: string;
  used: number;
  window: number;
  percent: number;
}

export class ContextReader {
  // sessionId -> last transcript size + the usage parsed at that size, so an unchanged transcript
  // costs one stat() instead of a multi-MB read.
  private cache = new Map<string, { size: number; usage: ContextUsage }>();
  // sessionId -> resolved transcript Uri, so the projects/ scan happens once per session.
  private transcripts = new Map<string, vscode.Uri>();
  // Subagent marker scan (t-sbag). A finish marker can sit anywhere in the parent transcript, so
  // unlike `readUsage`'s tail this needs the WHOLE file — once. Afterwards only the bytes past
  // `offset` are decoded and parsed, with `carry` holding the possibly half-written last line, and
  // `events` accumulating every marker seen so far (a handful per agent, so it stays small).
  private markers = new Map<string, { offset: number; carry: string; events: MarkerEvent[] }>();
  // agent id -> start ms. An agent's start never changes, so this is read once per agent and only
  // ever for one that is already known to be live.
  private agentStarts = new Map<string, number>();

  constructor(
    private getCwd: () => string,
    private log: (level: 'info' | 'verbose', event: string, detail?: string) => void = () => {}
  ) {}

  // `~/.claude`, or wherever CLAUDE_CONFIG_DIR points. Undefined when neither the override nor a
  // home directory is known — the caller then reports no measurement.
  private claudeDir(): vscode.Uri | undefined {
    const override = process.env.CLAUDE_CONFIG_DIR;
    if (override) return vscode.Uri.file(override);
    const home = process.env.HOME || process.env.USERPROFILE;
    return home ? vscode.Uri.joinPath(vscode.Uri.file(home), '.claude') : undefined;
  }

  // The session file for this slot: one `<pid>.json` per LIVE process, matched on our `--name` plus
  // the workspace cwd. The `<pid>.<hash>.key` sidecars in the same directory are a messaging secret
  // — never read them.
  private async findSessionId(model: Model, dir: vscode.Uri): Promise<string | undefined> {
    const sessionsDir = vscode.Uri.joinPath(dir, 'sessions');
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(sessionsDir);
    } catch {
      return undefined;
    }
    // Collect every match rather than taking the first: a stale file from a killed process sorts
    // just as well as the live one. newestPointer picks by `updatedAt`.
    const matches: SessionPointer[] = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith('.json')) continue;
      let text: string;
      try {
        text = DECODER.decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(sessionsDir, name)));
      } catch {
        continue;
      }
      const pointer = parseSessionPointer(text);
      if (pointer && matchesSlot(pointer, this.getCwd(), model)) matches.push(pointer);
    }
    if (matches.length > 1) {
      this.log('verbose', 'context-read', `${model} -> ${matches.length} session files match; using the newest`);
    }
    return newestPointer(matches)?.sessionId;
  }

  // Where Claude Code put this session's transcript. Found by SEARCHING `projects/*` for
  // `<sessionId>.jsonl` instead of reconstructing the directory name from the workspace path: that
  // encoding is Claude Code's business (non-alphanumerics folded, long paths hashed, worktree roots
  // canonicalised) and getting it subtly wrong killed the feature silently (t-2b89 review). The
  // resolved Uri is cached per session id, so the scan is one readDirectory of a small directory
  // once per session, not per poll.
  private async findTranscript(dir: vscode.Uri, sessionId: string): Promise<vscode.Uri | undefined> {
    const cached = this.transcripts.get(sessionId);
    if (cached) return cached;
    const projects = vscode.Uri.joinPath(dir, 'projects');
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(projects);
    } catch {
      return undefined;
    }
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.Directory) continue;
      const candidate = vscode.Uri.joinPath(projects, name, `${sessionId}.jsonl`);
      try {
        await vscode.workspace.fs.stat(candidate);
      } catch {
        continue;
      }
      this.transcripts.set(sessionId, candidate);
      return candidate;
    }
    return undefined;
  }

  private async readUsage(dir: vscode.Uri, sessionId: string): Promise<ContextUsage | undefined> {
    const uri = await this.findTranscript(dir, sessionId);
    if (!uri) return undefined;
    let size: number;
    try {
      size = (await vscode.workspace.fs.stat(uri)).size;
    } catch {
      return undefined;
    }
    const cached = this.cache.get(sessionId);
    if (cached && cached.size === size) return cached.usage;
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch {
      return undefined;
    }
    const whole = bytes.byteLength <= TAIL_BYTES;
    const usage = parseTranscriptUsage(DECODER.decode(whole ? bytes : bytes.slice(bytes.byteLength - TAIL_BYTES)), whole);
    if (!usage) {
      this.log('verbose', 'context-read', `${sessionId} -> no usage line in the transcript tail`);
      return undefined;
    }
    this.cache.set(sessionId, { size, usage });
    return usage;
  }

  // One measurement for one slot. Undefined whenever anything is missing — no session file, no
  // transcript, an unreadable path, a reshaped schema: the feature degrades to showing nothing.
  async read(model: Model, modelString: string): Promise<ContextReading | undefined> {
    const dir = this.claudeDir();
    if (!dir) return undefined;
    const sessionId = await this.findSessionId(model, dir);
    if (!sessionId) return undefined;
    const usage = await this.readUsage(dir, sessionId);
    if (!usage) return undefined;
    // The transcript's own model id wins over the configured --model string (see windowSizeFor).
    const window = windowSizeFor(modelString, usage.model);
    const percent = contextPercent(usage.used, window);
    this.log('verbose', 'context-read', `${model} ${usage.used}/${window} (${percent}%) session ${sessionId}`);
    return { sessionId, used: usage.used, window, percent };
  }

  // ---- live subagents (t-sbag) ----

  // The live Agent-tool subagents of this slot's session. Reuses the session id and transcript Uri
  // `read()` already resolves — there is no second discovery path.
  //
  // `undefined` means COULD NOT READ (no session, no transcript, an unreadable transcript);
  // `[]` means read fine and nothing is live. The caller shows the same thing for both but logs
  // them apart: a read failure must never masquerade as "idle" silently.
  async readSubagents(model: Model, now: number): Promise<AgentRow[] | undefined> {
    const dir = this.claudeDir();
    if (!dir) return undefined;
    const sessionId = await this.findSessionId(model, dir);
    if (!sessionId) return undefined;
    const transcript = await this.findTranscript(dir, sessionId);
    if (!transcript) return undefined;
    // `projects/<slug>/<sessionId>.jsonl` -> `projects/<slug>/<sessionId>/subagents`.
    const agentsDir = vscode.Uri.joinPath(transcript, '..', sessionId, 'subagents');
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(agentsDir);
    } catch {
      // No `subagents/` directory at all: this session never spawned one. That is a real, readable
      // "nothing is live", not a failure.
      return [];
    }
    const metas: AgentEntry[] = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File) continue;
      const id = agentIdFromMetaName(name);
      if (!id) continue;
      let meta;
      try {
        meta = parseAgentMeta(DECODER.decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(agentsDir, name))));
      } catch {
        continue;
      }
      if (!meta) continue;
      // The agent's own transcript is its heartbeat; without an mtime there is no way to tell a
      // working agent from a killed session's leftover, so the record is skipped entirely.
      let mtime: number;
      try {
        mtime = (await vscode.workspace.fs.stat(vscode.Uri.joinPath(agentsDir, agentTranscriptName(id)))).mtime;
      } catch {
        continue;
      }
      metas.push({ ...meta, id, mtime, startedAt: this.agentStarts.get(id) });
    }
    // Nothing was ever spawned here — skip the transcript scan entirely rather than walking
    // several MB to answer a question with no subjects.
    if (metas.length === 0) return [];
    const events = await this.readMarkers(transcript, sessionId);
    if (!events) return undefined;
    const { rows, stale } = foldAgents(metas, events, now);
    for (const id of stale) {
      this.log('verbose', 'agents-stale', `${model} agent ${id} — no transcript write in ${Math.round(AGENT_STALE_MS / 60000)}m, dropped`);
    }
    for (const row of rows) {
      if (row.startedAt === undefined) row.startedAt = await this.readAgentStart(agentsDir, row.id);
    }
    return rows;
  }

  // Every finish/resume marker seen in this session's parent transcript so far. Read whole once,
  // then delta-only: `vscode.workspace.fs` has no ranged read, so the file is still loaded, but
  // only the new bytes are decoded and parsed — which is where the cost of a 10 MB transcript is.
  private async readMarkers(uri: vscode.Uri, sessionId: string): Promise<MarkerEvent[] | undefined> {
    let state = this.markers.get(sessionId);
    if (!state) {
      state = { offset: 0, carry: '', events: [] };
      this.markers.set(sessionId, state);
    }
    let size: number;
    try {
      size = (await vscode.workspace.fs.stat(uri)).size;
    } catch {
      return undefined;
    }
    if (size === state.offset) return state.events;
    // Shorter than what we already consumed = a different file under the same name; start over
    // rather than decode a delta that was never appended.
    if (size < state.offset) {
      state.offset = 0;
      state.carry = '';
      state.events = [];
    }
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch {
      return undefined;
    }
    // A multi-byte character split across the previous read's end decodes to a replacement
    // character here; it lands inside the carried line, which then fails JSON.parse and is skipped.
    const scan = scanMarkers(DECODER.decode(state.offset > 0 ? bytes.slice(state.offset) : bytes), state.carry);
    state.offset = bytes.byteLength;
    state.carry = scan.carry;
    if (scan.events.length) state.events = state.events.concat(scan.events);
    return state.events;
  }

  private async readAgentStart(agentsDir: vscode.Uri, id: string): Promise<number | undefined> {
    const cached = this.agentStarts.get(id);
    if (cached !== undefined) return cached;
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(agentsDir, agentTranscriptName(id)));
    } catch {
      return undefined;
    }
    const started = parseAgentStart(DECODER.decode(bytes.slice(0, AGENT_HEAD_BYTES)));
    if (started !== undefined) this.agentStarts.set(id, started);
    return started;
  }
}
