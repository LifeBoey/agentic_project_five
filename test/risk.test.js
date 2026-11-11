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
  assert.deepEqual(getChain(links, 'Falcon X', 'camera sensor'), { model: 'Falcon X', component: 'camera sensor', status: 'unknown', tiers: [] });
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
