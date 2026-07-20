import * as vscode from 'vscode';
import { Store } from './store';
import { TerminalManager } from './terminals';
import { SidebarProvider } from './sidebar';
import { Controller } from './controller';
import { Model } from './model';

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return; // Nothing to do without an open workspace folder.
  }

  let controller: Controller;
  const store = new Store(folder);
  const terminals = new TerminalManager(
    () => folder.uri,
    () => controller?.getBoard(),
    () => {
      const c = vscode.workspace.getConfiguration('loopBoard');
      return {
        permissionMode: c.get<string>('permissionMode', 'auto'),
        interval: c.get<string>('loopInterval', '1m'),
        startupDelayMs: c.get<number>('startupDelayMs', 3000),
        defaultModel: c.get<Model>('defaultModel', 'opus'),
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
    vscode.commands.registerCommand('loopBoard.spawnLoop', (model: Model) => terminals.spawn(model))
  );

  store.startWatching();
  void controller.refresh();
}

export function deactivate(): void {
  // Subscriptions handle disposal.
}
