/* LoopBoard's What's New tab (t-f070). Vanilla JS, no framework.

   The host posts what to show (`whatsNew`: previous/current version, the link, the tick state) in
   answer to `whatsNewReady`. The page never reaches the network and never sends a URL back: "open"
   asks the host to open the link IT computed, with vscode.env.openExternal. The tick is the
   `loopBoard.showWhatsNew` setting itself — the host writes it Global. */
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');

  // Tiny DOM helper (same contract as media/settings.js's).
  function h(tag, props) {
    const e = document.createElement(tag);
    props = props || {};
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) {
      const kids = Array.isArray(arguments[i]) ? arguments[i] : [arguments[i]];
      for (const kid of kids) {
        if (kid == null || kid === false) continue;
        e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
      }
    }
    return e;
  }
  const icon = (name) => h('span', { class: 'codicon codicon-' + name, 'aria-hidden': 'true' });

  function render(s) {
    const tick = h('input', {
      type: 'checkbox', id: 'dont-show',
      onchange: (e) => {
        err.textContent = '';
        vscode.postMessage({ type: 'whatsNewOptOut', optOut: e.target.checked });
      },
    });
    tick.checked = !!s.dontShowAgain;
    const err = h('div', { class: 'err', role: 'alert' });

    const lead = s.list
      ? ['You skipped a few releases on the way from ', h('code', null, s.previous), ' — the notes for ',
         'every release, newest first, are on GitHub.']
      : ['See what changed in ', h('code', null, 'v' + s.current), ' in its release notes on GitHub.'];

    root.replaceChildren(h('div', { class: 'wrap' },
      h('header', null,
        h('div', { class: 'mark' }, icon('sparkle')),
        h('div', null,
          h('h1', null, "What's New in LoopBoard"),
          h('div', { class: 'subtle' }, 'Shown once after an update.'))),
      h('section', { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Extension updated'),
        h('div', { class: 'headline' }, 'Updated to ', h('span', { class: 'ver' }, s.current)),
        h('div', { class: 'step', 'aria-label': 'from ' + s.previous + ' to ' + s.current },
          h('span', { class: 'pill ver' }, s.previous),
          icon('arrow-right'),
          h('span', { class: 'pill to ver' }, s.current)),
        h('p', null, lead),
        h('button', {
          class: 'primary', type: 'button', title: s.url,
          onclick: () => vscode.postMessage({ type: 'whatsNewOpen' }),
        }, icon('github'), s.list ? 'Open all release notes' : 'Open the release notes', icon('link-external')),
        h('div', { class: 'subtle note' }, 'Opens github.com in your browser. LoopBoard itself fetches nothing.')),
      h('footer', null,
        h('label', { class: 'tick', for: 'dont-show' }, tick, "Don't show this again after future updates"),
        h('button', {
          class: 'link', type: 'button',
          onclick: () => vscode.postMessage({ type: 'openSettings' }),
        }, 'LoopBoard settings')),
      err));
    return { tick, err };
  }

  let view = null;
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'whatsNew') view = render(msg);
    else if (msg.type === 'whatsNewError' && view) {
      view.tick.checked = !!msg.dontShowAgain;
      view.err.textContent = 'Could not save the setting: ' + msg.reason;
    }
  });

  vscode.postMessage({ type: 'whatsNewReady' });
})();
