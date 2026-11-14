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

test('a question that names kinds of a concept adds them as nodes on the board', async ({ page }) => {
  await create(page, 'Padding');
  await written(page);
  await node(page, 'Padding Part A').click();
  await expect(node(page, 'Padding Part A Kind One')).toHaveCount(0);
  const ask = panel(page).getByPlaceholder('Ask about Padding Part A…');
  await ask.fill('what are the different kinds? __children__');
  await ask.press('Enter');
  await expect(panel(page).getByText(/Answer about/)).toBeVisible();

  // the nodes appear on the board, and as next concepts in the panel
  await expect(node(page, 'Padding Part A Kind One')).toBeVisible();
  await expect(node(page, 'Padding Part A Kind Two')).toBeVisible();
  await expect(panel(page).getByText('Next concepts')).toBeVisible();
  await expect(panel(page).locator('section', { hasText: 'Next concepts' }).getByRole('button', { name: 'Padding Part A Kind One', exact: true })).toBeVisible();

  // the links in the answer are solid links to those nodes, and following one opens the node
  const link = panel(page).locator('[data-concept="Padding Part A Kind Two"]');
  await expect(link).toHaveAttribute('data-existing', 'true');
  await link.click();
  await expect(panel(page).getByRole('heading', { name: 'Padding Part A Kind Two' })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Explain' })).toBeVisible(); // a stub, not yet written
  await expect(page.getByRole('navigation', { name: 'Path from the root' })).toContainText('Padding Part A');
});

test('drag a node: it moves, stays put after reload, its unplaced branch follows, Tidy up resets', async ({ page, request }) => {
  await create(page, 'Dragging');
  await written(page);
  const a = node(page, 'Dragging Part A');
  const b = node(page, 'Dragging Part B');
  const box = async (l: ReturnType<typeof node>) => (await l.boundingBox())!;

  // a plain click still selects (it may pan the board, so measure afterwards)
  await a.click();
  await expect(panel(page).getByRole('heading', { name: 'Dragging Part A' })).toBeVisible();
  await page.waitForTimeout(400);
  const a0 = await box(a);
  const b0 = await box(b);

  // drag Part A down and to the right
  await page.mouse.move(a0.x + 40, a0.y + 30);
  await page.mouse.down();
  await page.mouse.move(a0.x + 120, a0.y + 90, { steps: 6 });
  await page.mouse.move(a0.x + 200, a0.y + 160, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await box(a)).x - a0.x)).toBeGreaterThan(120);
  const a1 = await box(a);
  expect(Math.round(a1.y - a0.y)).toBeGreaterThan(100);
  const b1 = await box(b);
  expect(Math.round(Math.abs(b1.x - b0.x))).toBeLessThan(3); // siblings do not move
  expect(Math.round(Math.abs(b1.y - b0.y))).toBeLessThan(3);

  // the position was saved on the server
  const mapId = ((await (await request.get('/api/maps')).json()).maps as { id: string; title: string }[]).find((m) => m.title === 'Dragging')!.id;
  const saved = async () => Object.values(((await (await request.get(`/api/maps/${mapId}`)).json()).map.nodes) as Record<string, { title: string; position?: { x: number; y: number } | null }>);
  await expect.poll(async () => (await saved()).find((n) => n.title === 'Dragging Part A')?.position?.x ?? null).not.toBeNull();
  expect((await saved()).filter((n) => n.position).map((n) => n.title)).toEqual(['Dragging Part A']);

  // reload and reopen: still there
  await page.waitForTimeout(900);
  await page.reload();
  await page.getByRole('button', { name: /Dragging/ }).first().click();
  const a2 = await box(node(page, 'Dragging Part A'));
  const b2 = await box(node(page, 'Dragging Part B'));
  expect(Math.round(a2.x - b2.x)).toBeGreaterThan(100); // A is still well to the right of B
  expect(Math.round(a2.y - b2.y)).toBeGreaterThan(50);

  // Tidy up puts it back
  await page.getByRole('button', { name: /^Tidy up/ }).click();
  await expect.poll(async () => (await saved()).filter((n) => n.position).length).toBe(0);
  await expect.poll(async () => Math.round(Math.abs((await box(node(page, 'Dragging Part A'))).x - (await box(node(page, 'Dragging Part B'))).x))).toBeLessThan(3);
  await expect(page.getByRole('button', { name: /^Tidy up/ })).toBeDisabled();
  await page.screenshot({ path: 'test-results/fake-board.png' });
});

const menu = (page: Page) => page.getByRole('menu', { name: /^Actions for/ });
const item = (page: Page, name: string | RegExp) => page.getByRole('menuitem', { name });

