// Activity-bar sidebar summary (WebviewViewProvider).
import * as vscode from 'vscode';
import { renderHtml } from './webview';
import { BadgeInfo } from './view';

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'loopBoard.sidebar';
  private view: vscode.WebviewView | undefined;
  private messageHandler: (msg: any) => void = () => {};
  private pending: unknown | undefined;

  constructor(private extensionUri: vscode.Uri) {}

  onMessage(handler: (msg: any) => void): void {
    this.messageHandler = handler;
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    view.webview.html = await renderHtml(view.webview, this.extensionUri, 'sidebar');
    view.webview.onDidReceiveMessage((msg) => this.messageHandler(msg));
    if (this.pending) {
      void view.webview.postMessage(this.pending);
    }
  }

  post(msg: unknown): void {
    this.pending = msg;
    if (this.view) void this.view.webview.postMessage(msg);
  }

  setBadge(badge: BadgeInfo): void {
    if (!this.view) return;
    this.view.badge =
      badge.count > 0
        ? {
            value: badge.count,
            tooltip: `${badge.newCount} to approve · ${badge.feedbackUnanswered} awaiting your answer · ${badge.reviewCount} to review`,
          }
        : undefined;
  }
}
