// Host/webview build-mismatch check (t-5831). Pure: no vscode imports — the controller stats the
// files and logs; this module only says which files to stat and whether two stamps differ.
//
// A running extension host keeps the modules it loaded at activation, but every newly created
// board panel re-reads its HTML/CSS/JS from the extension directory. Installing a new build under
// a running window therefore pairs a NEW webview with an OLD host. The version number cannot tell
// them apart (two builds can both say 3.21.1), so the stamp identifies the files themselves: size
// and mtime of every media/ asset the board and sidebar webviews load.

// Relative to the extension's `media/` directory. `markdown.js` is the shared renderer the board
// page loads ahead of board.js (src/webview.ts), so it is part of what the board runs.
export const WEBVIEW_ASSETS = ['board.html', 'board.css', 'board.js', 'markdown.js', 'sidebar.html', 'sidebar.css', 'sidebar.js'];

export interface AssetStamp {
  size: number;
  mtime: number;
}

// One entry per asset; `null` = the file could not be stat'ed (missing).
export type BuildStamp = Record<string, AssetStamp | null>;

// True when the two stamps describe different files. A size or mtime change on any asset is a
// mismatch, and so is a file missing on EITHER side: an unreadable asset can never be vouched for.
export function stampsDiffer(a: BuildStamp, b: BuildStamp): boolean {
  const names = new Set([...WEBVIEW_ASSETS, ...Object.keys(a), ...Object.keys(b)]);
  for (const name of names) {
    const x = a[name];
    const y = b[name];
    if (!x || !y) return true;
    if (x.size !== y.size || x.mtime !== y.mtime) return true;
  }
  return false;
}

// One-line rendering for the debug log: `board.js 81234@1727290000000, …, sidebar.js missing`.
export function describeStamp(s: BuildStamp): string {
  return Object.keys(s)
    .map((name) => {
      const v = s[name];
      return v ? `${name} ${v.size}@${v.mtime}` : `${name} missing`;
    })
    .join(', ');
}
