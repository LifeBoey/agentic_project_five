// Exact assertions against the fixture data (tests/fixtures/links.json), answered by Role 2's real engine.
// They only run in the default mode, since real data changes with every drop.
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { FALCON, HAWK, REAL, goHome, record, riskOf, rows, stubApi, watchForBreakage } from './helpers';

test.skip(REAL, 'Fixture-specific: runs only against the fixture data');

test.beforeEach(async ({ page }) => {
  await stubApi(page);
  await goHome(page);
  await expect(rows(page).first()).toBeVisible();
});

const row = (page: Page, name: string) => page.getByTestId(`row-${name}`);

test('first two minutes: pick, see red, follow a chain to the country and the source', async ({ page }) => {
  const problems = watchForBreakage(page);
  await expect(page.getByTestId('headline')).toHaveText('2 components depend on a single country');
  await expect(page.getByTestId('count-unknown')).toContainText('2 unmapped or partly unmapped');
  await expect(page.getByTestId('count-total')).toContainText('5 components in total');
  await expect(page.getByTestId('count-not-researched')).toContainText('0 not researched');

  await row(page, 'motors').getByRole('button', { name: 'Motors' }).click();
  const chain = page.getByTestId('chain');
  await expect(chain.locator('h4')).toHaveText(['Tier 1', 'Tier 2']);
  await expect(chain).toContainText('NdMag Ltd');
  await expect(chain).toContainText('Chain ends in: China');
  await expect(chain.getByRole('link', { name: /NdMag|Source/ }).last()).toHaveAttribute('href', 'https://example.com/fixture/ndmag-falcon');
  expect(problems).toEqual([]);
});

test('red rows show the supplier behind the verdict with its source', async ({ page }) => {
  const motors = row(page, 'motors');
  await expect(motors).toHaveAttribute('data-state', 'red');
  await expect(motors).toContainText('Single country: China');
  await expect(motors.locator('.card')).toHaveCount(1);
  await expect(motors.locator('.card')).toContainText('NdMag Ltd');
  // A sub-tier supplier is labelled as such, so it is not read as the motor maker.
  await expect(motors.locator('.card')).toContainText('Tier 2 · Magnets');
  await expect(motors.getByRole('link', { name: /Source/ })).toHaveAttribute('href', 'https://example.com/fixture/ndmag-falcon');
});

test('fully unmapped is grey, counted, has no source and is never safe', async ({ page }) => {
  const camera = row(page, 'camera sensor');
  await expect(camera).toHaveAttribute('data-state', 'unknown');
  await expect(camera).toContainText('Unmapped: no reliable source found. Ask the vendor.');
  await expect(camera.locator('a')).toHaveCount(0);
  await expect(camera).toHaveCSS('background-color', 'rgb(239, 239, 239)');
});

test('partly unmapped keeps the known tier and greys out the missing one', async ({ page }) => {
  const radio = row(page, 'radio');
  await expect(radio).toContainText('Partly unmapped');
  await expect(radio).toContainText('RadioWorks');
  await expect(radio.getByRole('link', { name: /Source/ })).toHaveAttribute('href', 'https://example.com/fixture/radioworks-falcon');
  await expect(radio.getByTestId('unmapped-card')).toContainText('Tier 2 · Antenna: unmapped');

  await radio.getByRole('button', { name: 'Radio' }).click();
  const chain = page.getByTestId('chain');
  await expect(chain.locator('h4')).toHaveText(['Tier 1', 'Tier 2']);
  await expect(chain.getByTestId('unmapped-card')).toContainText('No reliable source found');
  await expect(chain).toContainText('Tier 2 is unmapped, so it may continue');
});

test('conflicting sources sit side by side, the weak one labelled', async ({ page }) => {
  const cells = row(page, 'battery cells');
  await expect(cells).toContainText('Sources disagree');
  await expect(cells).toHaveAttribute('data-state', 'ok');
  await expect(cells.locator('.card')).toHaveCount(2);
  await expect(cells.locator('.card').nth(0)).toContainText('CellCorp');
  await expect(cells.locator('.card').nth(1)).toContainText('LiPower');
  await expect(cells.locator('.card').nth(1)).toContainText('Low confidence');
  await expect(cells.locator('.card').nth(0)).not.toContainText('Low confidence');
});

