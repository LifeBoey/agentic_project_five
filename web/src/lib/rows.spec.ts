import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// Role 2's real engine over fixture data, so the view logic is tested against the real response shapes.
import { getChain, getModelRisk, parseLinks } from '../../../src/risk.js';
import type { Chain, ModelRisk } from '../api';
import { buildRows } from './rows';

const links = parseLinks(JSON.parse(readFileSync(new URL('../../tests/fixtures/links.json', import.meta.url), 'utf8')));

function rowsFor(model: string) {
  const risk = getModelRisk(links, model) as ModelRisk;
  const chains = risk.components.map(c => getChain(links, model, c) as Chain);
  return Object.fromEntries(buildRows(risk, chains).map(r => [r.name, r]));
}

describe('buildRows (Falcon X)', () => {
  const rows = rowsFor('Falcon X');

  it('lists every component, flagged or not', () => {
    expect(Object.keys(rows)).toEqual(['motors', 'battery cells', 'camera sensor', 'flight controller chip', 'radio']);
  });

  it('marks a deepest-tier single-country component red and shows the sub-tier supplier', () => {
    expect(rows['motors']).toMatchObject({ state: 'red', countries: ['CN'], singleSource: true, partlyUnknown: false });
    expect(rows['motors'].shown.map(l => l.supplier)).toEqual(['NdMag Ltd']);
  });

  it('shows a fully unmapped component as unknown, never red or ok', () => {
    expect(rows['camera sensor']).toMatchObject({ state: 'unknown', partlyUnknown: false, shown: [] });
  });

  it('keeps the known tiers of a partly unknown component and records the gap tier', () => {
    expect(rows['radio']).toMatchObject({ partlyUnknown: true, gaps: [{ tier: 2, part: 'Antenna' }] });
    expect(rows['radio'].shown.map(l => l.supplier)).toEqual(['RadioWorks']);
    expect(rows['radio'].state).not.toBe('unknown');
  });

  it('shows conflicting suppliers together', () => {
    expect(rows['battery cells']).toMatchObject({ state: 'ok', conflict: true });
    expect(rows['battery cells'].shown.map(l => l.supplier)).toEqual(['CellCorp', 'LiPower']);
  });

  it('shows an unflagged component with its suppliers', () => {
    expect(rows['flight controller chip']).toMatchObject({ state: 'ok', conflict: false, partlyUnknown: false });
    expect(rows['flight controller chip'].shown).toHaveLength(2);
  });
});

describe('buildRows (Hawk 2)', () => {
  it('carries the low-confidence flag on a single-country component', () => {
    expect(rowsFor('Hawk 2')['motors']).toMatchObject({ state: 'red', lowConfidence: true });
  });
});

describe('buildRows: expected components with no record', () => {
  const rows = rowsFor('Hawk 2');

  it('shows them as not researched, after the components the API lists', () => {
    expect(Object.keys(rows)).toEqual(['motors', 'flight controller chip', 'radio', 'battery cells', 'camera sensor']);
    expect(rows['battery cells']).toMatchObject({ state: 'not_researched', shown: [], gaps: [], conflict: false });
    expect(rows['camera sensor'].state).toBe('not_researched');
  });

  it('never makes them look mapped or red', () => {
    for (const name of ['battery cells', 'camera sensor']) {
      expect(rows[name].state).not.toBe('ok');
      expect(rows[name].state).not.toBe('red');
      expect(rows[name].chain.tiers).toEqual([]);
    }
  });

  it('adds nothing for a model that has every expected component', () => {
    expect(Object.values(rowsFor('Falcon X')).filter(r => r.state === 'not_researched')).toEqual([]);
  });

  it('matches names ignoring case and spacing', () => {
    const risk = { model: 'M', counts: {}, components: [' Motors '], flagged: [], chokepoints: [] } as unknown as ModelRisk;
    const chain: Chain = { model: 'M', component: ' Motors ', status: 'mapped', tiers: [{ tier: 1, links: [{ id: 0, supplier: 'A', supplier_country: 'US', source_url: 'https://e.com', confidence: 'high', conflict: false }] }] };
    const names = buildRows(risk, [chain]).filter(r => r.state === 'not_researched').map(r => r.name);
    expect(names).not.toContain('motors');
    expect(names).toHaveLength(4);
  });
});

describe('buildRows guards', () => {
  it('treats a chain that says mapped but holds nothing mapped as unknown', () => {
    const risk = { model: 'M', counts: {}, components: ['x'], flagged: [], chokepoints: [] } as unknown as ModelRisk;
    const chain: Chain = { model: 'M', component: 'x', status: 'mapped', tiers: [{ tier: 1, links: [] }] };
    expect(buildRows(risk, [chain])[0].state).toBe('unknown');
  });

  it('fails loudly when a component has no chain', () => {
    const risk = { model: 'M', counts: {}, components: ['x'], flagged: [], chokepoints: [] } as unknown as ModelRisk;
    expect(() => buildRows(risk, [])).toThrow(/no chain/);
  });
});
