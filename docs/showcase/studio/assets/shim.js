/* Stands in for the VS Code webview bridge. Everything a webview posts host-ward goes to the
 * studio's Node-side mini host through the `__studioHost` binding (exposed on every frame by
 * Playwright); the host answers with window.postMessage, the same delivery path VS Code uses. */
(function () {
  'use strict';
  const page = document.currentScript.getAttribute('data-page');
  // A scene may seed the persisted webview state (tab, collapse maps…) through an init script.
  let state = (window.__studioState && window.__studioState[page]) || null;
  window.acquireVsCodeApi = function () {
    return {
      postMessage: function (msg) {
        const copy = JSON.parse(JSON.stringify(msg));
        if (window.__studioHost) window.__studioHost(page, copy);
      },
      getState: function () { return state; },
      setState: function (next) { state = next; return next; },
    };
  };
})();