test('right-click menu on a node: select, add a child, navigate, release a dragged node, Escape', async ({ page, request }) => {
  await create(page, 'Menus');
  await written(page);
  const a = node(page, 'Menus Part A');

  // right-click selects the node and opens its menu
  await a.click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: 'Menus Part A' })).toBeVisible();
  await expect(item(page, 'Explain')).toBeVisible();
  await expect(item(page, /^Regenerate/)).toHaveCount(0);
  await expect(item(page, /^Delete/)).toBeVisible();
  await expect(item(page, 'Release position')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);

  // Add child concept: a stub, not explained, no model call
  await a.click({ button: 'right' });
  await item(page, /^Add child concept/).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Custom Idea');
  await page.keyboard.press('Enter');
  await expect(panel(page).getByRole('heading', { name: 'Custom Idea' })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Explain' })).toBeVisible();
  await expect(node(page, 'Custom Idea')).toBeVisible();

  // an existing name opens the existing node instead of duplicating it
  await a.click({ button: 'right' });
  await item(page, /^Add child concept/).click();
  await page.getByRole('dialog').getByRole('textbox').fill('menus part b');
  await page.keyboard.press('Enter');
  await expect(panel(page).getByRole('heading', { name: 'Menus Part B' })).toBeVisible();
  await expect(page.getByText(/already exists/)).toBeVisible();

  // navigation items
  await node(page, 'Custom Idea').click({ button: 'right' });
  await item(page, 'Go to parent').click();
  await expect(panel(page).getByRole('heading', { name: 'Menus Part A' })).toBeVisible();

  // drag a node, then release it from the menu
  const box = (await a.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 120, { steps: 6 });
  await page.mouse.up();
  await a.click({ button: 'right' });
  await item(page, 'Release position').click();
  const mapId = ((await (await request.get('/api/maps')).json()).maps as { id: string; title: string }[]).find((m) => m.title === 'Menus')!.id;
  await expect.poll(async () => Object.values((await (await request.get(`/api/maps/${mapId}`)).json()).map.nodes as Record<string, { position?: unknown }>).filter((n) => n.position).length).toBe(0);

  // empty board: board actions
  const pane = page.locator('.react-flow__pane');
  await pane.click({ button: 'right', position: { x: 300, y: 500 } });
  await expect(page.getByRole('menu', { name: 'Board actions' })).toBeVisible();
  await expect(item(page, 'Fit the whole map')).toBeVisible();
  await expect(item(page, 'Tidy up layout')).toBeDisabled(); // nothing is pinned
  await item(page, 'Show all cross-links').click();
  await pane.click({ button: 'right', position: { x: 300, y: 500 } });
  await expect(item(page, 'Hide cross-links')).toBeVisible();
  await page.keyboard.press('Escape');

  // keyboard: Shift+F10 opens the menu for the selected node; arrows move; Enter runs
  await node(page, 'Menus Part B').click();
  await page.locator('.react-flow').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Shift+F10');
  await expect(menu(page)).toBeVisible();
  await expect(item(page, 'Explain')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'Ask a question…')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu(page)).toHaveCount(0);
  await expect(panel(page).getByPlaceholder(/^Ask about/)).toBeFocused();
});

test('Escape closes the menu without stopping a running generation; Stop writing does', async ({ page }) => {
  await create(page, 'Busy __hang__');
  await expect(panel(page).getByRole('button', { name: /^Stop/ })).toBeVisible();
  await node(page, 'Busy __hang__').click({ button: 'right' });
  await expect(item(page, 'Stop writing')).toBeVisible();
  await expect(item(page, /^Delete/)).toHaveCount(0); // the root has no Delete
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /^Stop/ })).toBeVisible(); // still running
  await node(page, 'Busy __hang__').click({ button: 'right' });
  await item(page, 'Stop writing').click();
  await expect(panel(page).getByRole('button', { name: 'Explain' })).toBeVisible();
});

test('theme toggle: light, dark, system; remembered; the board follows', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const attr = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const toggle = (name: string) => page.getByRole('button', { name: `${name} theme` });

  await expect(toggle('System')).toHaveAttribute('aria-pressed', 'true');
  expect(await attr()).toBeNull();
  const light = await bg();

  await toggle('Dark').click();
  expect(await attr()).toBe('dark');
  const dark = await bg();
  expect(dark).not.toBe(light);
  await expect(toggle('Dark')).toHaveAttribute('aria-pressed', 'true');

  // remembered across a reload, and applied before the first paint (no flash)
  await page.reload();
  expect(await attr()).toBe('dark');
  expect(await bg()).toBe(dark);

  // System follows the OS
  await toggle('System').click();
  expect(await attr()).toBeNull();
  expect(await bg()).toBe(light);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await bg()).toBe(dark);

  // an explicit Light wins over a dark OS
  await toggle('Light').click();
  expect(await attr()).toBe('light');
  expect(await bg()).toBe(light);

  // the board follows the theme too
  await toggle('Dark').click();
  await page.getByPlaceholder('e.g. Deep learning').fill('Theming');
  await page.getByRole('button', { name: 'Start mapping' }).click();
  await expect(page.locator('.react-flow')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Light theme' }).click();
  await expect(page.locator('.react-flow')).toHaveClass(/light/);
  await page.screenshot({ path: 'test-results/fake-light.png' });
  await page.getByRole('button', { name: 'Dark theme' }).click();
  await page.screenshot({ path: 'test-results/fake-dark.png' });
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
