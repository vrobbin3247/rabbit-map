import { expect, test } from '@playwright/test';

// Spends real plan quota (3 model calls). Run by hand with `npm run test:real`.
test('real provider: map, child, shared link, question', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.getByText(/Claude: ready/)).toBeVisible();

  await page.getByPlaceholder('e.g. Deep learning').fill('Deep learning');
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Start mapping' }).click();
  const panel = page.getByRole('complementary');
  await expect(panel.locator('.md p').first()).toBeVisible();
  console.log(`first words after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await expect(panel.getByText('Next concepts')).toBeVisible();
  console.log(`root finished after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const rootText = await panel.innerText();
  expect(rootText).not.toContain('===META');
  await page.screenshot({ path: 'test-results/real-1-root.png' });

  // open the first suggested child and explain it
  const chips = panel.locator('section', { hasText: 'Next concepts' }).getByRole('button');
  const first = ((await chips.first().innerText()) ?? '').trim();
  console.log('opening child:', first);
  await chips.first().click();
  await expect(panel.getByRole('heading', { name: first, exact: true })).toBeVisible();
  const t1 = Date.now();
  await panel.getByRole('button', { name: 'Explain' }).click();
  await expect(panel.getByRole('button', { name: /^Stop/ })).toHaveCount(0);
  await expect(panel.locator('.md p').first()).toBeVisible();
  console.log(`child finished after ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  const links = await panel.locator('[data-concept]').evaluateAll((els) => els.map((e) => `${(e as HTMLElement).dataset.concept}:${(e as HTMLElement).dataset.existing}`));
  console.log('links in child:', links.join(' | '));
  await page.screenshot({ path: 'test-results/real-2-child.png' });

  // ask a question on it
  const box = panel.getByRole('textbox');
  await box.fill('Can you give a concrete numeric example?');
  const t2 = Date.now();
  await box.press('Enter');
  await expect(panel.locator('section[aria-label="Questions"] .md').first()).toBeVisible();
  await expect(panel.locator('[aria-busy="true"]')).toHaveCount(0);
  console.log(`answer after ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  await page.screenshot({ path: 'test-results/real-3-answer.png' });
  expect(errors).toEqual([]);
});
