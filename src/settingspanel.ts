// LoopBoard's own settings webview panel (t-sgrp) — singleton, same shape as BoardPanel.
//
// Why this exists at all: an extension cannot inject UI into VSCode's native Settings editor (it
// renders one standard control per key and offers no API for anything else — t-set1's finding), so
// the model grid is only reachable on a page of our own. This REVERSES t-set1, which made the
// sidebar gear open the `@ext:`-filtered native editor; that view is now the escape hatch.
//
// The keys themselves stay ordinary VSCode settings — `settings.json` and Settings Sync are
// untouched — so nothing here owns configuration, it only edits it.
import * as vscode from 'vscode';
import { renderHtml } from './webview';

export class SettingsPanel {
  static current: SettingsPanel | undefined;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private messageHandler: (msg: any) => void = () => {};

  private constructor(private extensionUri: vscode.Uri, onConfigChange: () => void) {
    this.panel = vscode.window.createWebviewPanel(
      'loopBoard.settings',
      'LoopBoard Settings',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );
    this.panel.iconPath = {
      light: vscode.Uri.joinPath(extensionUri, 'media', 'icon-light.svg'),
      dark: vscode.Uri.joinPath(extensionUri, 'media', 'icon-dark.svg'),
    };
    void this.initHtml();
    this.panel.webview.onDidReceiveMessage((msg) => this.messageHandler(msg), null, this.disposables);
    // The ONLY onDidChangeConfiguration listener in the codebase, and deliberately so: CLAUDE.md
    // records that `src/` installs none and reads configuration on demand (the earlier config-
    // listener machinery was removed in t-4a04 after human rejection). This one is scoped twice —
    // to `loopBoard.*`, and to the lifetime of this panel: it goes into `disposables`, which
    // onDidDispose tears down, so closing the tab leaves the codebase with no config listener again.
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('loopBoard')) onConfigChange();
      })
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private async initHtml(): Promise<void> {
    this.panel.webview.html = await renderHtml(this.panel.webview, this.extensionUri, 'settings');
  }

  // `created` is true only for a fresh panel — its webview script has not loaded yet, so callers
  // must wait for the webview's `settingsReady` message instead of posting immediately.
  static show(extensionUri: vscode.Uri, onConfigChange: () => void): { panel: SettingsPanel; created: boolean } {
    if (SettingsPanel.current) {
      SettingsPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return { panel: SettingsPanel.current, created: false };
    }
    SettingsPanel.current = new SettingsPanel(extensionUri, onConfigChange);
    return { panel: SettingsPanel.current, created: true };
  }

  onMessage(handler: (msg: any) => void): void {
    this.messageHandler = handler;
  }

  post(msg: unknown): void {
    void this.panel.webview.postMessage(msg);
  }

  dispose(): void {
    SettingsPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
