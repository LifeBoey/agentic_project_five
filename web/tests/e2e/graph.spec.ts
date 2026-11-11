// The graph view. The first group holds for any dataset and runs on real data too; the second pins the fixture.
import { expect, test, type Page } from '@playwright/test';
import { fixtureGraph, goHome, REAL, rows, stubApi, watchForBreakage } from './helpers';

test.beforeEach(async ({ page }) => {
  if (!REAL) await stubApi(page);
});

const find = (page: Page) => page.getByLabel('Find in the graph');
const stage = (page: Page) => page.locator('.stage');
const detail = (page: Page) => page.getByTestId('node-detail');
const result = (page: Page, text: string | RegExp) => page.getByRole('list', { name: 'Matches' }).getByRole('button').filter({ hasText: text });

/** How many pixels the 2D canvas has drawn on: zero means the view is blank. */
const painted = (page: Page) => page.locator('.stage canvas').first().evaluate((c: HTMLCanvasElement) => {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
});

async function openGraph(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('Drone model')).toBeVisible();
  await expect(page.locator('.stage canvas').first()).toBeVisible();
}

test('opens on the graph, and the canvas has actually been drawn', async ({ page }) => {
  const problems = watchForBreakage(page);
  await openGraph(page);
  await expect(page.getByRole('tab', { name: 'Graph' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => painted(page), { timeout: 10_000 }).toBeGreaterThan(2000);
  await expect(stage(page)).toHaveAttribute('aria-label', /Supply network graph with \d+ nodes and \d+ links/);
  await expect(page.getByRole('region', { name: 'Legend' })).toContainText('On the path to a single-country dependency');
  await expect(page.getByTestId('node-detail-empty')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('search finds a drone and opens it', async ({ page }) => {
  await openGraph(page);
  const model = await page.getByLabel('Drone model').inputValue();
  await find(page).fill(model.slice(0, 4));
  await result(page, 'Drone model').first().click();
  await expect(detail(page)).toContainText(model);
  await expect(detail(page)).toContainText('depend on a single country');
  await expect(find(page)).toHaveValue('');
});

test('clicking a node on the canvas opens it', async ({ page }) => {
  await openGraph(page);
  const model = await page.getByLabel('Drone model').inputValue();
  // The graph sits below the summary, so bring it into view: a click outside the viewport hits nothing.
  await stage(page).scrollIntoViewIfNeeded();
  const posOf = () => page.evaluate((id: string) => (window as unknown as { __graph: { screenPos(id: string): { x: number; y: number } | null } }).__graph.screenPos(id), `model:${model}`);
  // Wait for the layout to stop easing into frame: the node must hold still across two readings.
  await expect(async () => {
    const a = await posOf();
    await page.waitForTimeout(250);
    const b = await posOf();
    expect(a).not.toBeNull();
    expect(Math.hypot(b!.x - a!.x, b!.y - a!.y)).toBeLessThan(1);
  }).toPass({ timeout: 20_000 });
  // Then aim again until the click lands.
  await expect(async () => {
    const pos = await posOf();
    expect(pos).not.toBeNull();
    // The canvas finds the node under the pointer once per frame, so hover first, as a person does.
    await page.mouse.move(pos!.x, pos!.y);
    await page.waitForTimeout(120);
    await page.mouse.click(pos!.x, pos!.y);
    await expect(detail(page)).toContainText(model, { timeout: 800 });
  }).toPass({ timeout: 15_000 });
});

test('a component opens the same chain as the list, sources included', async ({ page }) => {
  await goHome(page);
  const name = (await rows(page).first().getAttribute('data-testid'))!.replace('row-', '');
  await page.getByRole('tab', { name: 'Graph' }).click();
  await find(page).fill(name);
  await result(page, 'Component').first().click();
  const chain = page.getByTestId('chain');
  await expect(chain).toBeVisible();
  await expect(chain.locator('h4').first()).toContainText('Tier 1');
  await expect(chain.locator('a.source-link, [data-testid="unmapped-card"]').first()).toBeVisible();
});

test('a search with no match says so', async ({ page }) => {
  await openGraph(page);
  await find(page).fill('zzzz-not-a-thing');
  await expect(page.getByRole('status').filter({ hasText: 'Nothing in the graph matches' })).toBeVisible();
});

test('zoom and fit controls keep the graph on screen', async ({ page }) => {
  const problems = watchForBreakage(page);
  await openGraph(page);
  await expect.poll(() => painted(page), { timeout: 10_000 }).toBeGreaterThan(2000);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Fit' }).click();
  await expect.poll(() => painted(page)).toBeGreaterThan(2000);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('switches to 3D and back without errors', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = watchForBreakage(page);
  await openGraph(page);
  await page.getByRole('button', { name: '3D' }).click();
  await expect(page.getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Loading the 3D view…')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('.stage canvas').first()).toBeVisible();
  await expect(page.getByText(/Drag to orbit/)).toBeVisible();
  await page.waitForTimeout(1500); // let the scene build and render a few frames
  await page.getByRole('button', { name: '2D' }).click();
  await expect.poll(() => painted(page), { timeout: 10_000 }).toBeGreaterThan(2000);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('the tabs work from the keyboard', async ({ page }) => {
  await openGraph(page);
  await page.getByRole('tab', { name: 'Graph' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Chains and list' })).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page).first()).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Graph' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.stage canvas').first()).toBeVisible();
});

test('turning on a cut-off keeps the graph drawn', async ({ page }) => {
  const problems = watchForBreakage(page);
  await openGraph(page);
  await page.getByLabel(/What if .* is cut off/).check();
  await expect(page.getByTestId('cutoff-result')).toBeVisible();
  await expect.poll(() => painted(page)).toBeGreaterThan(2000);
  expect(problems, problems.join('\n')).toEqual([]);
});

test.describe('fixture data', () => {
  test.skip(REAL, 'Fixture-specific: runs only against the fixture data');

  test('the stage describes the graph the page built', async ({ page }) => {
    await openGraph(page);
    const g = fixtureGraph();
    await expect(stage(page)).toHaveAttribute('aria-label', new RegExp(`graph with ${g.nodes.length} nodes and ${g.links.length} links`));
  });

  test('a shared supplier shows every model it serves, with its sources', async ({ page }) => {
    await openGraph(page);
    await find(page).fill('NdMag');
    await result(page, 'Supplier').first().click();
    await expect(detail(page)).toContainText('Shared by 2 models');
    await expect(detail(page)).toContainText('Motors of Falcon X, tier 2 · Magnets');
    await expect(detail(page)).toContainText('Motors of Hawk 2, tier 2 (low confidence)');
    await expect(detail(page).getByRole('link', { name: /Source/ }).first()).toHaveAttribute('href', 'https://example.com/fixture/ndmag-falcon');
  });

  test('a country lists what depends on it, offers the cut-off, and goes away when countries are hidden', async ({ page }) => {
    await openGraph(page);
    await find(page).fill('China');
    await result(page, 'Country').first().click();
    await expect(detail(page)).toContainText('Every deepest-tier supplier of these is in China');
    await expect(detail(page)).toContainText('Motors of Falcon X');
    await expect(detail(page)).toContainText('Motors of Hawk 2');

    await detail(page).getByRole('button', { name: 'What if China is cut off?' }).click();
    await expect(page.getByLabel('What if China is cut off?')).toBeChecked();
    await expect(page.getByTestId('cutoff-result')).toContainText('Falcon X: 2 components affected');

    await page.getByRole('button', { name: 'Countries' }).click();
    await expect(page.getByRole('button', { name: 'Countries' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('node-detail-empty')).toBeVisible();
  });

  test('an unmapped tier opens as a gap, never a supplier', async ({ page }) => {
    await openGraph(page);
    await find(page).fill('Antenna');
    await result(page, 'Unmapped tier').first().click();
    await expect(detail(page)).toContainText('No reliable source found for antenna at tier 2 of Radio in Falcon X');
    await expect(detail(page)).toContainText('a gap, not a safe result');
    await expect(detail(page).locator('a')).toHaveCount(0);
  });

  test('a component with no record opens as not researched', async ({ page }) => {
    await openGraph(page);
    await find(page).fill('camera sensor');
    await result(page, 'Hawk 2').first().click();
    await expect(page.getByTestId('chain')).toContainText('Not researched: no record for this component yet');
  });

  test('a model has a hub, and searching components finds one per model', async ({ page }) => {
    await openGraph(page);
    await find(page).fill('motors');
    await expect(result(page, 'Component')).toHaveCount(2);
  });
});