test('a component nothing flags is still listed with its suppliers', async ({ page }) => {
  const chip = row(page, 'flight controller chip');
  await expect(chip).toHaveAttribute('data-state', 'ok');
  await expect(chip.locator('.card')).toHaveCount(2);
  await expect(chip.locator('.badge')).toHaveCount(0);
});

test('shared suppliers are listed', async ({ page }) => {
  await expect(page.getByTestId('chokepoints')).toContainText('NdMag Ltd (also Hawk 2)');
});

test('cut-off shows affected, fully blocked and unknown separately', async ({ page }) => {
  await page.getByLabel('What if China is cut off?').check();
  const result = page.getByTestId('cutoff-result');
  await expect(result).toContainText(`${FALCON}: 2 components affected, 1 fully blocked`);
  await expect(result).toContainText(`${HAWK}: 1 component affected, 1 fully blocked`);

  // Unknown is its own list, never "unaffected".
  const unknown = page.getByTestId('cutoff-unknown');
  await expect(unknown).toContainText('not counted as unaffected');
  await expect(unknown).toContainText(`${FALCON}: Camera sensor`);
  await expect(unknown).toContainText(`${FALCON}: Radio`);

  await expect(page.locator('.row-cutoff')).toHaveCount(2);
  await expect(row(page, 'motors')).toContainText('Fully blocked');
  await expect(row(page, 'battery cells')).toContainText('Affected by cut-off');
  await expect(row(page, 'battery cells')).not.toContainText('Fully blocked');
  await expect(row(page, 'camera sensor')).toContainText('Unknown if affected');
  await expect(row(page, 'camera sensor')).not.toHaveClass(/row-cutoff/);
  await expect(row(page, 'radio')).toContainText('Unknown if affected');

  // A country nothing maps to still reports the unknowns.
  await page.getByLabel('Cut-off country').selectOption('JP');
  await expect(result).toContainText('No mapped component depends on Japan.');
  await expect(page.getByTestId('cutoff-unknown')).toContainText(`${FALCON}: Camera sensor`);
});

test('switching model resets the drill-down and updates the summary', async ({ page }) => {
  await row(page, 'motors').getByRole('button', { name: 'Motors' }).click();
  await expect(page.getByTestId('chain')).toBeVisible();
  await page.getByLabel('Drone model').selectOption({ label: HAWK });
  await expect(page.getByTestId('chain')).toBeHidden();
  await expect(page.getByTestId('headline')).toHaveText('3 components depend on a single country');
  await expect(row(page, 'motors')).toContainText('Low confidence');
  await expect(row(page, 'motors')).toHaveAttribute('data-state', 'red');
});

test.describe('expected components with no record (Hawk 2 has none for battery cells and camera sensor)', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByLabel('Drone model').selectOption({ label: HAWK });
    await expect(page.getByTestId('headline')).toHaveText('3 components depend on a single country');
  });

  test('are shown grey as not researched instead of disappearing', async ({ page }) => {
    for (const name of ['battery cells', 'camera sensor']) {
      const r = row(page, name);
      await expect(r).toHaveAttribute('data-state', 'not_researched');
      await expect(r).toContainText('Not researched: no record for this component yet');
      await expect(r.locator('a')).toHaveCount(0);
      await expect(r).toHaveCSS('background-color', 'rgb(239, 239, 239)');
    }
    await expect(rows(page)).toHaveCount(5);
    await expect(page.getByTestId('count-not-researched')).toContainText('2 not researched');
    await expect(page.getByTestId('count-total')).toContainText('5 components in total');
    // The API's own count of unmapped components is untouched: these are not unmapped records.
    await expect(page.getByTestId('count-unknown')).toContainText('0 unmapped or partly unmapped');
  });

  test('open a drawer that says so, with no chain', async ({ page }) => {
    await row(page, 'camera sensor').getByRole('button', { name: 'Camera sensor' }).click();
    const chain = page.getByTestId('chain');
    await expect(chain).toContainText('Not researched: no record for this component yet');
    await expect(chain.locator('h4')).toHaveCount(0);
  });

  test('are unknown in a cut-off, never unaffected', async ({ page }) => {
    await page.getByLabel('What if China is cut off?').check();
    await expect(row(page, 'battery cells')).toContainText('Unknown if affected');
    await expect(row(page, 'battery cells')).not.toHaveClass(/row-cutoff/);
    const unknown = page.getByTestId('cutoff-unknown');
    await expect(unknown).toContainText(`${HAWK}: Battery cells (not researched)`);
    await expect(unknown).toContainText(`${HAWK}: Camera sensor (not researched)`);
  });
});

