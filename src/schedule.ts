// Scheduled loop restarts (t-77d1) — pure logic only. NEVER import `vscode` or node typings here:
// this module is compiled by tsconfig.test.json (`types: []`) into out-test/ and unit-tested.
//
// A schedule is armed per loop from the sidebar's ♻ popover and lives in memory for the window
// session only (the controller owns the map and the timers). Everything about WHEN it fires, WHETHER
// it may fire, and what it becomes afterwards is decided here so it can be tested without a host.

import { LoopId, LOOP_IDS } from './model';

// Preset minute values offered as one-click choices in the popover; "Custom…" accepts any other
// positive integer number of minutes. Minutes are the ONLY unit — there is no hours/days selector.
export const PRESET_MINUTES: number[] = [15, 30, 60, 120, 240];

// setTimeout stores its delay in a signed 32-bit int; anything above this fires immediately instead
// of far in the future. ~24.8 days, so minutes-scale horizons are never near it — but an arming
// value big enough to overflow must be rejected rather than silently firing at once.
export const MAX_DELAY_MS = 2147483647;
export const MAX_MINUTES = Math.floor(MAX_DELAY_MS / 60000);

// Which of the three row buttons armed this schedule. Each button's LEFT-click still acts
// immediately; right-click schedules the same action for later.
export type LoopAction = 'start' | 'restart' | 'stop';

export const LOOP_ACTIONS: readonly LoopAction[] = ['start', 'restart', 'stop'];

export function isLoopAction(value: unknown): value is LoopAction {
  return typeof value === 'string' && (LOOP_ACTIONS as readonly string[]).includes(value);
}

// `force` only means something for the two actions that can kill a working terminal; a scheduled
// start interrupts nothing, so the popover hides the checkbox and the value is forced to false.
export function supportsForce(action: LoopAction): boolean {
  return action !== 'start';
}

// Whether a scheduled action still means anything by the time its timer elapses. A schedule is
// armed against a state that may well have changed since — the loop can be started or stopped by
// hand, or its terminal closed from the terminal panel — so the fire path checks this and SWALLOWS
// an action that no longer applies rather than doing something surprising (a `restart` armed for a
// loop that is now stopped must NOT silently start it).
export function appliesTo(action: LoopAction, running: boolean): boolean {
  return action === 'start' ? !running : running;
}

export interface RestartSchedule {
  loop: LoopId;
  action: LoopAction;
  minutes: number;
  repeat: boolean;
  force: boolean;
  // Absolute epoch ms of the next intended fire. With `repeat`, re-derived after each fire.
  nextFireAt: number;
  // True once the timer has fired but the restart was held back because the loop was busy (force
  // off). A pending restart waits indefinitely; at most one is ever pending per loop.
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
  loop: LoopId,
  action: LoopAction,
  minutes: number,
  repeat: boolean,
  force: boolean,
  now: number
): RestartSchedule {
  return {
    loop,
    action,
    minutes,
    repeat,
    force: supportsForce(action) && force,
    nextFireAt: now + minutes * 60000,
    pending: false,
  };
}

// Milliseconds from `now` until the schedule's next fire, floored at 0 so a schedule armed in the
// past (or restored after a long main-thread stall) fires on the next tick instead of never.
export function delayUntilFire(schedule: RestartSchedule, now: number): number {
  return Math.max(0, Math.min(MAX_DELAY_MS, schedule.nextFireAt - now));
}

// The one question the timer callback asks. `force` bypasses the check entirely; otherwise the
// restart is only allowed when this loop is not busy. "Busy" is never read from the terminal (its
// output is unreadable): the caller derives `busyLoops` from the two things that ARE on disk: any
// In-Progress task in `.loopboard/TODO.md` and a live subagent in the loop's session (t-sbag,
// t-0e99).
//
// `force` overriding BOTH is deliberate: force already means "interrupt whatever is running", and
// the consent modal taken at arm time names the killed subagents as well as the mid-flight task.
export function mayFire(schedule: RestartSchedule, busyLoops: readonly LoopId[]): boolean {
  // A scheduled start has no worker to cut off: spawning a terminal while a task is In Progress is
  // exactly what a human would want, so it never defers.
  if (!supportsForce(schedule.action)) return true;
  if (schedule.force) return true;
  return !busyLoops.includes(schedule.loop);
}

// The "do not restart this loop automatically" set (t-sbag, re-keyed by t-0e99): one orchestrator
// works every task through its subagents, so EVERY loop is busy while ANY task is In Progress,
// and a loop is busy on its own while its session has a live subagent (`withLiveAgents`).
export function busyLoops(tasks: readonly { phase: string }[], withLiveAgents: Iterable<LoopId>, loops: readonly LoopId[] = LOOP_IDS): LoopId[] {
  const busy = new Set<LoopId>(tasks.some((t) => t.phase === 'inprogress') ? loops : []);
  for (const loop of withLiveAgents) busy.add(loop);
  return [...busy];
}

// The idle edge `loopBoard.afterTask` acts on (t-0e99): the board's In-Progress count dropped to 0.
// Whose task it was no longer matters, since one loop did all of them.
export function inProgressEnded(prev: readonly { phase: string }[], next: readonly { phase: string }[]): boolean {
  const count = (tasks: readonly { phase: string }[]) => tasks.filter((t) => t.phase === 'inprogress').length;
  return count(prev) > 0 && count(next) === 0;
}

// Marks a schedule as waiting for its loop to go idle. Idempotent: at most one restart is ever
// pending per loop, so a repeating schedule cannot stack deferred fires.
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
  const verb = schedule.action;
  const suffix = schedule.repeat ? ` · every ${schedule.minutes}m` : '';
  if (schedule.pending) return `${verb} waiting for task${suffix}`;
  const mins = Math.max(0, Math.ceil((schedule.nextFireAt - now) / 60000));
  return `${verb} in ${mins}m${suffix}${schedule.force ? ' · force' : ''}`;
}
