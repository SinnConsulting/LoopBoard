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

// Where an on-demand open came from: the sidebar's "What's new?" link or the command palette.
export type WhatsNewSource = 'sidebar' | 'command';

// On demand (t-f070 review) there is no update to describe, so the tab shows the running version and
// links to that version's own release page; a version the numbers cannot place gets the list.
export function currentReleaseUrl(current: unknown): string {
  const v = parseVersion(current);
  return v ? `${RELEASES_URL}/tag/v${v.join('.')}` : RELEASES_URL;
}

// The `whats-new-open` debug line for an on-demand open. It never touches the last-seen version, so
// it can neither swallow nor replay the automatic tab after an update, and the line says so.
export function describeWhatsNewOnDemand(source: WhatsNewSource, current: string | undefined, url: string): string {
  const running = current === undefined ? 'running version unknown' : `running ${current}`;
  return `on demand (${source}) — ${running}, opened tab (${url}); last-seen version untouched`;
}

export type WhatsNewKind ='first-install' | 'same' | 'upgrade' | 'downgrade' | 'unparseable';

export interface WhatsNewDecision {
  kind: WhatsNewKind;
  // Open the tab now.
  show: boolean;
  // Write `current` as the new last-seen version. False only for an unchanged version.
  record: boolean;
  // The release-notes link — set only for an upgrade, shown or not.
  url?: string;
  // The running version, and the situation in words (`upgrade 3.25.0 → 3.26.0`) — the start of the
  // `whats-new` debug line, which describeWhatsNew completes with the outcome.
  current: string;
  what: string;
}

// `lastSeen` is whatever globalState holds (undefined on a first install); `current` is the running
// extension's package.json version. Every path but "same version" records `current`, so turning the
// setting back on later never replays an update the user already went through.
export function decideWhatsNew(lastSeen: unknown, current: string, settingOn: boolean): WhatsNewDecision {
  if (lastSeen === undefined) {
    return { kind: 'first-install', show: false, record: true, current, what: 'first install' };
  }
  if (lastSeen === current) {
    return { kind: 'same', show: false, record: false, current, what: `same version ${current}` };
  }
  const from = parseVersion(lastSeen);
  const to = parseVersion(current);
  if (!from || !to) {
    return {
      kind: 'unparseable', show: false, record: true, current,
      what: `unparseable version (last seen ${JSON.stringify(lastSeen)}, running ${JSON.stringify(current)})`,
    };
  }
  const order = compareVersions(to, from);
  if (order === 0) {
    // Numerically equal but spelled differently (e.g. surrounding whitespace in a stored value).
    return { kind: 'same', show: false, record: false, current, what: `same version ${current}` };
  }
  if (order < 0) {
    return { kind: 'downgrade', show: false, record: true, current, what: `downgrade ${lastSeen} → ${current}` };
  }
  const url = releaseNotesUrl(String(lastSeen), current);
  return { kind: 'upgrade', show: settingOn, record: true, url, current, what: `upgrade ${lastSeen} → ${current}` };
}

// The ONE `whats-new` debug line for an activation, once the controller has acted on the decision:
// recorded (or not) and the tab opened (or not). `recordError` is set when the globalState write
// failed — then the line says so instead of claiming "recorded", and a shown tab will show again on
// the next load (a fail-open, named as one).
export function describeWhatsNew(d: WhatsNewDecision, recordError?: string): string {
  if (!d.record) return d.what;
  const shown = d.show ? `opened tab (${d.url})` : d.kind === 'upgrade' ? 'setting off, not shown' : 'not shown';
  if (recordError !== undefined) {
    const again = d.show ? ', so it opens again on the next load' : '';
    return `${d.what} — ${shown}; could not record ${d.current} (${recordError})${again}`;
  }
  if (d.kind === 'first-install') return `${d.what} — recorded ${d.current}`;
  return `${d.what} — ${shown}; recorded ${d.current}`;
}
