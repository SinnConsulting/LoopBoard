// Show some love (t-b6fa) — pure logic only. NEVER import `vscode` or node typings here: this module
// is compiled by tsconfig.test.json (`types: []`) into out-test/ and unit-tested.
//
// A thank-you card in the sidebar that links to a GitHub star, a Marketplace rating and r/LoopBoard.
// It shows at the 10th task accepted on the board (per VS Code profile, counted in globalState by the
// controller); "Maybe later" brings it back ONCE, 25 accepts later; "No thanks" or any link ends it.
// The `loopBoard.showLove` command shows it on demand and never reads or writes the count or state.
// The webview posts only a choice key; every URL is decided here, and nothing here fetches anything.

export const LOVE_FIRST_AT = 10;
export const LOVE_LATER_GAP = 25;

export const LOVE_GITHUB_URL = 'https://github.com/SinnConsulting/LoopBoard';
export const LOVE_MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=SinnConsulting.loopboard-todo&ssr=false#review-details';
export const LOVE_REDDIT_URL = 'https://www.reddit.com/r/LoopBoard/';

export type LoveLinkKey = 'github' | 'marketplace' | 'reddit';
export type LoveChoice = LoveLinkKey | 'later' | 'nothanks' | 'close';

// fresh = no choice recorded yet; snoozed = "Maybe later" on the first card; ended = never again.
export type LoveState = { kind: 'fresh' } | { kind: 'snoozed'; until: number } | { kind: 'ended' };

// Which card the sidebar is showing: the automatic first / final one, the command's on-demand one,
// or none at all.
export type LoveCard = 'first' | 'final' | 'ondemand' | 'none';

// A switch, not a lookup table: `constructor`, `__proto__` and friends must map to nothing.
export function loveLinkUrl(key: unknown): string | undefined {
  switch (key) {
    case 'github': return LOVE_GITHUB_URL;
    case 'marketplace': return LOVE_MARKETPLACE_URL;
    case 'reddit': return LOVE_REDDIT_URL;
    default: return undefined;
  }
}

export function isLoveChoice(v: unknown): v is LoveChoice {
  return v === 'later' || v === 'nothanks' || v === 'close' || loveLinkUrl(v) !== undefined;
}

// The stored counter. Anything but a non-negative safe integer reads as 0.
export function loveCount(raw: unknown): number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
}

// The stored state. A value of an unknown shape reads as fresh.
export function parseLoveState(raw: unknown): LoveState {
  if (raw && typeof raw === 'object') {
    const r = raw as { kind?: unknown; until?: unknown };
    if (r.kind === 'ended') return { kind: 'ended' };
    if (r.kind === 'snoozed' && typeof r.until === 'number' && Number.isSafeInteger(r.until) && r.until >= 0) {
      return { kind: 'snoozed', until: r.until };
    }
  }
  return { kind: 'fresh' };
}

// What goes into globalState: fresh is the absent key.
export function serializeLoveState(s: LoveState): LoveState | undefined {
  return s.kind === 'fresh' ? undefined : s;
}

export interface LoveDecision {
  kind: 'first' | 'final' | 'not-yet' | 'snoozed' | 'ended';
  show: boolean;
  final: boolean;
  reason: string;
}

export function decideLove(count: number, state: LoveState): LoveDecision {
  if (state.kind === 'ended') return { kind: 'ended', show: false, final: false, reason: 'ended, not shown' };
  if (state.kind === 'snoozed') {
    if (count < state.until) return { kind: 'snoozed', show: false, final: false, reason: `snoozed until ${state.until}` };
    const reason = count === state.until
      ? `snoozed until ${state.until}, reached — final card shown`
      : `snoozed until ${state.until}, passed — final card still showing (no choice yet)`;
    return { kind: 'final', show: true, final: true, reason };
  }
  if (count < LOVE_FIRST_AT) return { kind: 'not-yet', show: false, final: false, reason: `${count}/${LOVE_FIRST_AT}, not yet` };
  const reason = count === LOVE_FIRST_AT
    ? `${count}/${LOVE_FIRST_AT} reached — first card shown`
    : `${count}/${LOVE_FIRST_AT} passed — first card still showing (no choice yet)`;
  return { kind: 'first', show: true, final: false, reason };
}

