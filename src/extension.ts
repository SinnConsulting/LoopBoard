import * as vscode from 'vscode';
import { Store } from './store';
import { TerminalManager } from './terminals';
import { SidebarProvider } from './sidebar';
import { Controller, readDefaultModel } from './controller';
import { Model, resolveModels, readModelsConfig } from './model';

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return; // Nothing to do without an open workspace folder.
  }

  let controller: Controller;
  const store = new Store(folder);
  const terminals = new TerminalManager(
    () => folder.uri,
    () => store.loopText,
    () => {
      const c = vscode.workspace.getConfiguration('loopBoard');
      return {
        permissionMode: c.get<string>('permissionMode', 'auto'),
        interval: c.get<string>('loopInterval', '1m'),
        defaultModel: readDefaultModel(c, 'defaultWorkerModel'),
        models: resolveModels(readModelsConfig(<T>(k: string, d: T) => c.get<T>(k, d))),
      };
    }
  );
  const sidebar = new SidebarProvider(context.extensionUri);
  controller = new Controller(context.extensionUri, store, terminals, sidebar);

  context.subscriptions.push(
    { dispose: () => store.dispose() },
    { dispose: () => terminals.dispose() },
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar),
    vscode.commands.registerCommand('loopBoard.openBoard', () => controller.openBoard()),
    vscode.commands.registerCommand('loopBoard.refresh', () => controller.refresh()),
    vscode.commands.registerCommand('loopBoard.spawnLoop', (model: Model) => terminals.spawn(model)),
    vscode.commands.registerCommand('loopboard.init', () => controller.onCreateFiles())
  );

  store.startWatching();
  void controller.autoHeal().then(() => controller.refresh());
}

export function deactivate(): void {
  // Subscriptions handle disposal.
}
