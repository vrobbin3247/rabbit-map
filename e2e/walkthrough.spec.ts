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
  const toAnchor = page.getByRole('button', { name: /^Back to anchor/ });
  await expect(toAnchor).toHaveAttribute('aria-label', /Deep learning Part A Detail/);
  await toAnchor.click();
  await expect(panel(page).getByRole('heading', { name: 'Deep learning Part A Detail' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Path from the root' }).getByRole('button', { name: 'Deep learning', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: 'Deep learning', exact: true })).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft'); // Back
  await expect(panel(page).getByRole('heading', { name: 'Deep learning Part A Detail' })).toBeVisible();
  await page.keyboard.press('Alt+ArrowRight'); // Forward
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
  await expect(page.getByRole('button', { name: /^Back to anchor/ })).toHaveAttribute('aria-label', /Deep learning Part A Detail/);
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

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Titles of nodes that sit under the floating tools or trail. */
async function nodesUnderOverlays(page: Page): Promise<string[]> {
  const overlays = [(await page.locator('.toolbar').boundingBox())!, (await page.getByRole('navigation', { name: 'Trail' }).boundingBox())!];
  const hidden: string[] = [];
  for (const el of await page.locator('.react-flow__node').all()) {
    const b = (await el.boundingBox())!;
    if (overlays.some((o) => overlaps(b, o))) hidden.push((await el.innerText()).split('\n')[0]!);
  }
  return hidden;
}

test('Fit and jumping to a far node keep nodes clear of the floating toolbar and trail', async ({ page }) => {
  await create(page, 'Layout');
  await written(page);
  // grow the map to a few levels and many nodes
  for (const t of ['Layout Part A', 'Layout Part B', 'Layout Part C']) {
    await node(page, t).click();
    await panel(page).getByRole('button', { name: 'Explain' }).click();
    await written(page);
  }
  await node(page, 'Layout Part A Part A').click();
  await panel(page).getByRole('button', { name: 'Explain' }).click();
  await written(page);

  await page.getByRole('button', { name: 'Fit the whole map' }).click();
  await page.waitForTimeout(500);
  expect(await nodesUnderOverlays(page)).toEqual([]);

  // pan the board far away, then jump to a node with search: it must land in the free area
  await page.mouse.move(700, 400);
  await page.mouse.down();
  await page.mouse.move(100, 120, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Find a node' }).fill('layout part a part a part b');
  await page.keyboard.press('Enter');
  await expect(panel(page).getByRole('heading', { name: /Layout Part A Part A Part B/ })).toBeVisible();
  await page.waitForTimeout(500);
  const b = (await page.getByRole('button', { name: /^Layout Part A Part A Part B\./ }).boundingBox())!;
  const main = (await page.getByRole('main').boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(main.x + 84); // right of the tool strip
  expect(b.x + b.width).toBeLessThanOrEqual(main.x + main.width);
  expect(b.y).toBeGreaterThanOrEqual(main.y);
  expect(await nodesUnderOverlays(page).then((l) => l.filter((t) => t.startsWith('Layout Part A Part A Part B')))).toEqual([]);
});

test('keyboard navigation while zoomed in keeps the selected node in the free area, clear of the tools', async ({ page }) => {
  await create(page, 'Rapid');
  await written(page);
  for (const t of ['Rapid Part A', 'Rapid Part B', 'Rapid Part C']) {
    await node(page, t).click();
    await panel(page).getByRole('button', { name: 'Explain' }).click();
    await written(page);
  }
  // zoom in, so that moving between nodes needs the board to move each time
  await page.getByRole('button', { name: 'Fit the whole map' }).click();
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.waitForTimeout(200);
  }
  await page.locator('.react-flow').click({ position: { x: 400, y: 20 } });
  // walk down the tree as fast as the keyboard can: each press starts a new centring while the last is still moving
  await page.keyboard.press('a'); // go to the anchor (the root); the board centres it
  await page.waitForTimeout(500);
  // 30 ms apart, from inside the page: Playwright's own key presses are too slow to overlap the animation.
  await page.evaluate(async () => {
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowRight']) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    }
  });
  await page.waitForTimeout(700);
  const title = (await panel(page).getByRole('heading', { level: 2 }).innerText()).trim();
  const b = (await page.getByRole('button', { name: new RegExp(`^${title}\\.`) }).boundingBox())!;
  const main = (await page.getByRole('main').boundingBox())!;
  expect(b.x, `${title} is clear of the tool strip`).toBeGreaterThanOrEqual(main.x + 84);
  expect(b.x + b.width, `${title} is not cut off on the right`).toBeLessThanOrEqual(main.x + main.width + 1);
  expect(b.y).toBeGreaterThanOrEqual(main.y);
  expect(b.y + b.height).toBeLessThanOrEqual(main.y + main.height);
});

test('responsive: side by side when wide, panel below the board when narrow', async ({ page }) => {
  await create(page, 'Narrow');
  await written(page);
  const main = page.getByRole('main');
  const aside = panel(page);

  // wide: the panel is to the right of the board
  let m = (await main.boundingBox())!;
  let a = (await aside.boundingBox())!;
  expect(a.x).toBeGreaterThanOrEqual(m.x + m.width - 2);
  expect(await page.getByRole('separator', { name: 'Resize panel' }).isVisible()).toBe(true);

  // narrow: below the board, full width, the resize handle is gone, and the ask box is still reachable
  await page.setViewportSize({ width: 700, height: 800 });
  await page.waitForTimeout(300);
  m = (await main.boundingBox())!;
  a = (await aside.boundingBox())!;
  expect(a.y).toBeGreaterThanOrEqual(m.y + m.height - 2);
  expect(Math.round(m.width)).toBeGreaterThanOrEqual(640); // the board, beside the slim collapsed trail
  expect(Math.round(a.width)).toBeGreaterThanOrEqual(680);
  expect(await page.getByRole('separator', { name: 'Resize panel' }).isVisible()).toBe(false);
  await expect(aside.getByPlaceholder(/^Ask about/)).toBeVisible();
  const ask = (await aside.getByPlaceholder(/^Ask about/).boundingBox())!;
  expect(ask.y + ask.height).toBeLessThanOrEqual(800);
  // the page itself does not scroll sideways
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/narrow.png' });
});

test('card colour: choose one, it shows on the board, survives a reload, and can go back to automatic', async ({ page }) => {
  await create(page, 'Paint');
  await written(page);
  const tone = (t: string) => node(page, t).getAttribute('data-tone');
  expect(await tone('Paint Part A')).toBe('1'); // depth 1 is blue by default

  await node(page, 'Paint Part A').click({ button: 'right' });
  await item(page, 'Colour…').click();
  const dialog = page.getByRole('dialog', { name: /^Colour for/ });
  await expect(dialog.getByRole('button', { name: 'Automatic (by depth)' })).toBeDisabled(); // nothing chosen yet
  await dialog.getByRole('button', { name: 'Pink' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await tone('Paint Part A')).toBe('3');
  expect(await tone('Paint Part B')).toBe('1'); // others unchanged
  expect(await tone('Paint')).toBe('0');

  // the colour is really applied, and differs from the depth colour
  const fill = (t: string) => node(page, t).evaluate((el) => getComputedStyle(el).borderColor);
  expect(await fill('Paint Part A')).not.toBe(await fill('Paint Part B'));

  // it survives a reload
  await page.waitForTimeout(900);
  await page.reload();
  await page.getByRole('button', { name: /Paint/ }).first().click();
  expect(await tone('Paint Part A')).toBe('3');

  // back to automatic
  await node(page, 'Paint Part A').click({ button: 'right' });
  await item(page, 'Colour…').click();
  await expect(dialog.getByRole('button', { name: 'Pink' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Automatic (by depth)' }).click();
  expect(await tone('Paint Part A')).toBe('1');
});

test('Add all: concepts an answer mentions beyond the five it added become cards in one click', async ({ page }) => {
  await create(page, 'Rest');
  await written(page);
  await node(page, 'Rest Part A').click();
  const ask = panel(page).getByPlaceholder('Ask about Rest Part A…');
  await ask.fill('what are the kinds? __many__');
  await ask.press('Enter');
  await expect(panel(page).getByText(/Answer about/)).toBeVisible();

  // five became cards; four more concepts are mentioned (three kinds and a "Detail") but have no card
  await expect(node(page, 'Rest Part A Kind Five')).toBeVisible();
  await expect(node(page, 'Rest Part A Kind Six')).toHaveCount(0);
  const section = panel(page).getByRole('region', { name: 'Mentioned but not added' });
  await expect(section.getByRole('button', { name: 'Rest Part A Kind Six' })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Rest Part A Kind Eight' })).toBeVisible();
  await section.getByRole('button', { name: 'Add all 4' }).click();

  await expect(page.getByText('Added 4 cards.')).toBeVisible();
  for (const k of ['Six', 'Seven', 'Eight']) await expect(node(page, `Rest Part A Kind ${k}`)).toBeVisible();
  await expect(node(page, 'Rest Part A Detail')).toBeVisible();
  await expect(section).toHaveCount(0); // nothing left to add
  // they are stubs: nothing was written, so no model call was made
  const nextConcepts = panel(page).locator('section', { hasText: 'Next concepts' });
  await expect(nextConcepts.getByRole('button', { name: 'Rest Part A Kind Seven', exact: true })).toBeVisible();
  await nextConcepts.getByRole('button', { name: 'Rest Part A Kind Seven', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Explain' })).toBeVisible();
});

test("What's left: lists unopened cards, shows progress, narrows to a branch, explains from the list", async ({ page }) => {
  await create(page, 'Left');
  await written(page);
  const chip = page.getByRole('button', { name: /\d+ left$/ });
  await expect(chip).toHaveText('4 left'); // Part A, B, C and Shared Concept
  await chip.click();
  const dialog = page.getByRole('dialog', { name: "What's left" });
  await expect(dialog.getByText('1 of 5 cards explained')).toBeVisible();
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20');
  await expect(dialog.getByRole('region', { name: 'Under Left', exact: true }).getByText('Left Part A', { exact: true })).toBeVisible();

  // explain one from the list; the count drops and the list updates
  const row = dialog.getByRole('listitem').filter({ hasText: 'Left Part B' });
  await row.getByRole('button', { name: 'Explain' }).click();
  await expect(dialog.getByText('2 of 8 cards explained')).toBeVisible(); // it added three more cards
  await expect(dialog.getByRole('region', { name: 'Under Left Part B' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(chip).toHaveText('6 left');

  // open a card from the list: selects it and closes the dialog
  await chip.click();
  await dialog.getByRole('listitem').filter({ hasText: 'Left Part C' }).getByRole('button', { name: 'Open' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(panel(page).getByRole('heading', { name: 'Left Part C' })).toBeVisible();

  // only under the selected branch
  await node(page, 'Left Part B').click();
  await chip.click();
  await dialog.getByLabel(/Only under “Left Part B”/).check();
  await expect(dialog.getByRole('region', { name: 'Under Left Part B' })).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Under Left', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.screenshot({ path: 'test-results/left.png' });
});

test('undo a delete and a merge from the message and from the keyboard', async ({ page }) => {
  await create(page, 'Undo');
  await written(page);
  await node(page, 'Undo Part A').click();
  await panel(page).getByRole('button', { name: 'Explain' }).click();
  await written(page);
  const before = await page.locator('.react-flow__node').count();

  // delete a branch from the menu, then press Undo on the message
  await node(page, 'Undo Part A').click({ button: 'right' });
  await item(page, /^Delete/).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Delete 4 nodes/ }).click();
  await expect(page.getByText('Deleted “Undo Part A” and 3 below it')).toBeVisible();
  await expect(node(page, 'Undo Part A')).toHaveCount(0);
  expect(await page.locator('.react-flow__node').count()).toBeLessThan(before);
  await page.getByRole('status').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Undone: Deleted “Undo Part A” and 3 below it.')).toBeVisible();
  await expect(node(page, 'Undo Part A')).toBeVisible();
  await expect(node(page, 'Undo Part A Part A')).toBeVisible();
  expect(await page.locator('.react-flow__node').count()).toBe(before);

  // merge, then undo with Ctrl/Cmd+Z
  await node(page, 'Undo Part B').click({ button: 'right' });
  await item(page, /^Merge into/).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Part C');
  await page.getByRole('dialog').getByRole('button', { name: 'Undo Part C' }).click();
  await expect(node(page, 'Undo Part B')).toHaveCount(0);
  await expect(page.getByText(/^Merged “Undo Part B” into “Undo Part C”/)).toBeVisible();
  await page.locator('.react-flow').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(node(page, 'Undo Part B')).toBeVisible();
  await expect(node(page, 'Undo Part C')).toBeVisible();

  // it survives a reload (the restored map was saved)
  await page.waitForTimeout(900);
  await page.reload();
  await page.getByRole('button', { name: /Undo/ }).first().click();
  await expect(node(page, 'Undo Part B')).toBeVisible();
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
  await a.click({ button: 'right', position: { x: 190, y: 30 } });
  await expect(menu(page)).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: 'Menus Part A' })).toBeVisible();
  await expect(item(page, 'Explain')).toBeVisible();
  await expect(item(page, /^Regenerate/)).toHaveCount(0);
  await expect(item(page, /^Delete/)).toBeVisible();
  await expect(item(page, 'Release position')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);

  // Add child concept: a stub, not explained, no model call
  await a.click({ button: 'right', position: { x: 190, y: 30 } });
  await item(page, /^Add child concept/).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Custom Idea');
  await page.keyboard.press('Enter');
  await expect(panel(page).getByRole('heading', { name: 'Custom Idea' })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Explain' })).toBeVisible();
  await expect(node(page, 'Custom Idea')).toBeVisible();

  // an existing name opens the existing node instead of duplicating it
  await a.click({ button: 'right', position: { x: 190, y: 30 } });
  await item(page, /^Add child concept/).click();
  await page.getByRole('dialog').getByRole('textbox').fill('menus part b');
  await page.keyboard.press('Enter');
  await expect(panel(page).getByRole('heading', { name: 'Menus Part B' })).toBeVisible();
  await expect(page.getByText(/already exists/)).toBeVisible();

  // navigation items
  await node(page, 'Custom Idea').click({ button: 'right' });
  await item(page, 'Go to parent').click();
  await expect(panel(page).getByRole('heading', { name: 'Menus Part A' })).toBeVisible();

  // Drag a node, then release it from the menu. This test is also the guard for a centring race: a
  // selection made while the board was still moving used to skip centring, leaving nodes under the
  // tool strip (it fails 6 of 6 runs without the fix). Let the board finish moving before the press.
  await page.waitForTimeout(500);
  const box = (await a.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 120, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await a.boundingBox())!.x - box.x)).toBeGreaterThan(60); // it really moved
  await a.click({ button: 'right', position: { x: 190, y: 30 } });
  await expect(item(page, 'Release position')).toBeVisible(); // so there is something to release
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

test('AI settings: one button opens a themed menu; the custom dropdown changes the level and it is saved', async ({ page }) => {
  await create(page, 'Settings');
  await written(page);
  const summary = page.getByRole('button', { name: /beginner/ });
  await summary.click();
  const level = page.getByRole('combobox', { name: 'Learner level' });
  await level.click();
  // the list is part of the page (not the operating system's), so it can be found and styled
  await expect(page.getByRole('listbox', { name: 'Learner level' })).toBeVisible();
  await page.getByRole('option', { name: 'advanced' }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(level).toContainText('advanced');
  await expect(page.getByRole('button', { name: /· advanced$/ })).toBeVisible();
  // Escape closes an open list first, then the menu
  await level.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(level).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(level).toHaveCount(0);
  // saved with the map
  await page.reload();
  await page.getByRole('button', { name: /Settings/ }).first().click();
  await expect(page.getByRole('button', { name: /· advanced$/ })).toBeVisible();
});

test('spotlight: other branches fade, the current path and its neighbours stay clear, and it can be turned off', async ({ page }) => {
  await create(page, 'Spot');
  await written(page);
  for (const t of ['Spot Part A', 'Spot Part B']) {
    await node(page, t).click();
    await panel(page).getByRole('button', { name: 'Explain' }).click();
    await written(page);
  }
  await node(page, 'Spot Part A').click();
  // children of the other branch are off the path and not neighbours: faded
  await expect(node(page, 'Spot Part B Part A')).toHaveClass(/dim/);
  // the path, the selected card's children and the root's other children are not
  await expect(node(page, 'Spot Part A Part A')).not.toHaveClass(/dim/);
  await expect(node(page, 'Spot Part B')).not.toHaveClass(/dim/);
  await expect(node(page, 'Spot')).not.toHaveClass(/dim/);
  // pointing at a faded card brings it back, and the toggle shows everything equally
  await page.getByRole('button', { name: /^Spotlight is on/ }).click();
  await expect(page.locator('.cnode.dim')).toHaveCount(0);
  await page.getByRole('button', { name: /^Spotlight the current branch/ }).click();
  await expect(node(page, 'Spot Part B Part A')).toHaveClass(/dim/);
});

test('trail: a journey tree you can fold, search and clear, with counts, the anchor and where you are', async ({ page }) => {
  await create(page, 'Journey');
  await written(page);
  for (const t of ['Journey Part A', 'Journey Part B']) {
    await node(page, t).click();
    await panel(page).getByRole('button', { name: 'Explain' }).click();
    await written(page);
  }
  await node(page, 'Journey Part A').click(); // visit A a second time
  const trail = page.getByRole('navigation', { name: 'Trail' });
  const entry = (title: string) => trail.getByRole('button', { name: new RegExp(`^${title}( anchor| you are here| ×\\d+)*$`) });

  // each card once, the one you are on marked, the anchor marked, repeat visits counted
  await expect(entry('Journey Part A')).toHaveAttribute('aria-current', 'step');
  await expect(trail.getByRole('button', { name: /^Journey anchor/ })).toBeVisible();
  await expect(trail.getByText('×2')).toHaveCount(1); // Part A twice; the others once or more are counted only when repeated
  await expect(trail.getByRole('button', { name: /^Journey Part A/ })).toHaveCount(1);

  // fold and unfold the root
  await trail.getByRole('button', { name: 'Fold Journey' }).click();
  await expect(entry('Journey Part B')).toHaveCount(0);
  await trail.getByRole('button', { name: 'Unfold Journey' }).click();
  await expect(entry('Journey Part B')).toBeVisible();

  // search keeps the matches and what is above them
  await trail.getByRole('textbox', { name: 'Search trail' }).fill('part b');
  await expect(entry('Journey Part B')).toBeVisible();
  await expect(entry('Journey Part A')).toHaveCount(0);
  await trail.getByRole('textbox', { name: 'Search trail' }).fill('zzz');
  await expect(trail.getByText(/Nothing in your trail matches/)).toBeVisible();
  await trail.getByRole('textbox', { name: 'Search trail' }).fill('');

  // clicking a card in the trail goes there; Clear keeps only where you are
  await entry('Journey Part B').click();
  await expect(panel(page).getByRole('heading', { name: 'Journey Part B' })).toBeVisible();
  await trail.getByRole('button', { name: 'Clear' }).click();
  await expect(trail.getByRole('button', { name: /^Journey/ })).toHaveCount(1);
  await expect(entry('Journey Part B')).toHaveAttribute('aria-current', 'step');
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
