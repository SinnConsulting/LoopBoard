'use strict';

const { defineConfig } = require('@playwright/test');

const PORT = Number(process.env.E2E_PORT || 4321);

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.js',
  // One flat, platform-suffix-free baseline directory: the browser AND the fonts come from the
  // pinned test-e2e/Dockerfile image, so there is exactly one platform to record against.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      // The board is a text-dense UI; a single sub-pixel glyph shift must not fail the run, but a
      // layout or colour regression moves far more than 1% of the pixels.
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: [
        // The Playwright image runs as root; Chromium's sandbox needs user namespaces it lacks.
        '--no-sandbox',
        '--disable-dev-shm-usage',
        // Screenshot determinism: fixed colour profile, no sub-pixel/hinted text.
        '--force-color-profile=srgb',
        '--font-render-hinting=none',
        '--disable-lcd-text',
      ],
    },
  },
  webServer: {
    command: `node server.js ${PORT}`,
    url: `http://127.0.0.1:${PORT}/board.html`,
    cwd: __dirname,
    reuseExistingServer: false,
    stdout: 'ignore',
  },
});
