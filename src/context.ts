// Context-usage measurement for loop terminals (t-2b89) — pure logic only. NEVER import `vscode`
// or node typings here: this module is compiled by tsconfig.test.json (`types: []`) into out-test/
// and unit-tested.
//
// Claude Code persists no context number anywhere the extension can ask for it. What it DOES write
// is (a) one `~/.claude/sessions/<pid>.json` per LIVE process — session identity only, removed when
// the process exits — and (b) the transcript `~/.claude/projects/<encoded cwd>/<sessionId>.jsonl`,
// whose last main-chain assistant line carries the token counts. So the measurement is: match a
// LoopBoard slot to its session file by the `--name` we spawned it with, follow its `sessionId` to
// the transcript, and read the tail. Both file layouts are internal to Claude Code and documented
// here BY OBSERVATION only (macOS, CLI 2.1.260) — every read is guarded and a miss must degrade to
// "no indicator, no restart", never to an error.

import { Model } from './model';

// The `--name` given to every loop terminal's `claude` invocation, and the value we then look for
// in the session JSON. Slot ids are a fixed set ('opus' | 'sonnet' | 'fable'), so the result is
// always shell-safe.
export function sessionName(model: Model): string {
  return `loopboard-${model}`;
}

// Claude Code's transcript directory name for a working directory: the absolute path with every
// separator replaced by `-` (`/Users/x/LoopBoard` -> `-Users-x-LoopBoard`). Windows drive colons
// are folded the same way (`C:\Users\x` -> `C--Users-x`) — UNVERIFIED on Windows, which is why a
// miss must stay silent.
export function encodeProjectDir(absPath: string): string {
  return absPath.replace(/[\\/:]/g, '-');
}

// Context window of a slot, derived from the `--model` string we spawned it with — the transcript
// records the model but never its window size. `[1m]` suffix = the 1M-token window, else 200k.
export const DEFAULT_WINDOW = 200000;
export const LARGE_WINDOW = 1000000;
export function windowSizeFor(modelString: string): number {
  return /\[1m\]/i.test(modelString) ? LARGE_WINDOW : DEFAULT_WINDOW;
}

// What a `~/.claude/sessions/<pid>.json` tells us. Only these three fields are load-bearing; the
// rest of that file (messaging socket, peer protocol, timestamps) is none of our business.
export interface SessionPointer {
  sessionId: string;
  cwd: string;
  name: string;
}

export function parseSessionPointer(text: string): SessionPointer | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const o = raw as { sessionId?: unknown; cwd?: unknown; name?: unknown } | null;
  if (!o || typeof o.sessionId !== 'string' || typeof o.cwd !== 'string') return undefined;
  return { sessionId: o.sessionId, cwd: o.cwd, name: typeof o.name === 'string' ? o.name : '' };
}

// A session file belongs to a slot when it names the workspace AND carries our `--name`. The cwd
// test alone can never separate two slots — every loop terminal spawns in the workspace root.
export function matchesSlot(pointer: SessionPointer, workspaceCwd: string, model: Model): boolean {
  return pointer.cwd === workspaceCwd && pointer.name === sessionName(model);
}

export interface ContextUsage {
  used: number; // tokens currently in the window
  model: string; // `message.model` of the line we measured, e.g. 'claude-opus-5'
}

// Current context size = the LAST main-chain assistant line's input + cache-read + cache-creation
// tokens. Output tokens are not part of the window, and `isSidechain: true` lines belong to
// subagents whose usage is a different context entirely — both are excluded.
//
// `tail` may begin mid-line (callers decode only the last chunk of a multi-MB transcript), so the
// first line is dropped unless the tail is the whole file. Returns undefined when nothing parses —
// an unreadable or reshaped transcript means "no measurement", never an error.
export function parseTranscriptUsage(tail: string, isWholeFile = false): ContextUsage | undefined {
  const lines = tail.split('\n');
  const first = isWholeFile ? 0 : 1;
  for (let i = lines.length - 1; i >= first; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const o = raw as { type?: unknown; isSidechain?: unknown; message?: { model?: unknown; usage?: Record<string, unknown> } } | null;
    if (!o || o.type !== 'assistant' || o.isSidechain === true) continue;
    const usage = o.message?.usage;
    if (!usage) continue;
    const num = (k: string): number => (typeof usage[k] === 'number' ? (usage[k] as number) : 0);
    const used = num('input_tokens') + num('cache_read_input_tokens') + num('cache_creation_input_tokens');
    if (used <= 0) continue;
    return { used, model: typeof o.message?.model === 'string' ? (o.message.model as string) : '' };
  }
  return undefined;
}

// Percent of the window in use, rounded to a whole number and clamped — a post-compaction or
// reshaped transcript must never produce a NaN or a 4000% row.
export function contextPercent(used: number, window: number): number {
  if (!(window > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((used / window) * 100)));
}

// The sidebar row's one-line indicator, e.g. `ctx 56k / 200k · 28%`. Kept here (like
// describeSchedule) so the wording is unit-tested and the webview stays a renderer.
export function describeContext(used: number, window: number, pending = false): string {
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  return `ctx ${k(used)} / ${k(window)} · ${contextPercent(used, window)}%${pending ? ' · restart waiting for task' : ''}`;
}

// What to do with a loop whose context crossed the threshold — the same two verbs
// `loopBoard.afterTask` exposes. A hard `stop` is deliberately not offered: an automatic action
// must never leave a slot silently dead.
export type ContextAction = 'clear' | 'recycle';
export const CONTEXT_ACTIONS: ContextAction[] = ['clear', 'recycle'];
export function sanitizeContextAction(value: unknown): ContextAction {
  return typeof value === 'string' && (CONTEXT_ACTIONS as string[]).includes(value) ? (value as ContextAction) : 'recycle';
}

// `loopBoard.contextLimit.percent`: 0 (or anything out of range/non-numeric) = the feature is off
// and no loop is ever restarted for its context size; the indicator still renders.
export function sanitizeContextPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > 100) return 0;
  return rounded;
}

// Whether a measurement should trip a restart. `trippedSession` is the session id that already
// tripped: the hysteresis that stops a loop from being restarted again and again while its
// measured value stays above the threshold in the SAME session (a restart or /clear starts a new
// session id, which re-arms by construction).
export function shouldTrip(
  percent: number,
  threshold: number,
  sessionId: string,
  trippedSession: string | undefined
): boolean {
  if (threshold <= 0) return false;
  if (percent < threshold) return false;
  return trippedSession !== sessionId;
}
