// Scheduled loop restarts (t-77d1) — pure logic only. NEVER import `vscode` or node typings here:
// this module is compiled by tsconfig.test.json (`types: []`) into out-test/ and unit-tested.
//
// A schedule is armed per model from the sidebar's ♻ popover and lives in memory for the window
// session only (the controller owns the map and the timers). Everything about WHEN it fires, WHETHER
// it may fire, and what it becomes afterwards is decided here so it can be tested without a host.

import { Model } from './model';

// Preset minute values offered as one-click choices in the popover; "Custom…" accepts any other
// positive integer number of minutes. Minutes are the ONLY unit — there is no hours/days selector.
export const PRESET_MINUTES: number[] = [15, 30, 60, 120, 240];

// setTimeout stores its delay in a signed 32-bit int; anything above this fires immediately instead
// of far in the future. ~24.8 days, so minutes-scale horizons are never near it — but an arming
// value big enough to overflow must be rejected rather than silently firing at once.
export const MAX_DELAY_MS = 2147483647;
export const MAX_MINUTES = Math.floor(MAX_DELAY_MS / 60000);

export interface RestartSchedule {
  model: Model;
  minutes: number;
  repeat: boolean;
  force: boolean;
  // Absolute epoch ms of the next intended fire. With `repeat`, re-derived after each fire.
  nextFireAt: number;
  // True once the timer has fired but the restart was held back because the model was mid-task
  // (force off). A pending restart waits indefinitely; at most one is ever pending per model.
  pending: boolean;
}

// Parses the popover's "Custom…" field. Returns null for anything that is not a positive whole
// number of minutes within the timer's range — the caller shows the message and arms nothing.
// Deliberately strict: no unit suffixes, no decimals, no leading `+`, so "90m" or "1.5" are
// rejected rather than silently reinterpreted (minutes are the only unit this dialog speaks).
export function parseMinutes(raw: string): number | null {
  const text = (raw || '').trim();
  if (!/^\d+$/.test(text)) return null;
  const minutes = Number(text);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) return null;
  return minutes;
}

export function armSchedule(
  model: Model,
  minutes: number,
  repeat: boolean,
  force: boolean,
  now: number
): RestartSchedule {
  return { model, minutes, repeat, force, nextFireAt: now + minutes * 60000, pending: false };
}

// Milliseconds from `now` until the schedule's next fire, floored at 0 so a schedule armed in the
// past (or restored after a long main-thread stall) fires on the next tick instead of never.
export function delayUntilFire(schedule: RestartSchedule, now: number): number {
  return Math.max(0, Math.min(MAX_DELAY_MS, schedule.nextFireAt - now));
}

// The one question the timer callback asks. `force` bypasses the check entirely; otherwise the
// restart is only allowed when this model does not own an In-Progress task. "Busy" is knowable ONLY
// from the tracker (terminal output can never be read), so `inProgressModels` is derived from
// `.loopboard/TODO.md` by the caller, with an absent `model:` already resolved to the default.
export function mayFire(schedule: RestartSchedule, inProgressModels: readonly Model[]): boolean {
  if (schedule.force) return true;
  return !inProgressModels.includes(schedule.model);
}

// Marks a schedule as waiting for its model to go idle. Idempotent — at most one restart is ever
// pending per model, so a repeating schedule cannot stack deferred fires.
export function deferSchedule(schedule: RestartSchedule): RestartSchedule {
  return schedule.pending ? schedule : { ...schedule, pending: true };
}

// What the schedule becomes once a restart has actually been performed. A one-shot disarms
// (returns null); a repeating one re-arms for another `minutes` measured from the moment it really
// fired — NOT from its original slot — so a long deferral never causes a burst of catch-up
// restarts.
export function afterFire(schedule: RestartSchedule, now: number): RestartSchedule | null {
  if (!schedule.repeat) return null;
  return { ...schedule, nextFireAt: now + schedule.minutes * 60000, pending: false };
}

// One-line summary for the sidebar row's armed/pending indicator. Kept here rather than in the
// webview so the wording is unit-tested and the webview stays a renderer.
export function describeSchedule(schedule: RestartSchedule, now: number): string {
  const suffix = schedule.repeat ? ` · every ${schedule.minutes}m` : '';
  if (schedule.pending) return `restart waiting for task${suffix}`;
  const mins = Math.max(0, Math.ceil((schedule.nextFireAt - now) / 60000));
  return `restart in ${mins}m${suffix}${schedule.force ? ' · force' : ''}`;
}
