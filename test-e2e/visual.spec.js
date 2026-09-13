/* Screenshot baselines — deliberately FOUR, and deliberately whole-surface.
 *
 * Policy (decisions/testing.md): pixels are asserted only where a regression is invisible to a DOM
 * assertion — overall layout, theme wiring, and icon/font loading. Behaviour is covered by
 * board.spec.js / sidebar.spec.js instead, which stay readable when the design moves. Adding a
 * fifth baseline means arguing that no DOM assertion could have caught the same regression.
 *
 * Determinism: browser, fonts and colour profile come from the pinned test-e2e/Dockerfile image;
 * the --vscode-* palette comes from harness/theme.css; CSS animations are disabled by the config;
 * and the only genuinely live element — the topbar's "last synced Ns ago" counter — is masked.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { openBoard, openSidebar } = require('./support');

const RUNNING = {
  loops: {
    opus: {
      running: true,
      context: { used: 56000, window: 200000, percent: 28, pending: false, label: 'ctx 56k / 200k · 28%', threshold: 80, thresholdLabel: 'restart at 80%' },
      restart: { action: 'restart', minutes: 60, repeat: true, force: false, pending: false, label: 'restart in 60m · every 60m' },
    },
  },
};

// The seconds counter is the one element that changes between runs.
function boardMask(page) {
  return { mask: [page.locator('#sync-line')] };
}

test('init empty state', async ({ page }) => {
  await openBoard(page, { todoMissing: true });
  await expect(page).toHaveScreenshot('init-empty.png');
});

test('full board, light theme', async ({ page }) => {
  await openBoard(page);
  await expect(page).toHaveScreenshot('board-light.png', boardMask(page));
});

test('full board, dark theme', async ({ page }) => {
  await openBoard(page, { theme: 'dark' });
  await expect(page).toHaveScreenshot('board-dark.png', boardMask(page));
});

test('sidebar with a running loop', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openSidebar(page, RUNNING);
  await expect(page).toHaveScreenshot('sidebar-running.png');
});
