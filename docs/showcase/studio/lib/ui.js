/* Locators for the real webview DOM (media/board.js / sidebar.js class names). */
'use strict';

module.exports = {
  tab: (ctx, label) => ctx.board.locator(`.tab:has(.tab-label:text-is("${label}"))`),
  card: (ctx, id) => ctx.board.locator(`[data-task="${id}"]`),
  promote: (ctx, id) => ctx.board.locator(`[data-task="${id}"] .approve-btn`),
  approve: (ctx, id) => ctx.board.locator(`[data-task="${id}"] .approve-btn`),
  demote: (ctx, id) => ctx.board.locator(`[data-task="${id}"] .demote-btn`),
  loopBtn: (ctx, name, label) => ctx.sidebar.locator(`.loop-wrap:has(.label:text-is("${name}")) button[aria-label^="${label}"]`),
};
