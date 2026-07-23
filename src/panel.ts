// Full-tab board webview panel (singleton).
import * as vscode from 'vscode';
import { renderHtml } from './webview';

export type InboundMessage = any;

export class BoardPanel {
  static current: BoardPanel | undefined;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private messageHandler: (msg: InboundMessage) => void = () => {};

  private constructor(private extensionUri: vscode.Uri) {
    this.panel = vscode.window.createWebviewPanel(
      'loopBoard.board',
      'LoopBoard',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg');
    void this.initHtml();
    this.panel.webview.onDidReceiveMessage((msg) => this.messageHandler(msg), null, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private async initHtml(): Promise<void> {
    this.panel.webview.html = await renderHtml(this.panel.webview, this.extensionUri, 'board');
  }

  // `created` is true only when a fresh panel was constructed — its webview script hasn't loaded
  // yet, so callers must NOT post into it immediately (wait for the webview's `ready` message).
  static show(extensionUri: vscode.Uri): { panel: BoardPanel; created: boolean } {
    if (BoardPanel.current) {
      BoardPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return { panel: BoardPanel.current, created: false };
    }
    BoardPanel.current = new BoardPanel(extensionUri);
    return { panel: BoardPanel.current, created: true };
  }

  onMessage(handler: (msg: InboundMessage) => void): void {
    this.messageHandler = handler;
  }

  post(msg: unknown): void {
    void this.panel.webview.postMessage(msg);
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Active);
  }

  dispose(): void {
    BoardPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
