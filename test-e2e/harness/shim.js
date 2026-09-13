/* Stands in for the VS Code webview bridge, injected (with the page's CSP nonce) immediately
 * before media/<page>.js so `acquireVsCodeApi()` exists by the time the app IIFE runs.
 *
 * Everything the webview posts host-ward lands in `window.__sent` verbatim, which is what the
 * message assertions read; `getState`/`setState` back the board's persisted tab/filter/collapse
 * blob exactly as the real API does (per-webview, in memory, lost on reload).
 */
(function () {
  'use strict';
  let state = null;
  const sent = [];

  window.__sent = sent;
  window.__clearSent = function () {
    sent.length = 0;
  };

  window.acquireVsCodeApi = function () {
    return {
      postMessage: function (msg) {
        // Structured-clone equivalent: the real bridge serializes too, so a test can never assert
        // on a live object reference the webview mutates afterwards.
        sent.push(JSON.parse(JSON.stringify(msg)));
      },
      getState: function () {
        return state;
      },
      setState: function (next) {
        state = next;
        return next;
      },
    };
  };

  // What BoardPanel.post()/SidebarProvider.post() do host-ward: the webview's inbound listener is
  // a plain `window.addEventListener('message')`, so this is the same delivery path.
  window.__post = function (msg) {
    window.postMessage(msg, '*');
  };
})();
