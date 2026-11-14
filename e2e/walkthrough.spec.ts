import { expect, test, type Page } from '@playwright/test';

// Any uncaught exception in the page fails the test: a React crash blanks the whole app.
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (e) => list.push(String(e.stack ?? e)));
  page.on('console', (m) => m.type() === 'error' && list.push(`console.error: ${m.text()}`));
});
test.afterEach(({ page }) => {
  expect(errors.get(page) ?? [], 'page errors').toEqual([]);
});

const panel = (page: Page) => page.getByRole('complementary');
const node = (page: Page, title: string) => page.getByRole('button', { name: new RegExp(`^${title}\\.`) });
/** Wait until the node on screen has finished being written (streamed text appears before the server is done). */
async function written(page: Page) {
  await expect(panel(page).getByText(/is explained here for testing/)).toBeVisible();
  await expect(panel(page).getByRole('button', { name: /^Stop/ })).toHaveCount(0);
  await expect(panel(page).getByText('Next concepts')).toBeVisible();
}
const depth = (page: Page) => page.getByText(/^depth \d+$/);

async function create(page: Page, topic: string) {
  await page.goto('/');
  await expect(page.getByText(/Fake \(testing\): ready/)).toBeVisible();
  await page.getByPlaceholder('e.g. Deep learning').fill(topic);
  await page.getByRole('button', { name: 'Start mapping' }).click();
}

test('PRD walkthrough: map, explain, links, shared concept, question, ghost link, anchor, restore', async ({ page }) => {
  await create(page, 'Deep learning');

  // US-1: root explained automatically, starter nodes appear
  await expect(panel(page).getByRole('heading', { name: 'Deep learning' })).toBeVisible();
  await written(page);
  for (const t of ['Deep learning Part A', 'Deep learning Part B', 'Deep learning Part C', 'Shared Concept']) {
    await expect(node(page, t)).toBeVisible();
  }

  // US-2: open a stub, nothing is generated until Explain is pressed
  await node(page, 'Deep learning Part A').click();
  await expect(panel(page).getByRole('heading', { name: 'Deep learning Part A' })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Explain' })).toBeVisible();
  await expect(panel(page).getByText('First part of Deep learning.')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Explain' }).click();
  await written(page);
  await expect(depth(page)).toHaveText('depth 1');

  // US-4: a link to a concept that already exists opens that node, no duplicate
  await expect(panel(page).locator('[data-concept="Shared Concept"][data-existing="true"]')).toBeVisible();
  await panel(page).locator('[data-concept="Shared Concept"]').click();
  await expect(panel(page).getByRole('heading', { name: 'Shared Concept' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Path from the root' })).toContainText('Deep learning');
  await expect(page.getByRole('button', { name: /^Shared Concept\./ })).toHaveCount(1);
  await panel(page).getByRole('button', { name: 'Explain' }).click();
  await written(page);
  // Part A mentioned it too: "Mentioned in" lists it
  await expect(panel(page).getByText('Mentioned in')).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Deep learning Part A', exact: true })).toBeVisible();

  // US-5 and US-3: ask a question, then follow a ghost link in the answer
  await node(page, 'Deep learning Part A').click();
  await panel(page).getByPlaceholder('Ask about Deep learning Part A…').fill('why?');
  await panel(page).getByPlaceholder('Ask about Deep learning Part A…').press('Enter');
  await expect(panel(page).getByText(/Answer about/)).toBeVisible();
  const ghost = panel(page).locator('[data-concept="Deep learning Part A Detail"]');
  await expect(ghost).toHaveAttribute('data-existing', 'false');
  await ghost.click();
  await expect(panel(page).getByRole('heading', { name: 'Deep learning Part A Detail' })).toBeVisible();
  await written(page);
  await expect(depth(page)).toHaveText('depth 2');

  await page.screenshot({ path: 'test-results/fake-walkthrough.png' });

  // US-7 and US-8: anchor, go deeper, come back in one click, use breadcrumb
  await page.getByRole('button', { name: 'Set anchor here' }).click();
  await panel(page).locator('[data-concept^="Deep learning Part A Detail Part"]').first().click();
  await panel(page).getByRole('button', { name: 'Explain' }).click();
  await written(page);
  await expect(depth(page)).toHaveText('depth 3');
  const toAnchor = page.getByRole('button', { name: /^⚓/ });
  await expect(toAnchor).toContainText('Deep learning Part A Detail');
  await toAnchor.click();
  await expect(panel(page).getByRole('heading', { name: 'Deep learning Part A Detail' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Path from the root' }).getByRole('button', { name: 'Deep learning', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: 'Deep learning', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: 'Deep learning Part A Detail' })).toBeVisible();
  await page.getByRole('button', { name: 'Forward', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: 'Deep learning', exact: true })).toBeVisible();

  // search
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Find a node' }).fill('part b');
  await page.keyboard.press('Enter');
  await expect(panel(page).getByRole('heading', { name: 'Deep learning Part B' })).toBeVisible();

  // US-9: reload; the map, content, selection, anchor and trail are restored
  await page.waitForTimeout(900); // view state is debounced on the server
  await page.reload();
  await page.getByRole('button', { name: /Deep learning/ }).first().click();
  await expect(panel(page).getByRole('heading', { name: 'Deep learning Part B' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^⚓/ })).toContainText('Deep learning Part A Detail');
  await expect(page.getByRole('navigation', { name: 'Trail' }).getByRole('button')).not.toHaveCount(0);
  await node(page, 'Deep learning Part A').click();
  await expect(panel(page).getByText('why?', { exact: true })).toBeVisible();
  await expect(panel(page).getByText(/Answer about/)).toBeVisible();
});

test('Stop returns a node to its previous state', async ({ page }) => {
  await create(page, 'Waiting __hang__');
  await expect(panel(page).getByRole('button', { name: /^Stop/ })).toBeVisible();
  await panel(page).getByRole('button', { name: /^Stop/ }).click();
  await expect(panel(page).getByRole('button', { name: 'Explain' })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: /^Stop/ })).toHaveCount(0);
});

test('a provider error shows its own message and can be retried', async ({ page }) => {
  await create(page, 'Limits __ratelimit__');
  await expect(panel(page).getByText('Fake rate limit.')).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('select text, then Explain this creates a concept; keyboard moves between nodes', async ({ page }) => {
  await create(page, 'Selecting');
  await written(page);
  const para = panel(page).locator('.md p').first();
  await para.evaluate((el) => {
    const range = document.createRange();
    const text = el.firstChild?.nextSibling ?? el;
    range.selectNodeContents(el.querySelector('strong') ?? text);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(page.getByRole('toolbar', { name: 'Selection actions' })).toBeVisible();
  await page.getByRole('button', { name: 'Ask about this' }).click();
  await expect(panel(page).getByText('“Selecting”')).toBeVisible();

  // arrow keys on the canvas
  await page.locator('.react-flow').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ArrowRight');
  await expect(panel(page).getByRole('heading', { name: 'Selecting Part A' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(panel(page).getByRole('heading', { name: 'Selecting Part B' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(panel(page).getByRole('heading', { name: 'Selecting', exact: true })).toBeVisible();
});

test('the server refuses foreign hosts and origins', async ({ request }) => {
  const res = await request.get('/api/health', { headers: { origin: 'https://example.com' } });
  expect(res.status()).toBe(403);
});