test.describe('ask', () => {
  const ask = async (page: Page, q: string) => {
    await page.getByLabel('Ask about the map').fill(q);
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
  };

  test('shows the answer and links the records it cites', async ({ page }) => {
    await page.route(u => u.pathname === '/api/ask', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ answer: 'Falcon X depends only on China for magnets.', links: [record(1), record(4)] }),
    }));
    await ask(page, 'Which models depend only on China for magnets?');
    const answer = page.getByTestId('answer');
    await expect(answer).toContainText('Falcon X depends only on China for magnets.');
    await expect(answer).toHaveAttribute('data-refused', 'false');
    await expect(answer.getByRole('link', { name: 'NdMag Ltd (CN)' })).toHaveAttribute('href', 'https://example.com/fixture/ndmag-falcon');
    // An unmapped record can be cited, and is shown as a gap rather than a link.
    await expect(answer).toContainText('unmapped (searched, nothing found)');
  });

  test('the no-data answer is not an error', async ({ page }) => {
    await ask(page, 'What is the weather in Paris?');
    await expect(page.getByTestId('ask-loading')).toBeVisible();
    await expect(page.getByTestId('answer')).toHaveText('No mapped data to answer that.');
    await expect(page.getByTestId('answer')).toHaveAttribute('data-refused', 'true');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('503 says the question box is not set up', async ({ page }) => {
    await page.route(u => u.pathname === '/api/ask', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"query agent not configured"}' }));
    await ask(page, 'anything');
    await expect(page.getByTestId('ask-error')).toContainText('not set up on this server');
  });

  test('502 says the agent failed', async ({ page }) => {
    await page.route(u => u.pathname === '/api/ask', route => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"query agent failed"}' }));
    await ask(page, 'anything');
    await expect(page.getByTestId('ask-error')).toContainText('query agent failed');
  });
});

test('an API failure shows an error with a retry', async ({ page }) => {
  let broken = true;
  await page.route(u => u.pathname === '/api/models', route => (broken
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"links.json rejected: record 3: tier must be a whole number from 1"}' })
    : route.fallback()));
  await page.reload();
  await expect(page.getByRole('alert').first()).toContainText('links.json rejected');
  broken = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByLabel('Drone model')).toBeVisible();
});

test('a risk response without the components list is reported, not silently shortened', async ({ page }) => {
  await page.route(u => u.pathname.endsWith('/risk'), route => {
    const { components: _dropped, ...withoutList } = riskOf(FALCON)!;
    return route.fulfill({ json: withoutList });
  });
  await page.reload();
  await expect(page.getByRole('alert').first()).toContainText('no "components" list');
  await expect(rows(page)).toHaveCount(0);
});

test('a missing brief says so instead of showing nothing', async ({ page }) => {
  // Whatever briefs have been generated locally, this model has none.
  await page.route('**/briefs/*.md', route => route.fulfill({ status: 404, body: 'not found' }));
  await page.reload();
  await expect(page.getByLabel('Risk brief')).toContainText('No brief has been drafted for this model yet.');
});

test('a brief is shown and can be downloaded', async ({ page }) => {
  const text = 'Stub brief for the export test.';
  await page.route('**/briefs/falcon-x.md', route => route.fulfill({ contentType: 'text/markdown', body: text }));
  await page.reload();
  await expect(page.getByTestId('brief-text')).toHaveText(text);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download .md' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('falcon-x-risk-brief.md');
  expect(await readFile(await download.path(), 'utf8')).toBe(`# ${FALCON}: risk brief\n\n${text}\n`);
});
