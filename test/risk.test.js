import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLinks, parseLinks, getModels, getModelRisk, getChain, simulateCutoff } from '../src/risk.js';

const links = await loadLinks(new URL('./fixtures/links.json', import.meta.url));

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
const withIds = parseLinks; // same validation and id rule as the server

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
  assert.deepEqual(key(r.unknown), ['Falcon X/camera sensor', 'Hawk 2/radio']);
  assert.deepEqual(r.models_affected, ['Falcon X', 'Hawk 2']);
});

test('cut-off of an unused country affects nothing but still reports unknowns', () => {
  const r = simulateCutoff(links, 'DE');
  assert.equal(r.affected.length, 0);
  assert.equal(r.unknown.length, 2);
});

test('an unmapped tier below the deepest mapped tier flags the component unknown', () => {
  const radio = getModelRisk(links, 'Hawk 2').flagged.find(f => f.component === 'radio');
  // Tier-1 facts stay, but the unknown tier 2 means it must not read as safe.
  assert.deepEqual(radio.reasons, ['single_country', 'single_source', 'unknown']);
  assert.deepEqual(radio.link_ids, [8, 9]);
  assert.equal(getModelRisk(links, 'Hawk 2').counts.unknown, 1);
  const chain = getChain(links, 'Hawk 2', 'radio');
  assert.equal(chain.status, 'mapped');
  assert.deepEqual(chain.tiers.map(t => t.links.map(l => l.confidence)), [['high'], ['unmapped']]);
});

test('cut-off: a partly unknown component is unknown unless a mapped link is hit', () => {
  const us = simulateCutoff(links, 'US');
  assert.ok(us.affected.some(x => x.component === 'radio'));
  assert.ok(!us.unknown.some(x => x.component === 'radio'));
  const cn = simulateCutoff(links, 'CN').unknown.find(x => x.component === 'radio');
  assert.deepEqual(cn.link_ids, [8, 9]);
});

test('an unmapped tier above the deepest mapped tier does not flag unknown', () => {
  const data = withIds([
    L({ tier: 1, confidence: 'unmapped', supplier: '', supplier_country: '' }),
    L({ tier: 2, supplier: 'A', supplier_country: 'CN' }),
  ]);
  assert.ok(!getModelRisk(data, 'M').flagged[0].reasons.includes('unknown'));
});

test('bad records are rejected with their record number and reason', () => {
  assert.throws(() => parseLinks({}), /must be an array/);
  assert.throws(() => parseLinks([L({ tier: 0 })]), /record 0 \(M \/ c\): tier must be a whole number/);
  assert.throws(() => parseLinks([L(), L({ confidence: 'medium' })]), /record 1 .*confidence must be one of high, low, unmapped/);
  assert.throws(() => parseLinks([L({ conflict: 'no' })]), /conflict must be true or false/);
  assert.throws(() => parseLinks([L({ model: ' ' })]), /model must be a non-empty string/);
  const { supplier, ...noSupplier } = L();
  assert.throws(() => parseLinks([noSupplier]), /supplier must be a string/);
  assert.throws(() => parseLinks([null]), /record 0: must be an object/);
});

test('a mapped link needs a supplier and an http(s) source; an unmapped one does not', () => {
  assert.throws(() => parseLinks([L({ supplier: '' })]), /a mapped link needs a supplier/);
  assert.throws(() => parseLinks([L({ confidence: 'low', source_url: '' })]), /needs an http\(s\) source_url/);
  assert.doesNotThrow(() => parseLinks([L({ confidence: 'unmapped', supplier: '', supplier_country: '', source_url: '' })]));
});

test('the error lists at most 10 problems and counts the rest', () => {
  const bad = Array.from({ length: 12 }, () => L({ tier: 0 }));
  assert.throws(() => parseLinks(bad), /\(and 2 more\)$/);
});

test("Role 1's optional part label passes through the chain", () => {
  const data = withIds([L({ tier: 1 }), L({ tier: 2, part: 'Magnets', supplier: 'B' })]);
  const tiers = getChain(data, 'M', 'c').tiers;
  assert.equal(tiers[1].links[0].part, 'Magnets');
  assert.ok(!('part' in JSON.parse(JSON.stringify(tiers[0].links[0]))));
});

test('the real data/links.json passes validation', async () => {
  const real = await loadLinks();
  assert.ok(getModels(real).length > 0);
});
