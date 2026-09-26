// The What's New tab (t-f070) — a singleton webview panel, same shape as SettingsPanel. It opens once
// after an extension update (the decision is src/whatsnew.ts's) and shows the version it updated to,
// a link to the GitHub release notes and a "don't show again" tick. GitHub cannot be framed, and the
// page is link-only by decision: it is rendered by the shared renderHtml policy (`default-src 'none'`)
// and reaches nothing; the host opens the link with vscode.env.openExternal.
import * as vscode from 'vscode';
import { renderHtml } from './webview';

export class WhatsNewPanel {
  static current: WhatsNewPanel | undefined;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private messageHandler: (msg: any) => void = () => {};

  private constructor(private extensionUri: vscode.Uri) {
    this.panel = vscode.window.createWebviewPanel(
      'loopBoard.whatsNew',
      "What's New in LoopBoard",
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
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private async initHtml(): Promise<void> {
    this.panel.webview.html = await renderHtml(this.panel.webview, this.extensionUri, 'whatsnew');
  }

  // A fresh panel's script is not loaded yet: callers wait for its `whatsNewReady` message. A hidden
  // panel re-runs its script when revealed (no retained context), so it asks again then.
  static show(extensionUri: vscode.Uri): WhatsNewPanel {
    if (WhatsNewPanel.current) {
      WhatsNewPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return WhatsNewPanel.current;
    }
    WhatsNewPanel.current = new WhatsNewPanel(extensionUri);
    return WhatsNewPanel.current;
  }

  onMessage(handler: (msg: any) => void): void {
    this.messageHandler = handler;
  }

  post(msg: unknown): void {
    void this.panel.webview.postMessage(msg);
  }

  dispose(): void {
    WhatsNewPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
