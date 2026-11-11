import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLinks, getModels, getModelRisk, getChain, simulateCutoff } from '../src/risk.js';

const links = await loadLinks();

test('lists models in file order', () => {
  assert.deepEqual(getModels(links), ['Falcon X', 'Hawk 2']);
});

test('model risk: single-country, single-source, conflict, unknown', () => {
  const r = getModelRisk(links, 'Falcon X');
  assert.deepEqual(r.counts, { single_country: 1, single_source: 1, unknown: 1, low_confidence: 0, conflicts: 1 });
  const byComp = Object.fromEntries(r.flagged.map(f => [f.component, f]));
  // Motors are judged at the deepest tier (CN magnets), not the US tier-1 assembler.
  assert.deepEqual(byComp.motors.reasons, ['single_country', 'single_source']);
  assert.deepEqual(byComp.motors.countries, ['CN']);
  assert.deepEqual(byComp.motors.link_ids, [1]);
  assert.deepEqual(byComp['battery cells'].reasons, ['conflict']);
  assert.deepEqual(byComp['camera sensor'].reasons, ['unknown']);
});

test('low-confidence-only evidence is still flagged, and marked', () => {
  const motors = getModelRisk(links, 'Hawk 2').flagged.find(f => f.component === 'motors');
  assert.ok(motors.reasons.includes('single_country'));
  assert.equal(motors.low_confidence, true);
});

test('chokepoints are suppliers shared by 2+ models', () => {
  const sup = getModelRisk(links, 'Hawk 2').chokepoints.map(c => c.supplier).sort();
  assert.deepEqual(sup, ['AeroMotor Inc', 'NdMag Ltd']);
});

test('unknown model or component returns null', () => {
  assert.equal(getModelRisk(links, 'Nope'), null);
  assert.equal(getChain(links, 'Falcon X', 'nope'), null);
});

test('chain is ordered by tier with sources; unmapped shows as unknown', () => {
  const c = getChain(links, 'Falcon X', 'motors');
  assert.equal(c.status, 'mapped');
  assert.deepEqual(c.tiers.map(t => t.tier), [1, 2]);
  assert.equal(c.tiers[1].links[0].source_url, 'https://example.com/fake/ndmag-falcon');
  const unknown = getChain(links, 'Falcon X', 'camera sensor');
  assert.equal(unknown.status, 'unknown');
  // The unmapped record is shown, so the gap has a citable id.
  assert.deepEqual(unknown.tiers.map(t => t.links.map(l => [l.id, l.confidence])), [[[4, 'unmapped']]]);
});

test('single-source: one distinct supplier at the deepest tier', () => {
  const chip = getModelRisk(links, 'Hawk 2').flagged.find(f => f.component === 'flight controller chip');
  assert.deepEqual(chip.reasons, ['single_country', 'single_source']);
  assert.deepEqual(chip.countries, ['TW']);
  const battery = getModelRisk(links, 'Falcon X').flagged.find(f => f.component === 'battery cells');
  assert.ok(!battery.reasons.includes('single_source'));
});

test('unknown components carry their unmapped record ids', () => {
  const cam = getModelRisk(links, 'Falcon X').flagged.find(f => f.component === 'camera sensor');
  assert.deepEqual(cam.link_ids, [4]);
  assert.deepEqual(simulateCutoff(links, 'CN').unknown[0].link_ids, [4]);
});

// Small inline datasets for edge cases the shared fake data doesn't cover.
const L = (over) => ({ model: 'M', component: 'c', supplier: 'S', supplier_country: 'CN', tier: 1, source_url: 'https://x', confidence: 'high', conflict: false, ...over });
const withIds = arr => arr.map((l, id) => ({ id, ...l }));

test('conflict ignores unmapped records', () => {
  const data = withIds([
    L({ supplier: 'A', supplier_country: 'US' }),
    L({ supplier: 'B', supplier_country: 'KR' }),
    L({ tier: 2, confidence: 'unmapped', supplier: '', supplier_country: '', conflict: true }),
  ]);
  assert.ok(!getModelRisk(data, 'M').flagged.some(f => f.reasons.includes('conflict')));
  assert.equal(getModelRisk(data, 'M').counts.conflicts, 0);
});

test('low_confidence count only covers flagged components', () => {
  const data = withIds([
    L({ supplier: 'A', supplier_country: 'US', confidence: 'low' }),
    L({ supplier: 'B', supplier_country: 'KR', confidence: 'low' }),
  ]);
  const r = getModelRisk(data, 'M');
  assert.equal(r.flagged.length, 0);
  assert.equal(r.counts.low_confidence, 0);
});

test('supplier names match ignoring case and spacing', () => {
  const data = withIds([
    L({ model: 'A', supplier: 'NdMag Ltd' }),
    L({ model: 'A', supplier: ' ndmag ltd' }),
    L({ model: 'B', supplier: 'NDMAG LTD' }),
  ]);
  assert.ok(getModelRisk(data, 'A').flagged[0].reasons.includes('single_source'));
  assert.deepEqual(getModelRisk(data, 'A').chokepoints, [{ supplier: 'NdMag Ltd', models: ['A', 'B'] }]);
});

test('a mapped link with no country blocks a single-country claim', () => {
  const data = withIds([L({ supplier: 'A', supplier_country: 'CN' }), L({ supplier: 'B', supplier_country: '' })]);
  const f = getModelRisk(data, 'M').flagged;
  assert.ok(!f.some(x => x.reasons.includes('single_country')));
});

test('cut-off splits affected, fully blocked and unknown', () => {
  const r = simulateCutoff(links, 'cn');
  const key = xs => xs.map(x => `${x.model}/${x.component}`);
  assert.deepEqual(key(r.affected), ['Falcon X/motors', 'Falcon X/battery cells', 'Hawk 2/motors']);
  assert.deepEqual(key(r.fully_blocked), ['Falcon X/motors', 'Hawk 2/motors']);
  assert.deepEqual(key(r.unknown), ['Falcon X/camera sensor']);
  assert.deepEqual(r.models_affected, ['Falcon X', 'Hawk 2']);
});

test('cut-off of an unused country affects nothing but still reports unknowns', () => {
  const r = simulateCutoff(links, 'DE');
  assert.equal(r.affected.length, 0);
  assert.equal(r.unknown.length, 1);
});
