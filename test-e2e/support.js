/* Shared page helpers for the webview specs. */
'use strict';

const { expect } = require('@playwright/test');
const { boardMessage } = require('./fixtures');

// Load a harness page and wait for the app IIFE to have posted its `ready`.
async function openPage(page, name, options) {
  const opts = options || {};
  await page.goto(`/${name}.html${opts.theme === 'dark' ? '?theme=dark' : ''}`);
  await page.waitForFunction(() => Array.isArray(window.__sent));
  await expect.poll(() => sent(page).then((m) => m.map((x) => x.type))).toContain('ready');
}

// Codicons are a real webfont served from media/codicon/codicon.ttf. If the CSP or the URL is
// wrong the glyphs silently degrade to tofu and the screenshots bake that in, so assert the
// FontFace actually reached `loaded` (checked after a repaint, since the font is fetched lazily
// on the first codicon element).
async function expectCodiconsLoaded(page) {
  await page.evaluate(() => document.fonts.load('16px codicon', ''));
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() =>
    Array.from(document.fonts).some((f) => f.family.replace(/["']/g, '') === 'codicon' && f.status === 'loaded')
  );
  expect(loaded, 'codicon webfont loaded — no fallback glyphs').toBe(true);
}

// Deliver the exact `{ type: 'board', board }` message BoardPanel.post() sends.
async function postBoard(page, options) {
  return postRaw(page, boardMessage(options));
}

async function postRaw(page, msg) {
  await page.evaluate((m) => window.__post(m), msg);
  // One turn of the event loop for the listener plus its synchronous render().
  await page.waitForFunction(() => !!document.querySelector('#root > *'));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
}

function sent(page) {
  return page.evaluate(() => window.__sent);
}

function clearSent(page) {
  return page.evaluate(() => window.__clearSent());
}

// Messages of one type, in post order.
async function sentOfType(page, type) {
  return (await sent(page)).filter((m) => m.type === type);
}

async function openBoard(page, options) {
  await openPage(page, 'board', options);
  await postBoard(page, options);
  await expectCodiconsLoaded(page);
  await clearSent(page);
}

async function openSidebar(page, options) {
  await openPage(page, 'sidebar', options);
  await postBoard(page, options);
  await expectCodiconsLoaded(page);
  await clearSent(page);
}

// Switch the board to a phase tab by its visible label. A tab's textContent also carries an
// attention dot's screen-reader text and the phase count, so match the label span exactly.
async function selectTab(page, label) {
  await page.locator(`.tab:has(.tab-label:text-is("${label}"))`).click();
}

function taskIds(page) {
  return page.locator('.cards [data-task]').evaluateAll((els) => els.map((e) => e.getAttribute('data-task')));
}

module.exports = {
  openPage, openBoard, openSidebar, postBoard, postRaw,
  sent, clearSent, sentOfType, selectTab, taskIds, expectCodiconsLoaded,
};