// The next state after a choice on an automatic card. On the first card "Maybe later" snoozes until
// count + 25; everything else — and ANY choice on the final (snoozed) card — ends it. `close` is the
// on-demand card's button and changes nothing.
export function applyLoveChoice(state: LoveState, choice: LoveChoice, count: number): LoveState {
  if (choice === 'close') return state;
  if (state.kind === 'fresh' && choice === 'later') return { kind: 'snoozed', until: count + LOVE_LATER_GAP };
  return { kind: 'ended' };
}

// The sidebar's card: the automatic one wins; otherwise the on-demand one while the command's session
// flag is up; otherwise none.
export function loveView(count: number, state: LoveState, onDemand: boolean): { count: number; final: boolean; onDemand: boolean } | null {
  const d = decideLove(count, state);
  if (d.show) return { count, final: d.final, onDemand: false };
  return onDemand ? { count, final: false, onDemand: true } : null;
}

export function loveCardOf(count: number, state: LoveState, onDemand: boolean): LoveCard {
  const v = loveView(count, state, onDemand);
  return !v ? 'none' : v.onDemand ? 'ondemand' : v.final ? 'final' : 'first';
}

export interface LoveChoicePlan {
  choice: string;
  card: LoveCard;
  // The state to write; undefined = write nothing.
  write?: LoveState;
  // Drop the on-demand session flag (the card goes away).
  hide: boolean;
  // The link to open; undefined = open nothing.
  url?: string;
  // The `love-choice` debug line's text before any write outcome (describeLoveChoice completes it).
  what: string;
}

const CARD_NAME: Record<LoveCard, string> = {
  first: 'the first card', final: 'the final card', ondemand: 'the on-demand card', none: 'no card showing',
};

// Everything the controller does for a `{ type: 'love', choice }` message, decided from the key alone.
// Only an automatic card writes state; the on-demand card (and a stale click with no card showing)
// never touches the counter or the state.
export function planLoveChoice(card: LoveCard, state: LoveState, rawChoice: unknown, count: number): LoveChoicePlan {
  if (!isLoveChoice(rawChoice)) {
    const shown = typeof rawChoice === 'string' ? JSON.stringify(rawChoice) : String(rawChoice);
    return { choice: shown, card, hide: false, what: `unknown choice ${shown} on ${CARD_NAME[card]} — ignored, nothing opened` };
  }
  const choice = rawChoice;
  const url = loveLinkUrl(choice);
  const on = card === 'none' ? 'with no card showing' : `on ${CARD_NAME[card]}`;
  if (card === 'first' || card === 'final') {
    if (choice === 'close') return { choice, card, hide: false, what: `close ${on} — not offered there, ignored` };
    const next = applyLoveChoice(state, choice, count);
    const outcome = next.kind === 'snoozed'
      ? `snoozed until ${next.until}`
      : card === 'final' && choice === 'later' ? 'ended (no second snooze)' : 'ended';
    return { choice, card, write: next, hide: true, url, what: `${choice} ${on} — ${outcome}` };
  }
  if (choice === 'later' || choice === 'nothanks') {
    return { choice, card, hide: false, what: `${choice} ${on} — not offered there, ignored` };
  }
  const hidden = card === 'ondemand' ? 'hidden' : 'nothing to hide';
  return { choice, card, hide: true, url, what: `${choice} ${on} — ${hidden}; counter and state untouched` };
}

// ---- debug-line builders (logged by the controller through store.debugLog) ----

// `love` (info), once per applied board accept. `countError` names a failed counter write.
export function describeLove(count: number, d: LoveDecision, countError?: string): string {
  const counted = countError === undefined ? `accept counted (${count})` : `could not record count ${count} (${countError})`;
  return `${counted} — ${d.reason}`;
}

// `love-open` (info): the command's on-demand card.
export function describeLoveOpen(): string {
  return 'on demand (command) — card shown; counter and state untouched';
}

// `love-choice` (info). `writeError` names a failed state write — the card then shows again.
export function describeLoveChoice(plan: LoveChoicePlan, writeError?: string): string {
  if (writeError === undefined || !plan.write) return plan.what;
  return `${plan.what}; could not record it (${writeError}), so the card shows again`;
}

// `love-link` (info): the same outcome wording as `whats-new-link`.
export function describeLoveLink(url: string, outcome: { opened: boolean } | { error: string }): string {
  if ('error' in outcome) return `${url} — failed — ${outcome.error}`;
  return `${url} — ${outcome.opened ? 'opened' : 'not opened (no handler took it)'}`;
}
