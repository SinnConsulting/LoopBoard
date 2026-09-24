/* media/sidebar.{html,css,js} in a plain browser: the Loops overview's three row buttons and the
 * right-click scheduling popover (t-77d1), plus the attention rows' reveal messages.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { openSidebar, sent, sentOfType } = require('./support');

// fable stopped, opus running and owning the In-Progress task the fixture carries (t-bb01).
const RUNNING = { loops: { opus: { running: true } } };

function row(page, name) {
  return page.locator('.sb-row.loop').filter({ has: page.locator('.label', { hasText: name }) });
}
const PLAY = 0;
const RECYCLE = 1;
const STOP = 2;
function button(page, name, index) {
  return row(page, name).locator('.icon-btn').nth(index);
}

test('left-clicking the three row buttons posts spawn / recycle / stop', async ({ page }) => {
  await openSidebar(page, RUNNING);

  await button(page, 'Fable', PLAY).click();
  await button(page, 'Opus', RECYCLE).click();
  await button(page, 'Opus', STOP).click();

  expect(await sent(page)).toEqual([
    { type: 'spawnLoop', model: 'fable' },
    { type: 'recycleLoop', model: 'opus' },
    { type: 'stopLoop', model: 'opus' },
  ]);
});

test('a button that does not apply to the current state is inert on the left, not disabled', async ({ page }) => {
  await openSidebar(page, RUNNING);
  // Play on a RUNNING loop and stop on a STOPPED one are `aria-disabled` + `.off`, never the real
  // `disabled` attribute — a disabled button fires no mouse events and would take the right-click
  // scheduling away with the left click.
  const play = button(page, 'Opus', PLAY);
  await expect(play).toHaveClass(/off/);
  await expect(play).toHaveAttribute('aria-disabled', 'true');
  expect(await play.evaluate((el) => el.disabled)).toBe(false);
  // force: Playwright's actionability check honours aria-disabled, but a real browser still
  // dispatches the event — which is the whole reason the button is not truly `disabled`.
  await play.click({ force: true });
  expect(await sent(page)).toEqual([]);
});

test('right-clicking a button opens the scheduling popover for THAT action and arms it', async ({ page }) => {
  await openSidebar(page, RUNNING);

  await button(page, 'Opus', RECYCLE).click({ button: 'right' });
  const pop = page.locator('.restart-pop');
  await expect(pop).toBeVisible();
  await expect(pop.locator('.restart-title')).toHaveText('Restart Opus');
  await expect(pop.locator('.restart-preset')).toHaveText(['15m', '30m', '60m', '120m', '240m']);
  // Force exists only for the two actions that can kill a working terminal.
  await expect(pop.locator('.restart-check')).toHaveText(['Repeat', 'Force (restart even mid-task)']);

  await pop.locator('.restart-custom').fill('45');
  await pop.getByRole('button', { name: 'Schedule restart' }).click();
  expect(await sentOfType(page, 'armRestart')).toEqual([
    { type: 'armRestart', model: 'opus', action: 'restart', minutes: '45', repeat: false, force: false },
  ]);
  await expect(page.locator('.restart-pop')).toHaveCount(0);
});

test('the popover validates the custom delay in-place and arms nothing', async ({ page }) => {
  await openSidebar(page, RUNNING);
  await button(page, 'Opus', STOP).click({ button: 'right' });
  const pop = page.locator('.restart-pop');
  await expect(pop.locator('.restart-title')).toHaveText('Stop Opus');
  await pop.locator('.restart-custom').fill('90m');
  await pop.getByRole('button', { name: 'Schedule stop' }).click();
  await expect(pop.locator('.restart-error')).toHaveText('Enter a whole number of minutes.');
  expect(await sentOfType(page, 'armRestart')).toEqual([]);
});

test('a stopped loop can still be scheduled from its greyed-out stop button', async ({ page }) => {
  await openSidebar(page, RUNNING);
  // Greyed out for the LEFT click only — see the aria-disabled test above.
  await button(page, 'Fable', STOP).click({ button: 'right', force: true });
  await expect(page.locator('.restart-pop .restart-title')).toHaveText('Stop Fable');
  // Cancel leaves the loop untouched.
  await page.locator('.restart-pop').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.restart-pop')).toHaveCount(0);
  expect(await sent(page)).toEqual([]);
});

test('a scheduled start shows no Force checkbox (it interrupts nothing)', async ({ page }) => {
  await openSidebar(page, RUNNING);
  await button(page, 'Fable', PLAY).click({ button: 'right' });
  const pop = page.locator('.restart-pop');
  await expect(pop.locator('.restart-title')).toHaveText('Start Fable');
  await expect(pop.locator('.restart-check')).toHaveText(['Repeat']);
});

test('a running loop\'s row body reveals its terminal; a stopped one is inert', async ({ page }) => {
  await openSidebar(page, RUNNING);
  await row(page, 'Opus').locator('.loop-body').click();
  expect(await sent(page)).toEqual([{ type: 'revealTerminal', model: 'opus' }]);
  await row(page, 'Fable').locator('.loop-body').click();
  expect(await sent(page)).toEqual([{ type: 'revealTerminal', model: 'opus' }]);
});

test('an attention row reveals its phase with its own query', async ({ page }) => {
  await openSidebar(page, RUNNING);
  await page.locator('.attn-row').first().click();
  const reveals = await sentOfType(page, 'reveal');
  expect(reveals).toHaveLength(1);
  expect(reveals[0].phase).toBeTruthy();
});
