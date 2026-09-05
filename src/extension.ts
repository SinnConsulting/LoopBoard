import * as vscode from 'vscode';
import { Store, DebugLevel } from './store';
import { TerminalManager } from './terminals';
import { SidebarProvider } from './sidebar';
import { Controller } from './controller';
import { ContextReader } from './contextreader';
import { Model, resolveModels, readModelsConfig } from './model';

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
      return {
        permissionMode: c.get<string>('permissionMode', 'auto'),
        interval: c.get<string>('loopInterval', '1m'),
        models: resolveModels(readModelsConfig(<T>(k: string, d: T) => c.get<T>(k, d))),
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

  context.subscriptions.push(
    { dispose: () => store.dispose() },
    { dispose: () => terminals.dispose() },
    { dispose: () => controller.dispose() },
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar),
    vscode.commands.registerCommand('loopBoard.openBoard', () => controller.openBoard()),
    vscode.commands.registerCommand('loopBoard.refresh', () => controller.refresh()),
    vscode.commands.registerCommand('loopBoard.spawnLoop', (model: Model) => terminals.spawn(model)),
    vscode.commands.registerCommand('loopboard.init', () => controller.onCreateFiles())
  );

  store.debugLog('info', 'activate', folder.name);
  store.startWatching();
  void controller.autoHeal().then(() => controller.refresh());
  void controller.maybeShowGettingStarted();
}

export async function deactivate(): Promise<void> {
  // Persist the debug sink's buffered tail before the process exits (VSCode awaits this Promise).
  await activeStore?.flushDebug();
  // Subscriptions handle the rest of disposal.
}
