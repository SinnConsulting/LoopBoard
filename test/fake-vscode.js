/* Fake `vscode` module for the host-side suite (test/host.test.js).
 *
 * WHY: src/store.ts, src/controller.ts, src/panel.ts and src/webview.ts all `import * as vscode`,
 * so they compile only under the MAIN tsconfig (-> out/) and were previously reachable only
 * through the F5 manual checklist. There is no @types/node and no @vscode/test-electron in this
 * repo (CLAUDE.md non-negotiable #2), so instead of booting VS Code we resolve `require('vscode')`
 * to this file and run the compiled `out/` modules as plain CommonJS.
 *
 * The surface below is EXACTLY what those four modules touch (derived from
 * `grep -n 'vscode\.' src/*.ts`). Everything else throws: each namespace is wrapped in a Proxy
 * that raises on an unknown property, so a src change that starts using a new VS Code API fails
 * loudly here instead of silently reading `undefined`.
 *
 * File IO is real, against a temp directory the test mounts from test/fixtures — `workspace.fs`
 * is a thin adapter over node:fs, which keeps store.ts's atomic temp+rename honest.
 */
'use strict';

const fs = require('node:fs');
const nodePath = require('node:path');
const Module = require('node:module');

// ---------------------------------------------------------------- recording state

const recorded = {
  // Every window.show*Message call: { kind, message, options, items }.
  messages: [],
  // Scripted answers, shifted one per show*Message call. `undefined` = user dismissed.
  answers: [],
  // Every commands.executeCommand call: { command, args }.
  commands: [],
  // Every env.openExternal call, as a string.
  external: [],
  // Every webview panel created through window.createWebviewPanel.
  panels: [],
  // Explicitly-set configuration values, keyed `loopBoard.<key>`. Anything absent falls back to
  // the caller's own default, which is how package.json defaults behave at runtime.
  config: new Map(),
};

function reset() {
  recorded.messages.length = 0;
  recorded.answers.length = 0;
  recorded.commands.length = 0;
  recorded.external.length = 0;
  recorded.panels.length = 0;
  recorded.config.clear();
}

// Queue the next show*Message return value(s).
function answerWith(...values) {
  recorded.answers.push(...values);
}

function setConfig(key, value) {
  recorded.config.set(key, value);
}

function lastPanel() {
  return recorded.panels[recorded.panels.length - 1];
}

// A vscode.Memento stand-in (globalState) — an interface at compile time, so there is nothing to
// stub on the namespace itself.
function createMemento(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    keys: () => [...map.keys()],
    get: (key, dflt) => (map.has(key) ? map.get(key) : dflt),
    update: (key, value) => {
      if (value === undefined) map.delete(key);
      else map.set(key, value);
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------- strict namespaces

// Proxy that throws on any property the real code touches but this fake does not implement, so a
// gap surfaces as a failing test naming the missing API rather than an `undefined is not a
// function` deep inside out/.
function strict(name, target) {
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      // `__esModule` keeps tsc's __importStar helper from copying (and thereby un-proxying) the
      // namespace; `then` keeps an accidental `await` on it from exploding; symbols are probed by
      // node internals (util.inspect, Symbol.toStringTag) and must stay silent.
      if (prop === '__esModule') return true;
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      throw new Error(`fake-vscode: unstubbed ${name}.${String(prop)} — add it to test/fake-vscode.js`);
    },
  });
}

// ---------------------------------------------------------------- Uri

function joinPosix(base, parts) {
  const joined = [base].concat(parts).join('/');
  return nodePath.posix.normalize(joined);
}

