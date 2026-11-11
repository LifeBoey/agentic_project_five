import { readFileSync } from 'node:fs';
import { expect, type Page, type Route } from '@playwright/test';
// Role 2's real engine: the stub answers exactly as the server would for the fixture data.
import { getChain, getModelRisk, getModels, parseLinks, simulateCutoff } from '../../../src/risk.js';
import { NO_DATA_ANSWER } from '../../src/api/types';

export const REAL = process.env.E2E_API === 'real';
export const FALCON = 'Falcon X';
export const HAWK = 'Hawk 2';

const links = parseLinks(JSON.parse(readFileSync(new URL('../fixtures/links.json', import.meta.url), 'utf8')));

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Answers /api/* in the browser from the fixture data. Register later routes to override single endpoints. */
export async function stubApi(page: Page, { askDelayMs = 400 } = {}) {
  await page.route(u => u.pathname.startsWith('/api/'), async route => {
    const req = route.request();
    const parts = new URL(req.url()).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const [, resource, name, view, component] = parts;
    const found = (v: unknown) => (v == null ? json(route, { error: 'not found' }, 404) : json(route, v));

    if (req.method() === 'POST' && resource === 'ask') {
      await new Promise(r => setTimeout(r, askDelayMs));
      return json(route, { answer: NO_DATA_ANSWER, links: [] });
    }
    if (resource === 'models' && parts.length === 2) return json(route, getModels(links));
    if (resource === 'models' && view === 'risk') return found(getModelRisk(links, name));
    if (resource === 'models' && view === 'chain') return found(getChain(links, name, component));
    if (resource === 'cutoff') return json(route, simulateCutoff(links, name));
    return json(route, { error: 'not found' }, 404);
  });
}

/** What the real engine says for a fixture model, for tests that alter a response. */
export const riskOf = (model: string) => getModelRisk(links, model);

/** Fixture records by id, for building ask() answers. */
export const record = (id: number) => links[id];

/** Fails the test on any console error, page error or failed request. */
export function watchForBreakage(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', r => problems.push(`request failed: ${r.url()}`));
  page.on('response', r => {
    // A missing brief is a normal state, so a 404 for briefs/ is not breakage.
    if (r.status() >= 400 && !r.url().includes('/briefs/')) problems.push(`${r.status()}: ${r.url()}`);
  });
  return problems;
}

export async function openAndListModels(page: Page): Promise<string[]> {
  await page.goto('/');
  await expect(page.getByLabel('Drone model')).toBeVisible();
  return page.getByLabel('Drone model').locator('option').allTextContents();
}

export const rows = (page: Page) => page.locator('[data-testid^="row-"]');
