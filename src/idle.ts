// Idle stop (t-2dd4) — pure logic only. NEVER import `vscode` or node typings here: this module is
// compiled by tsconfig.test.json (`types: []`) into out-test/ and unit-tested.
//
// "Idle" is the controller's `busyModels` complement and nothing else (human decision, 2026-09-25):
// a slot with no In-Progress task and no live Agent-tool subagent. The clock starts at the first
// observation that finds the slot out of the busy set and is cleared by the first one that finds it
// back in — a `/loop` tick or an unrelated board edit observes "still idle" and leaves it alone, so
// the clock measures minutes without work, not minutes since the last write. The controller owns
// the per-slot state map and its timers (session-only, like the restart schedules); everything
// about WHEN the warning and the stop are due, and what the row says, is decided here.

import { Model } from './model';
import { MAX_MINUTES } from './schedule';

// How long the warning popup stands before the stop goes ahead (decision 2).
export const IDLE_WARN_MS = 30000;

// `loopBoard.idleStop.minutes`' manifest default, and what any invalid value falls back to.
export const DEFAULT_IDLE_MINUTES = 60;

export interface IdleState {
  // Epoch ms of the first observation that found the slot idle; undefined = no clock running.
  idleSince: number | undefined;
  // Epoch ms the 30 s warning went up; undefined = no warning open.
  warnedAt: number | undefined;
}

// A whole number of minutes in the timer's range, or the default. Anything else — a decimal, a
// string, 0, a negative, a value past what `setTimeout` can hold — is not a guess worth making.
export function sanitizeIdleMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_MINUTES) {
    return DEFAULT_IDLE_MINUTES;
  }
  return value;
}

// No clock, no warning. Used on spawn, recycle and ■, and whenever the feature is off.
export function resetIdle(): IdleState {
  return { idleSince: undefined, warnedAt: undefined };
}

// One observation of one slot against the controller's `busyModels`. Busy clears everything (the
// clock never runs while the slot is busy, and an open warning is superseded); idle starts the
// clock only if none is running; anything else returns the state unchanged.
export function observeIdle(state: IdleState, model: Model, busy: readonly Model[], now: number): IdleState {
  if (busy.includes(model)) {
    return state.idleSince === undefined && state.warnedAt === undefined ? state : resetIdle();
  }
  if (state.idleSince === undefined) return { idleSince: now, warnedAt: undefined };
  return state;
}

// When the warning is due: 30 s before the slot has been idle `minutes`. Undefined = no clock.
export function idleWarnAt(state: IdleState, minutes: number): number | undefined {
  return state.idleSince === undefined ? undefined : state.idleSince + minutes * 60000 - IDLE_WARN_MS;
}

// When the stop is due: 30 s after the warning went up. Undefined = no warning open.
export function idleStopAt(state: IdleState): number | undefined {
  return state.warnedAt === undefined ? undefined : state.warnedAt + IDLE_WARN_MS;
}

// The warning went up.
export function markWarned(state: IdleState, now: number): IdleState {
  return { ...state, warnedAt: now };
}

// The human clicked `Keep running`: the clock starts over from now and the warning is gone.
export function keepRunning(_state: IdleState, now: number): IdleState {
  return { idleSince: now, warnedAt: undefined };
}

// What the slot looks like at a timer's fire time, re-read by the controller then — never
// remembered from when the timer was armed. `enabled` is re-read from configuration because a
// change made while the settings page is closed triggers no refresh (t-sgrp); `busy` is
// `busyModels` on the last loaded board (false only when a board IS loaded).
export interface IdleFireContext {
  enabled: boolean;
  running: boolean;
  busy: boolean;
  minutes: number;
  now: number;
}

export type IdleWarnDecision =
  | { act: 'reset'; reason: 'disabled' | 'loop is not running' }
  | { act: 'hold' }
  | { act: 'rearm'; at: number }
  | { act: 'warn' };

// The warning timer fired. Never forced: a slot that turned busy since the timer was armed holds
// (the clock restarts from the next idle edge), and a `minutes` raised since then re-arms instead
// of warning early.
export function decideIdleWarn(state: IdleState, ctx: IdleFireContext): IdleWarnDecision {
  if (!ctx.enabled) return { act: 'reset', reason: 'disabled' };
  if (!ctx.running) return { act: 'reset', reason: 'loop is not running' };
  if (ctx.busy) return { act: 'hold' };
  const at = idleWarnAt(state, ctx.minutes);
  if (at === undefined) return { act: 'reset', reason: 'loop is not running' };
  if (ctx.now < at) return { act: 'rearm', at };
  return { act: 'warn' };
}

export type IdleStopDecision = 'stop' | 'hold' | 'superseded';

// The stop is due — the 30 s ran out, or the human clicked `Stop now`. `warnedAt` is the stamp of
// the warning that asked; a slot whose state no longer carries it was reset in the meantime (♻, ■,
// ▶, the terminal closed, the feature turned off, or a busy observation), and a late click on that
// old popup must never stop the session that replaced it. Busy at fire time holds, never forces.
export function decideIdleStop(state: IdleState | undefined, warnedAt: number, ctx: IdleFireContext): IdleStopDecision {
  if (!state || state.warnedAt !== warnedAt) return 'superseded';
  if (!ctx.enabled || !ctx.running) return 'superseded';
  if (ctx.busy) return 'hold';
  return 'stop';
}

// The sidebar row's line. '' when there is no clock — the row then draws nothing.
export function describeIdle(state: IdleState, minutes: number, now: number): string {
  const stopAt = idleStopAt(state);
  if (stopAt !== undefined) return `stopping in ${Math.max(0, Math.ceil((stopAt - now) / 1000))}s`;
  if (state.idleSince === undefined) return '';
  const idle = Math.max(0, Math.floor((now - state.idleSince) / 60000));
  return `idle ${idle}m · stop at ${minutes}m`;
}

// The `idle-stop` log line's basis (the debug-trace rule: an automatic action that went ahead says
// why it was allowed to). An idle stop never fires while a subagent is SEEN live, so it names no
// killed agents; what it can name is the fail-open — a slot whose last subagent read failed counted
// as having none, and a subagent that read could not see dies with the session.
export function describeIdleStop(state: IdleState, now: number, subagentsUnreadable: boolean): string {
  const idle = state.idleSince === undefined ? 0 : Math.max(0, Math.floor((now - state.idleSince) / 60000));
  const agents = subagentsUnreadable
    ? 'no live subagents seen (session unreadable — counted as none, fail-open; an unseen subagent dies with the session)'
    : 'no live subagents seen';
  return `idle ${idle}m — no task in progress, ${agents}`;
}
