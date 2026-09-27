// When to post a sidebar `reveal` into the board webview (t-7440). Pure: no vscode import.
//
// The board panel runs with `retainContextWhenHidden: false`, so a hidden panel has no live
// webview: `reveal()` rebuilds its HTML and script, and a `postMessage` sent meanwhile is dropped.
// A new panel is the same case. Both must wait for the webview's `ready`, which flushes the
// pending reveal; only an already-visible panel can take the reveal right away.

export type RevealReason = 'new panel' | 'hidden panel' | 'visible panel';

export interface RevealTiming {
  postNow: boolean;
  reason: RevealReason;
}

export function revealTiming(created: boolean, wasVisible: boolean): RevealTiming {
  if (created) return { postNow: false, reason: 'new panel' };
  if (!wasVisible) return { postNow: false, reason: 'hidden panel' };
  return { postNow: true, reason: 'visible panel' };
}

// The `board-reveal` debug line (verbose).
export function describeRevealTiming(t: RevealTiming): string {
  return `${t.postNow ? 'posted now' : 'deferred to ready'} (${t.reason})`;
}
