/* media/board.{html,css,js} in a plain browser.
 *
 * The payloads come from test-e2e/fixtures.js, which runs test/fixtures/*.md through the shipped
 * parser + view.ts — the same path src/panel.ts posts from — so the shapes asserted here cannot
 * drift from what the host actually sends. Assertions are DOM + `window.__sent` (the messages the
 * webview posts back); screenshots are deliberately few and live in board-visual.spec.js.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { boardMessage } = require('./fixtures');
const { openBoard, postRaw, sent, sentOfType, selectTab, taskIds } = require('./support');

test('cards land in the tab their phase names', async ({ page }) => {
  await openBoard(page);

  // The board opens on New (no persisted webview state on a fresh load).
  await expect(page.locator('.pane-title')).toHaveText('New');
  expect(await taskIds(page)).toEqual(['t-aa01', 't-aa02']);

  for (const [label, ids] of [
    ['Backlog', ['t-dd01']],
    ['In Progress', ['t-bb01']],
    ['Feedback', ['t-cc01']],
    ['Review', ['t-ee01']],
  ]) {
    await selectTab(page, label);
    expect(await taskIds(page), `${label} tab`).toEqual(ids);
  }

  // Every tab's own count comes from the payload, not from what is rendered.
  await selectTab(page, 'New');
  expect(
    await page.locator('.tab').evaluateAll((els) =>
      els.map((e) => [e.querySelector('.tab-label').textContent, e.querySelector('.phase-count').textContent])
    )
  ).toEqual([
    ['New', '2'], ['Backlog', '1'], ['In Progress', '1'], ['Feedback', '1'], ['Review', '1'], ['Done', '0'],
  ]);
});

test('a draft renders as a draft card, not a promotable story', async ({ page }) => {
  await openBoard(page);
  await expect(page.locator('[data-task="t-aa02"]')).toHaveClass(/draft/);
  await expect(page.locator('[data-task="t-aa02"] .approve-btn')).toHaveCount(0);
  await expect(page.locator('[data-task="t-aa01"] .approve-btn')).toHaveCount(1);
});

test('an unparsed sub-bullet is flagged on its card and shown verbatim', async ({ page }) => {
  await openBoard(page, { index: 'index-unknown.md' });
  await selectTab(page, 'In Progress');
  const chip = page.locator('[data-task="t-ff01"] .chip.button');
  await expect(chip).toHaveText(/4 unparsed lines/);
  await chip.click();
  await expect(page.locator('[data-task="t-ff01"] .unparsed-text')).toHaveText(
    'owner: @claude\nadded: 2026-07-08\ndescription: A normal description.\nreviewer: @someone'
  );
});

test('the promote tick posts exactly the promote gate message, once', async ({ page }) => {
  await openBoard(page);
  await page.locator('[data-task="t-aa01"] .approve-btn').click();
  // makeGateButton commits on pointerdown and swallows the trailing click (t-2238).
  expect(await sentOfType(page, 'gate')).toEqual([{ type: 'gate', taskId: 't-aa01', action: 'promote' }]);
  // A story with no questions fades optimistically while the host round-trips.
  await expect(page.locator('[data-task="t-aa01"]')).toHaveClass(/acting/);
});

test('promoting a story that still has questions posts promote WITHOUT greying the card', async ({ page }) => {
  // The other branch of commitPromote: with any question present the host may pop a confirm modal,
  // so the card must NOT fade optimistically (t-6936). index-questions.md exists for exactly this
  // — index-full.md's only promotable New story is deliberately question-free, because
  // host.test.js's no-modal promote case relies on that.
  await openBoard(page, { index: 'index-questions.md' });
  const card = page.locator('[data-task="t-gg01"]');
  await expect(card.locator('.qa-item')).toHaveCount(1);

  await card.locator('.approve-btn').click();
  expect(await sentOfType(page, 'gate')).toEqual([{ type: 'gate', taskId: 't-gg01', action: 'promote' }]);
  // No optimistic fade on this branch — the host's outcome arrives via the next board refresh.
  await expect(card).not.toHaveClass(/acting/);
});

test('the accept tick posts the accept gate message', async ({ page }) => {
  await openBoard(page);
  await selectTab(page, 'Review');
  await page.locator('[data-task="t-ee01"] .approve-btn').click();
  expect(await sentOfType(page, 'gate')).toEqual([{ type: 'gate', taskId: 't-ee01', action: 'accept' }]);
});

test('the demote button posts the demote gate message', async ({ page }) => {
  await openBoard(page);
  await selectTab(page, 'Backlog');
  await page.locator('[data-task="t-dd01"] .demote-btn').click();
  expect(await sentOfType(page, 'gate')).toEqual([{ type: 'gate', taskId: 't-dd01', action: 'demote' }]);
});

test('the delete button posts a delete gate (the host owns the confirmation modal)', async ({ page }) => {
  await openBoard(page);
  await selectTab(page, 'Review');
  await page.locator('[data-task="t-ee01"] .icon-btn[aria-label="Delete task"]').click();
  expect(await sentOfType(page, 'gate')).toEqual([{ type: 'gate', taskId: 't-ee01', action: 'delete' }]);
});

test('the model select maps "default (opus)" to an empty value', async ({ page }) => {
  await openBoard(page);
  await selectTab(page, 'In Progress');
  const select = page.locator('[data-task="t-bb01"] .model-select');
  await expect(select).toHaveValue('opus');
  await expect(select.locator('option')).toHaveText(['default (opus)', 'opus', 'sonnet', 'fable']);

  await select.selectOption('default (opus)');
  expect(await sentOfType(page, 'patch')).toEqual([
    { type: 'patch', patch: { taskId: 't-bb01', field: 'model', value: '', base: 'opus' } },
  ]);

  // And back the other way: an explicit slot id is sent verbatim.
  await select.selectOption('sonnet');
  expect((await sentOfType(page, 'patch')).at(-1)).toEqual({
    type: 'patch',
    patch: { taskId: 't-bb01', field: 'model', value: 'sonnet', base: 'opus' },
  });
});

test('an incoming refresh is deferred while a field is focused and flushes on focusout', async ({ page }) => {
  await openBoard(page);
  const title = page.locator('[data-task="t-aa01"] .card-title');
  await expect(title).toHaveText('Add rate limiting middleware to the public REST API');

  // Focus the in-tab filter — any INPUT/TEXTAREA/SELECT inside #root counts as editing.
  await page.locator('#search-input').focus();

  const renamed = boardMessage();
  renamed.board.phases.new[0].title = 'RENAMED BY THE LOOP';
  await postRaw(page, renamed);

  // pendingBoard parked it: the card must still show the pre-refresh text.
  await expect(title).toHaveText('Add rate limiting middleware to the public REST API');
  await expect(page.locator('#search-input')).toBeFocused();

  // Blur -> the focusout handler flushes the deferred board (50ms timer inside board.js).
  await page.locator('#search-input').blur();
  await expect(page.locator('[data-task="t-aa01"] .card-title')).toHaveText('RENAMED BY THE LOOP');
});

test('opening the composer posts a draft with the selected groomer and model', async ({ page }) => {
  await openBoard(page);
  await page.locator('.tb-new').click();
  await page.locator('.composer-area').fill('the /orders endpoint 500s on a stale cursor');
  await page.locator('select[aria-label="Groom with"]').selectOption('On hold');
  await page.locator('select[aria-label="Work with"]').selectOption('sonnet');
  await page.getByRole('button', { name: 'Save Draft' }).click();

  expect(await sentOfType(page, 'createDraft')).toEqual([
    { type: 'createDraft', text: 'the /orders endpoint 500s on a stale cursor', groomer: 'none', model: 'sonnet' },
  ]);
});

test('the init empty state offers createFiles and nothing else', async ({ page }) => {
  await openBoard(page, { todoMissing: true });
  await expect(page.locator('.pane-title')).toHaveText('No LoopBoard workspace yet');
  await page.getByRole('button', { name: 'Initialize LoopBoard workspace' }).click();
  expect(await sent(page)).toEqual([{ type: 'createFiles' }]);
});

test('a markdown link in a note posts openLink rather than navigating', async ({ page }) => {
  await openBoard(page);
  await selectTab(page, 'In Progress');
  // t-bb01 carries two `note:` lines in the fixture, rendered as ONE note card; the second one
  // ends in a markdown link.
  const note = page.locator('[data-task="t-bb01"] .qa-note');
  await expect(note).toHaveCount(1);
  await expect(note).toContainText('Rebase on main before opening the PR.');

  // mdToHtml turns `[label](url)` into an `a[data-mdlink]`; the click handler preventDefault()s
  // and posts openLink, so the webview never navigates away from the board.
  const before = page.url();
  const link = note.locator('a[data-mdlink]');
  await expect(link).toHaveText('the retry dashboard');
  await link.click();

  expect(await sentOfType(page, 'openLink')).toEqual([
    { type: 'openLink', url: 'https://example.com/metrics/retries' },
  ]);
  expect(page.url()).toBe(before);
});
