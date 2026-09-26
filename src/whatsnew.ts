// What's new after an update (t-f070) — pure logic only. NEVER import `vscode` or node typings here:
// this module is compiled by tsconfig.test.json (`types: []`) into out-test/ and unit-tested.
//
// On every activation the controller hands this module the version it last recorded in globalState
// and the version now running, plus `loopBoard.showWhatsNew`; it gets back whether to open the
// What's New tab, whether to record the running version, and a reason line for the debug trace.
// The tab only LINKS to the GitHub release notes — nothing here or in the host fetches anything.

export const RELEASES_URL = 'https://github.com/SinnConsulting/LoopBoard/releases';

export type Version = [number, number, number];

// Strict `major.minor.patch`, digits only. Anything else (a pre-release suffix, a corrupt stored
// value, a non-string) is unparseable, and an unparseable version never opens the tab.
export function parseVersion(v: unknown): Version | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

// Numeric, part by part — so 3.10.0 is newer than 3.9.0, which a string compare gets wrong.
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// A one-version step, judged from the numbers alone (the release history is not known offline):
// the next patch, the next minor at .0, or the next major at .0.0. Anything further is a skip.
export function isOneStep(from: Version, to: Version): boolean {
  const [fM, fm, fp] = from;
  const [tM, tm, tp] = to;
  if (tM === fM && tm === fm) return tp === fp + 1;
  if (tM === fM) return tm === fm + 1 && tp === 0;
  return tM === fM + 1 && tm === 0 && tp === 0;
}

// The tag's release page for a one-version step, the releases list for a skip (or anything the
// numbers cannot place).
export function releaseNotesUrl(lastSeen: string, current: string): string {
  const from = parseVersion(lastSeen);
  const to = parseVersion(current);
  if (from && to && isOneStep(from, to)) return `${RELEASES_URL}/tag/v${to.join('.')}`;
  return RELEASES_URL;
}

export type WhatsNewKind = 'first-install' | 'same' | 'upgrade' | 'downgrade' | 'unparseable';

export interface WhatsNewDecision {
  kind: WhatsNewKind;
  // Open the tab now.
  show: boolean;
  // Write `current` as the new last-seen version. False only for an unchanged version.
  record: boolean;
  // The release-notes link — set only for an upgrade, shown or not.
  url?: string;
  // The `whats-new` debug line's detail, minus the controller's own outcome ("opened tab").
  reason: string;
}

// `lastSeen` is whatever globalState holds (undefined on a first install); `current` is the running
// extension's package.json version. Every path but "same version" records `current`, so turning the
// setting back on later never replays an update the user already went through.
export function decideWhatsNew(lastSeen: unknown, current: string, settingOn: boolean): WhatsNewDecision {
  if (lastSeen === undefined) {
    return { kind: 'first-install', show: false, record: true, reason: `first install — recorded ${current}` };
  }
  if (lastSeen === current) {
    return { kind: 'same', show: false, record: false, reason: `same version ${current}` };
  }
  const from = parseVersion(lastSeen);
  const to = parseVersion(current);
  if (!from || !to) {
    return {
      kind: 'unparseable', show: false, record: true,
      reason: `unparseable version (last seen ${JSON.stringify(lastSeen)}, running ${JSON.stringify(current)}) — recorded ${current}, not shown`,
    };
  }
  const order = compareVersions(to, from);
  if (order === 0) {
    // Numerically equal but spelled differently (e.g. surrounding whitespace in a stored value).
    return { kind: 'same', show: false, record: false, reason: `same version ${current}` };
  }
  if (order < 0) {
    return { kind: 'downgrade', show: false, record: true, reason: `downgrade ${lastSeen} → ${current} — recorded, not shown` };
  }
  const url = releaseNotesUrl(String(lastSeen), current);
  if (!settingOn) {
    return { kind: 'upgrade', show: false, record: true, url, reason: `upgrade ${lastSeen} → ${current} — setting off, not shown` };
  }
  return { kind: 'upgrade', show: true, record: true, url, reason: `upgrade ${lastSeen} → ${current}` };
}
