// Shared helper: build CSP-hardened webview HTML from a media/*.html template.
import * as vscode from 'vscode';

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export async function renderHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  page: 'board' | 'sidebar'
): Promise<string> {
  const mediaUri = vscode.Uri.joinPath(extensionUri, 'media');
  const htmlUri = vscode.Uri.joinPath(mediaUri, `${page}.html`);
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, `${page}.css`));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, `${page}.js`));
  const n = nonce();
  const bytes = await vscode.workspace.fs.readFile(htmlUri);
  const template = new TextDecoder().decode(bytes);
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${n}'`,
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
  ].join('; ');
  return template
    .replace(/{{csp}}/g, csp)
    .replace(/{{nonce}}/g, n)
    .replace(/{{styleUri}}/g, styleUri.toString())
    .replace(/{{scriptUri}}/g, scriptUri.toString());
}
