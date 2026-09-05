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

// NOTE: the transcript's directory is deliberately NOT derived from the workspace path. Claude Code
// encodes it as `[^a-zA-Z0-9]` -> `-`, hash-suffixes anything past 200 chars, and canonicalises
// git-worktree roots first — reproducing that here was wrong for any path containing a `.`, `_` or
// space (t-2b89 review), and silently so: a mismatch just means "no bar, ever". The reader instead
// looks up the transcript BY SESSION ID across `~/.claude/projects/*/`, which needs no encoding
// rules at all.

// Context window of a slot. Nothing on disk records it — Claude Code computes it in-process from
// its own model registry — so it has to be derived from the model id, and the `[1m]` SUFFIX alone
// is not enough: the 5-series models carry a 1M window natively with no suffix (observed against a
// live `--model sonnet` loop whose CLI status line read `61k/1000k`, and against the registry
// entries inside the 2.1.261 CLI: opus-4-6/4-7/4-8, opus-5, sonnet-4-6, sonnet-5 and fable-5 are
// all 1e6, while opus-4-1/4-5 and sonnet-4-0/4-5 are 200k). Getting this wrong is not cosmetic —
// a 200k assumption on a 1M model reports 5x the real percentage and trips a threshold restart
// four times too early.
export const DEFAULT_WINDOW = 200000;
export const LARGE_WINDOW = 1000000;
// Model ids known to carry the 1M window natively, matched as substrings of the transcript's
// `message.model` (e.g. `claude-sonnet-5`) or of the configured `--model` string (e.g. `sonnet`).
// A model missing from this list falls back to 200k, which is the conservative direction for the
// INDICATOR but the eager one for the threshold — hence the list is kept explicit and is checked
// against the CLI whenever a new model ships.
const LARGE_WINDOW_MODELS = ['opus-5', 'sonnet-5', 'fable-5', 'opus-4-6', 'opus-4-7', 'opus-4-8', 'sonnet-4-6'];

// `transcriptModel` is the model id of the line we actually measured (`message.model`) and is
// preferred when present: it is what ran, whereas the configured `--model` string may be an alias
// (`sonnet`), an org name, or simply out of date relative to a still-running terminal.
export function windowSizeFor(modelString: string, transcriptModel?: string): number {
  const id = (transcriptModel || modelString || '').toLowerCase();
  if (/\[1m\]/i.test(modelString) || /\[1m\]/i.test(id)) return LARGE_WINDOW;
  // A bare alias resolves through the same list: `sonnet` alone is today's Sonnet 5 (1M), and the
  // slot ids LoopBoard spawns (`opus`/`sonnet`/`fable`) are exactly those aliases.
  const alias = { opus: 'opus-5', sonnet: 'sonnet-5', fable: 'fable-5' }[id];
  const needle = alias || id;
  return LARGE_WINDOW_MODELS.some((m) => needle.includes(m)) ? LARGE_WINDOW : DEFAULT_WINDOW;
}

// What a `~/.claude/sessions/<pid>.json` tells us. Only these three fields are load-bearing; the
// rest of that file (messaging socket, peer protocol, timestamps) is none of our business.
export interface SessionPointer {
  sessionId: string;
  cwd: string;
  name: string;
  updatedAt: number; // ms epoch; 0 when the file carries no usable timestamp
}

export function parseSessionPointer(text: string): SessionPointer | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const o = raw as { sessionId?: unknown; cwd?: unknown; name?: unknown; updatedAt?: unknown } | null;
  if (!o || typeof o.sessionId !== 'string' || typeof o.cwd !== 'string') return undefined;
  const stamp = typeof o.updatedAt === 'number' ? o.updatedAt : Date.parse(String(o.updatedAt ?? ''));
  return {
    sessionId: o.sessionId,
    cwd: o.cwd,
    name: typeof o.name === 'string' ? o.name : '',
    updatedAt: Number.isFinite(stamp) ? (stamp as number) : 0,
  };
}

// Several session files can match one slot: two VSCode windows on the same folder, or a stale
// `<pid>.json` left behind by a SIGKILLed process. Taking whichever the directory listed first
// showed another process's number and could fire a spurious restart on a healthy loop (t-2b89
// review), so the freshest `updatedAt` wins. Ties keep the first match — with no timestamps to
// separate them there is nothing better to go on.
export function newestPointer(pointers: SessionPointer[]): SessionPointer | undefined {
  let best: SessionPointer | undefined;
  for (const p of pointers) if (!best || p.updatedAt > best.updatedAt) best = p;
  return best;
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

// The wording for the configured threshold, shown as the orange zone's tooltip on the bar so the
// zone is never an unexplained colour. Empty when the feature is off (`percent: 0`) — the bar then
// carries no zone at all, because there is no point at which the session would be restarted.
export function describeThreshold(threshold: number, action: ContextAction): string {
  if (threshold <= 0) return '';
  return `${action === 'clear' ? '/clear' : 'restart'} at ${threshold}%`;
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
// measured value stays above the threshold in the SAME session.
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

// The down edge that re-arms the hysteresis. Keying it on the session id alone assumed every reset
// starts a NEW session, which is not guaranteed: `/clear` reuses the process, and auto-compaction
// drops usage inside the same session id — either way the loop climbed back over the threshold and
// could never trip again (t-2b89 review). Re-arm once a reading comes back below the threshold,
// with a small band so a value hovering on the line cannot restart the loop every poll.
export const TRIP_RESET_BAND = 5;
export function shouldClearTrip(percent: number, threshold: number): boolean {
  if (threshold <= 0) return false;
  return percent <= Math.max(0, threshold - TRIP_RESET_BAND);
}