class Uri {
  constructor(scheme, authority, path, query, fragment) {
    this.scheme = scheme;
    this.authority = authority || '';
    this.path = path || '';
    this.query = query || '';
    this.fragment = fragment || '';
  }
  get fsPath() {
    return this.path;
  }
  with(change) {
    return new Uri(
      change.scheme === undefined ? this.scheme : change.scheme,
      change.authority === undefined ? this.authority : change.authority,
      change.path === undefined ? this.path : change.path,
      change.query === undefined ? this.query : change.query,
      change.fragment === undefined ? this.fragment : change.fragment
    );
  }
  toString() {
    const q = this.query ? `?${this.query}` : '';
    const f = this.fragment ? `#${this.fragment}` : '';
    return `${this.scheme}://${this.authority}${this.path}${q}${f}`;
  }
  static file(p) {
    return new Uri('file', '', p, '', '');
  }
  static parse(value) {
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(String(value));
    // No scheme (e.g. a workspace-relative attachment path) — real VS Code is lenient here too,
    // and controller.ts only ever reads `.scheme` to decide whether to hand it to the OS.
    if (!m) return new Uri('', '', String(value), '', '');
    return new Uri(m[1], m[2] || '', m[3] || '', m[4] || '', m[5] || '');
  }
  static joinPath(base, ...parts) {
    return base.with({ path: joinPosix(base.path, parts) });
  }
}

// ---------------------------------------------------------------- workspace.fs

const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

const workspaceFs = strict('workspace.fs', {
  async readFile(uri) {
    return new Uint8Array(await fs.promises.readFile(uri.fsPath));
  },
  async writeFile(uri, bytes) {
    await fs.promises.writeFile(uri.fsPath, Buffer.from(bytes));
  },
  async rename(from, to, options) {
    if (!(options && options.overwrite) && fs.existsSync(to.fsPath)) {
      throw new Error(`fake-vscode: rename target exists: ${to.fsPath}`);
    }
    await fs.promises.rename(from.fsPath, to.fsPath);
  },
  async stat(uri) {
    const s = await fs.promises.stat(uri.fsPath);
    return {
      type: s.isDirectory() ? FileType.Directory : FileType.File,
      ctime: s.ctimeMs,
      mtime: s.mtimeMs,
      size: s.size,
    };
  },
  async readDirectory(uri) {
    const entries = await fs.promises.readdir(uri.fsPath, { withFileTypes: true });
    return entries.map((e) => [e.name, e.isDirectory() ? FileType.Directory : FileType.File]);
  },
  async createDirectory(uri) {
    await fs.promises.mkdir(uri.fsPath, { recursive: true });
  },
  async delete(uri, options) {
    await fs.promises.rm(uri.fsPath, { recursive: !!(options && options.recursive) });
  },
});

// ---------------------------------------------------------------- misc runtime values

class Disposable {
  constructor(fn) {
    this._fn = fn || (() => {});
  }
  dispose() {
    this._fn();
  }
  static from(...items) {
    return new Disposable(() => items.forEach((i) => i.dispose()));
  }
}

class EventEmitter {
  constructor() {
    this._listeners = [];
    this.event = (listener) => {
      this._listeners.push(listener);
      return new Disposable(() => {
        this._listeners = this._listeners.filter((l) => l !== listener);
      });
    };
  }
  fire(value) {
    for (const l of [...this._listeners]) l(value);
  }
  dispose() {
    this._listeners.length = 0;
  }
}

class RelativePattern {
  constructor(base, pattern) {
    this.baseUri = base && base.uri ? base.uri : base;
    this.pattern = pattern;
  }
}

const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 };

// ---------------------------------------------------------------- webview panel

// Records every postMessage and lets a test deliver a webview->host message with the SAME shape
// media/board.js posts. `fire` returns the handler's promise so a test can await the host's work.
function createFakeWebview() {
  const posted = [];
  const handlers = [];
  return {
    posted,
    html: '',
    cspSource: 'vscode-webview://fake',
    options: {},
    asWebviewUri: (uri) => uri.with({ scheme: 'https', authority: 'fake.vscode-cdn.net' }),
    postMessage(msg) {
      posted.push(msg);
      return Promise.resolve(true);
    },
    onDidReceiveMessage(listener, thisArg, disposables) {
      handlers.push(thisArg ? listener.bind(thisArg) : listener);
      const d = new Disposable(() => {
        const i = handlers.indexOf(listener);
        if (i >= 0) handlers.splice(i, 1);
      });
      if (disposables) disposables.push(d);
      return d;
    },
    // Test-only: deliver a message as if the webview had posted it.
    fire(msg) {
      return Promise.all(handlers.map((h) => h(msg)));
    },
  };
}

