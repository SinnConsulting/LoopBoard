/* Static harness server for the webview suite: serves the REAL media/ assets plus a rendered
 * board.html / sidebar.html.
 *
 * The rendering mirrors src/webview.ts's renderHtml() — the same four placeholders, the same CSP
 * shape with a per-response nonce that the script tags must carry, so a page that violates the
 * policy fails here the way it would in the real host. `webview.cspSource` becomes `'self'`, which
 * is its local equivalent.
 *
 * Two extra tags ride in front of the app script (both inside the policy): the theme stylesheet
 * that supplies the --vscode-* variables VS Code would inject, and the acquireVsCodeApi shim.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MEDIA = path.join(ROOT, 'media');
const HARNESS = path.join(__dirname, 'harness');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.md': 'text/markdown; charset=utf-8',
};

function nonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function renderPage(page, theme) {
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
    // Theme selector for the light/dark screenshot pair.
    .replace('<html lang="en">', `<html lang="en" data-theme="${theme === 'dark' ? 'dark' : 'light'}">`)
    // The harness stylesheet must load BEFORE the page stylesheet so board.css's own
    // `var(--x, fallback)` defaults never win over the injected theme.
    .replace('<link rel="stylesheet" href="/media/codicon/codicon.css" />', '<link rel="stylesheet" href="/harness/theme.css" />\n  <link rel="stylesheet" href="/media/codicon/codicon.css" />')
    // acquireVsCodeApi must exist before the app IIFE runs.
    .replace(`<script nonce="${n}"`, `<script nonce="${n}" src="/harness/shim.js"></script>\n  <script nonce="${n}"`);
}

// Resolve a URL path inside one of the two served roots, refusing anything that escapes.
function resolveStatic(urlPath) {
  const roots = [['/media/', MEDIA], ['/harness/', HARNESS]];
  for (const [prefix, base] of roots) {
    if (!urlPath.startsWith(prefix)) continue;
    const full = path.resolve(base, urlPath.slice(prefix.length));
    return full.startsWith(base + path.sep) ? full : null;
  }
  return null;
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const page = url.pathname === '/board.html' ? 'board' : url.pathname === '/sidebar.html' ? 'sidebar' : null;
    if (page) {
      const body = renderPage(page, url.searchParams.get('theme'));
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    }
    const file = resolveStatic(url.pathname);
    if (!file) {
      res.writeHead(404).end('not found');
      return;
    }
    fs.readFile(file, (err, bytes) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(bytes);
    });
  });
}

function start(port) {
  const server = createServer();
  return new Promise((resolve) => server.listen(port || 0, '127.0.0.1', () => resolve(server)));
}

module.exports = { createServer, start };

// `node server.js [port]` — used by playwright.config.js's webServer.
if (require.main === module) {
  const port = Number(process.argv[2] || process.env.PORT || 4321);
  start(port).then(() => console.log(`harness server on http://127.0.0.1:${port}`));
}
