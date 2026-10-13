import * as vscode from 'vscode';
import { Store, DebugLevel } from './store';
import { TerminalManager } from './terminals';
import { SidebarProvider } from './sidebar';
import { Controller, explicitLookup } from './controller';
import { ContextReader } from './contextreader';
import { isLoopId, enabledModels, readModelsConfig, resolveOrchestrator, resolveTaskDefaults } from './model';

// How long after activation the legacy per-model loop terminals are looked for (t-0e99).
const LEGACY_LOOP_CHECK_MS = 5000;

// Held for deactivate() so the debug sink's buffered tail is flushed on a clean shutdown (t-2901).
let activeStore: Store | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return; // Nothing to do without an open workspace folder.
  }

  let controller: Controller;
  const store = new Store(folder, () => vscode.workspace.getConfiguration('loopBoard').get<DebugLevel>('debug', 'off'));
  activeStore = store;
  const terminals = new TerminalManager(
    () => folder.uri,
    () => store.loopText,
    () => {
      const c = vscode.workspace.getConfiguration('loopBoard');
      const set = explicitLookup(c);
      return {
        permissionMode: c.get<string>('permissionMode', 'auto'),
        interval: c.get<string>('loopInterval', '1m'),
        // t-0e99: the orchestrator's own flags plus the enabled task models and the five defaults,
        // all frozen into the spawn command (like the interval).
        orchestrator: resolveOrchestrator(set),
        models: enabledModels(readModelsConfig(<T>(k: string, d: T) => c.get<T>(k, d))).map((m) => m.id),
        defaults: resolveTaskDefaults(set),
      };
    },
    (level, event, detail) => store.debugLog(level, event, detail)
  );
  const sidebar = new SidebarProvider(context.extensionUri);
  // Context-usage reader (t-2b89): reads `~/.claude/` outside the workspace, so it is its own
  // module rather than part of the `.loopboard/`-owning store. The cwd is what matches a loop
  // terminal's session file to its slot.
  const contextReader = new ContextReader(
    () => folder.uri.fsPath,
    (level, event, detail) => store.debugLog(level, event, detail)
  );
  controller = new Controller(context.extensionUri, store, terminals, sidebar, context.globalState, contextReader);
  // Stamp the webview assets this host was loaded alongside (t-5831); every board `ready` compares.
  controller.stampBuild();

  context.subscriptions.push(
    { dispose: () => store.dispose() },
    { dispose: () => terminals.dispose() },
    { dispose: () => controller.dispose() },
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar),
    vscode.commands.registerCommand('loopBoard.openBoard', () => controller.openBoard()),
    vscode.commands.registerCommand('loopBoard.refresh', () => controller.refresh()),
    // From the command palette there is no argument: it starts the orchestrator, the only loop.
    vscode.commands.registerCommand('loopBoard.spawnLoop', (loop?: unknown) => terminals.spawn(isLoopId(loop) ? loop : 'orchestrator')),
    vscode.commands.registerCommand('loopboard.init', () => controller.onCreateFiles()),
    vscode.commands.registerCommand('loopBoard.whatsNew', () => controller.showWhatsNew('command')),
    vscode.commands.registerCommand('loopBoard.showLove', () => controller.showLove())
  );

  store.debugLog('info', 'activate', folder.name);
  store.startWatching();
  void controller.autoHeal().then(() => controller.autoSyncTemplates()).then(() => controller.refresh());
  // Delayed: VSCode reconnects revived terminals during startup, after activation may already have
  // run, so an immediate look could miss a legacy loop terminal that is about to reappear.
  const legacyCheck = setTimeout(() => void controller.maybeStopLegacyLoops(), LEGACY_LOOP_CHECK_MS);
  context.subscriptions.push({ dispose: () => clearTimeout(legacyCheck) });
  void controller.maybeShowGettingStarted();
  void controller.maybeShowWhatsNew();
}

export async function deactivate(): Promise<void> {
  // Persist the debug sink's buffered tail before the process exits (VSCode awaits this Promise).
  await activeStore?.flushDebug();
  // Subscriptions handle the rest of disposal.
}