function createFakePanel(viewType, title) {
  const webview = createFakeWebview();
  const disposeHandlers = [];
  const panel = {
    viewType,
    title,
    webview,
    iconPath: undefined,
    revealCount: 0,
    disposed: false,
    reveal() {
      panel.revealCount++;
    },
    onDidDispose(listener, thisArg, disposables) {
      disposeHandlers.push(thisArg ? listener.bind(thisArg) : listener);
      const d = new Disposable(() => {});
      if (disposables) disposables.push(d);
      return d;
    },
    dispose() {
      if (panel.disposed) return;
      panel.disposed = true;
      for (const h of [...disposeHandlers]) h();
    },
    // Test-only: resolve once BoardPanel's async initHtml() has filled in the template.
    async htmlReady() {
      for (let i = 0; i < 200 && !webview.html; i++) await new Promise((r) => setTimeout(r, 5));
      return webview.html;
    },
  };
  recorded.panels.push(panel);
  return panel;
}

// ---------------------------------------------------------------- namespaces

function showMessage(kind, message, ...rest) {
  const options = rest.length && typeof rest[0] === 'object' && rest[0] !== null ? rest[0] : undefined;
  const items = (options ? rest.slice(1) : rest).map(String);
  recorded.messages.push({ kind, message, options, items });
  return Promise.resolve(recorded.answers.length ? recorded.answers.shift() : undefined);
}

const window = strict('window', {
  showInformationMessage: (message, ...rest) => showMessage('info', message, ...rest),
  showWarningMessage: (message, ...rest) => showMessage('warning', message, ...rest),
  showErrorMessage: (message, ...rest) => showMessage('error', message, ...rest),
  createWebviewPanel: (viewType, title) => createFakePanel(viewType, title),
});

function createConfiguration(section) {
  const full = (key) => `${section}.${key}`;
  return {
    get(key, dflt) {
      return recorded.config.has(full(key)) ? recorded.config.get(full(key)) : dflt;
    },
    // Only ever reports values a test explicitly set — same contract the real API has for
    // "the user configured this", which readAfterTask/readDefaultModel depend on.
    inspect(key) {
      const k = full(key);
      return recorded.config.has(k) ? { key: k, globalValue: recorded.config.get(k) } : { key: k };
    },
  };
}

const workspace = strict('workspace', {
  fs: workspaceFs,
  workspaceFolders: undefined,
  getConfiguration: (section) => createConfiguration(section),
  // Inert by design: the host suite drives refreshes through explicit messages, never through
  // filesystem events (which would make every assertion timing-dependent).
  createFileSystemWatcher() {
    const on = () => new Disposable(() => {});
    return { onDidChange: on, onDidCreate: on, onDidDelete: on, dispose() {} };
  },
});

const commands = strict('commands', {
  executeCommand(command, ...args) {
    recorded.commands.push({ command, args });
    return Promise.resolve(undefined);
  },
});

const env = strict('env', {
  openExternal(uri) {
    recorded.external.push(uri.toString());
    return Promise.resolve(true);
  },
});

// ---------------------------------------------------------------- module install

const api = strict('vscode', {
  __esModule: true,
  Uri,
  FileType,
  Disposable,
  EventEmitter,
  RelativePattern,
  ViewColumn,
  window,
  workspace,
  commands,
  env,
  // Test-only handles (not part of the VS Code API).
  __fake: { recorded, reset, answerWith, setConfig, lastPanel, createMemento },
});

let installed = false;

// Route `require('vscode')` from the compiled out/ modules to this file. Node's test runner gives
// each test FILE its own process, so this never leaks into the pure-module suites.
function install() {
  if (installed) return;
  installed = true;
  const fakePath = require.resolve(__filename);
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'vscode') return fakePath;
    return original.call(this, request, ...rest);
  };
}

module.exports = api;
module.exports.install = install;
module.exports.reset = reset;
module.exports.answerWith = answerWith;
module.exports.setConfig = setConfig;
module.exports.lastPanel = lastPanel;
module.exports.createMemento = createMemento;
module.exports.recorded = recorded;
