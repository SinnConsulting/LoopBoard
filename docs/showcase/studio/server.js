/* Static server for the showcase studio.
 *
 * Serves the REAL webview assets from media/ and renders board/sidebar/settings.html exactly the
 * way src/webview.ts's renderHtml() does — same placeholders, same CSP with a per-response nonce —
 * so what the GIFs show is what the extension ships. Two extra tags ride in front of the app
 * script, both inside the policy: the theme stylesheet that supplies the --vscode-* variables VS
 * Code would inject, and the acquireVsCodeApi shim that bridges each webview to the mini host.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MEDIA = path.join(ROOT, 'media');
const ASSETS = path.join(__dirname, 'assets');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

function nonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function renderWebview(page) {
  const template = fs.readFileSync(path.join(MEDIA, `${page}.html`), 'utf8');
  const n = nonce();
  const csp = [
    `default-src 'none'`,
    `style-src 'self' 'unsafe-inline'`,
    `script-src 'nonce-${n}'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
  ].join('; ');
  return template
    .replace(/{{csp}}/g, csp)
    .replace(/{{nonce}}/g, n)
    .replace(/{{styleUri}}/g, `/media/${page}.css`)
    .replace(/{{scriptUri}}/g, `/media/${page}.js`)
    .replace(/{{markdownUri}}/g, '/media/markdown.js')
    .replace(/{{codiconUri}}/g, '/media/codicon/codicon.css')
    // Theme first, so the page stylesheet's own `var(--x, fallback)` defaults never win.
    .replace('<link rel="stylesheet" href="/media/codicon/codicon.css" />',
      '<link rel="stylesheet" href="/assets/theme.css" />\n  <link rel="stylesheet" href="/media/codicon/codicon.css" />')
    // acquireVsCodeApi must exist before the first app script runs.
    .replace(`<script nonce="${n}"`, `<script nonce="${n}" src="/assets/shim.js" data-page="${page}"></script>\n  <script nonce="${n}"`);
}

function resolveStatic(urlPath) {
  for (const [prefix, base] of [['/media/', MEDIA], ['/assets/', ASSETS]]) {
    if (!urlPath.startsWith(prefix)) continue;
    const full = path.resolve(base, decodeURIComponent(urlPath.slice(prefix.length)));
    return full.startsWith(base + path.sep) ? full : null;
  }
  return null;
}

function start() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const m = /^\/webview\/(board|sidebar|settings)\.html$/.exec(url.pathname);
    if (m) {
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      res.end(renderWebview(m[1]));
      return;
    }
    const file = url.pathname === '/' ? path.join(ASSETS, 'stage.html') : resolveStatic(url.pathname);
    if (!file) return res.writeHead(404).end('not found');
    fs.readFile(file, (err, bytes) => {
      if (err) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(bytes);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

module.exports = { start, ROOT };
