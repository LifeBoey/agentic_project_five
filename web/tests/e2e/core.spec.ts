// Data-agnostic checks: they hold for any dataset, so they run on fixture data and on every real data drop.
import { expect, test } from '@playwright/test';
import { openAndListModels, REAL, rows, stubApi, watchForBreakage } from './helpers';

test.beforeEach(async ({ page }) => {
  if (!REAL) await stubApi(page);
});

test('every model: summary agrees with the rows, and nothing unknown looks safe', async ({ page }) => {
  const problems = watchForBreakage(page);
  const models = await openAndListModels(page);
  expect(models.length, 'the graph should list at least one model').toBeGreaterThan(0);

  for (const model of models) {
    await page.getByLabel('Drone model').selectOption({ label: model });
    await expect(page.getByTestId('headline')).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
    const where = `model ${model}`;

    const total = await rows(page).count();
    const red = await page.locator('[data-state="red"]').count();
    const unknown = await page.locator('[data-state="unknown"]').count();
    const partly = await page.locator('.row:has(.badge-partly)').count();
    const notResearched = await page.locator('[data-state="not_researched"]').count();

    // The headline number equals the number of red rows, and the totals agree.
    const headline = (await page.getByTestId('headline').textContent()) ?? '';
    expect(Number(headline.match(/^\s*(\d+)/)?.[1]), `${where}: headline "${headline}"`).toBe(red);
    await expect(page.getByTestId('count-total')).toContainText(`${total} components`);
    // Unmapped and partly unmapped are counted together, so no gap goes missing from the summary.
    await expect(page.getByTestId('count-unknown')).toContainText(`${unknown + partly} unmapped`);

    // Expected components with no record are shown, counted, grey, and never safe.
    await expect(page.getByTestId('count-not-researched')).toContainText(`${notResearched} not researched`);
    for (const row of await page.locator('[data-state="not_researched"]').all()) {
      await expect(row).toContainText('Not researched');
      await expect(row).not.toContainText('Single country');
      await expect(row.locator('a')).toHaveCount(0);
      await expect(row).toHaveCSS('background-color', 'rgb(239, 239, 239)');
    }
    // Fully unmapped rows are grey, say so, and offer no source or red marking.
    for (const row of await page.locator('[data-state="unknown"]').all()) {
      await expect(row).toContainText('Unmapped');
      await expect(row).not.toContainText('Single country');
      await expect(row.locator('a')).toHaveCount(0);
    }
    // Partly unmapped rows keep their known suppliers and grey out the missing tier.
    for (const row of await page.locator('.row:has(.badge-partly)').all()) {
      await expect(row.getByTestId('unmapped-card').first()).toBeVisible();
      await expect(row).not.toHaveAttribute('data-state', 'unknown');
      await expect(row.locator('a.source-link').first()).toBeVisible();
    }
    // Every red row names its country in text, not only in colour.
    for (const row of await page.locator('[data-state="red"]').all()) {
      await expect(row).toContainText('Single country:');
    }
    // The brief's "done when": every component shows a cited source or a grey Unmapped marker.
    for (const row of await rows(page).all()) {
      const sources = await row.locator('a.source-link').count();
      const unmapped = await row.getByTestId('unmapped-card').count()
        + (await row.locator('.badge-unmapped, .badge-not-researched').count());
      expect(sources + unmapped, `${where}: a row has neither a source nor an unmapped marker`).toBeGreaterThan(0);
    }
    // Every source link is a real http(s) link that opens in a new tab.
    for (const link of await page.locator('a.source-link').all()) {
      await expect(link).toHaveAttribute('href', /^https?:\/\//);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
    }
    // Low-confidence rows are labelled and still show their source.
    for (const row of await page.locator('.row:has(.badge-low)').all()) {
      await expect(row.locator('a.source-link').first()).toBeVisible();
    }
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

test('drill-down: a component opens its chain, with a source or an unmapped marker at each tier', async ({ page }) => {
  const problems = watchForBreakage(page);
  await openAndListModels(page);
  await expect(rows(page).first()).toBeVisible();

  const mapped = page.locator('.row:not([data-state="unknown"])').first();
  test.skip((await mapped.count()) === 0, 'No mapped component in this dataset');
  await mapped.getByRole('button').first().click();
  const chain = page.getByTestId('chain');
  await expect(chain).toBeVisible();
  await expect(chain.locator('h4').first()).toContainText('Tier 1');
  for (const tier of await chain.locator('ol.tiers > li').all()) {
    // A card can merge several sources for the same claim, so check each card rather than counting links.
    for (const card of await tier.locator('.card').all()) {
      const marked = await card.locator('a.source-link, .source-missing').count() + (await card.getAttribute('data-testid') === 'unmapped-card' ? 1 : 0);
      expect(marked, 'every card has a source link or is an explicit unmapped card').toBeGreaterThan(0);
    }
  }

  await chain.getByRole('button', { name: 'Close' }).click();
  await expect(chain).toBeHidden();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('cut-off: affected rows match the result, and unknown is never shown as unaffected', async ({ page }) => {
  const problems = watchForBreakage(page);
  await openAndListModels(page);
  await expect(rows(page).first()).toBeVisible();

  await page.getByLabel(/What if .* is cut off/).check();
  await expect(page.getByTestId('cutoff-result')).toBeVisible();
  const model = await page.getByLabel('Drone model').inputValue();
  const text = (await page.getByTestId('cutoff-result').textContent()) ?? '';
  const line = text.match(new RegExp(`${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: (\\d+) components? affected`));
  expect(await page.locator('.row-cutoff').count()).toBe(line ? Number(line[1]) : 0);

  // Not researched components cannot be assessed, so a cut-off marks them unknown, never unaffected.
  for (const row of await page.locator('[data-state="not_researched"]').all()) {
    await expect(row).toContainText('Unknown if affected');
    await expect(row).not.toHaveClass(/row-cutoff/);
  }
  // A row that is "unknown if affected" must not also be marked affected.
  for (const row of await page.locator('.row:has(.badge-cutoff-unknown)').all()) {
    await expect(row).not.toHaveClass(/row-cutoff/);
  }
  await page.getByLabel(/What if .* is cut off/).uncheck();
  await expect(page.locator('.row-cutoff')).toHaveCount(0);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('ask: shows a loading state, and the no-data answer is a normal answer, not an error', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = watchForBreakage(page);
  await page.goto('/');
  await page.getByLabel('Ask about the map').fill('What is the weather in Paris today?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByTestId('ask-loading')).toBeVisible();

  const answer = page.getByTestId('answer');
  await expect(answer).toBeVisible({ timeout: 45_000 });
  await expect(answer).toHaveAttribute('data-refused', 'true');
  await expect(answer).toContainText('No mapped data to answer that.');
  await expect(answer.locator('a')).toHaveCount(0);
  await expect(page.getByTestId('ask-error')).toHaveCount(0);
  await expect(page.getByTestId('ask-loading')).toBeHidden();
  expect(problems, problems.join('\n')).toEqual([]);
});
