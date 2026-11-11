import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getChain, getModelRisk, getModels, parseLinks } from '../../../src/risk.js';
import type { Chain, ModelRisk } from '../api';
import { buildRows } from './rows';
import { adjacency, buildGraph, componentId, countryId, modelId, supplierId, type Graph } from './graph';

// Role 2's real engine over fixture data, so the graph is built from real response shapes.
const links = parseLinks(JSON.parse(readFileSync(new URL('../../tests/fixtures/links.json', import.meta.url), 'utf8')));
const dataset = (getModels(links) as string[]).map(model => {
  const risk = getModelRisk(links, model) as ModelRisk;
  const chains = risk.components.map(c => getChain(links, model, c) as Chain);
  return { model, risk, chains, rows: buildRows(risk, chains) };
});
const graph: Graph = buildGraph(dataset);
const node = (id: string) => graph.nodes.find(n => n.id === id)!;
const edge = (kind: string, source: string, target: string) => graph.links.find(l => l.kind === kind && l.source === source && l.target === target);

describe('buildGraph', () => {
  it('has a hub per model and a component node for every row, including not researched ones', () => {
    expect(graph.nodes.filter(n => n.type === 'model').map(n => n.label)).toEqual(['Falcon X', 'Hawk 2']);
    // 5 expected components per model; Hawk 2 has none for battery cells and camera sensor.
    expect(graph.nodes.filter(n => n.type === 'component')).toHaveLength(10);
    expect(node(componentId('Hawk 2', 'camera sensor')).status).toBe('not_researched');
    expect(graph.links.filter(l => l.source === componentId('Hawk 2', 'camera sensor') || l.target === componentId('Hawk 2', 'camera sensor')).map(l => l.kind)).toEqual(['has']);
  });

  it('joins models through a shared supplier', () => {
    const ndmag = node(supplierId('NdMag Ltd'));
    expect(ndmag.models).toEqual(['Falcon X', 'Hawk 2']);
    expect(ndmag.sources.map(s => s.model)).toEqual(['Falcon X', 'Hawk 2']);
    expect(graph.nodes.filter(n => n.label === 'NdMag Ltd')).toHaveLength(1);
  });

  it('chains tiers: tier 2 supplies tier 1, tier 1 supplies the component', () => {
    expect(edge('supplies', supplierId('NdMag Ltd'), supplierId('AeroMotor Inc'))).toBeDefined();
    expect(edge('supplies', supplierId('AeroMotor Inc'), componentId('Falcon X', 'motors'))).toBeDefined();
    expect(edge('has', modelId('Falcon X'), componentId('Falcon X', 'motors'))).toBeDefined();
  });

  it('marks the path to a single-country verdict as risk, and nothing else', () => {
    expect(node(supplierId('NdMag Ltd')).status).toBe('risk');
    expect(node(countryId('CN')).status).toBe('risk');
    expect(edge('in', supplierId('NdMag Ltd'), countryId('CN'))!.risk).toBe(true);
    expect(edge('has', modelId('Falcon X'), componentId('Falcon X', 'motors'))!.risk).toBe(true);
    // The tier 1 supplier is not the verdict supplier, and diversified components stay quiet.
    expect(node(supplierId('AeroMotor Inc')).status).toBe('ok');
    expect(node(componentId('Falcon X', 'battery cells')).status).toBe('ok');
    expect(edge('has', modelId('Falcon X'), componentId('Falcon X', 'battery cells'))!.risk).toBe(false);
  });

  it('shows an unmapped tier as its own node, never as a supplier', () => {
    const gap = node('unmapped:Falcon X/radio/2');
    expect(gap).toMatchObject({ type: 'unmapped', status: 'unknown', label: 'Antenna?', tier: 2 });
    expect(edge('supplies', gap.id, supplierId('RadioWorks'))!.unmapped).toBe(true);
    const camera = node('unmapped:Falcon X/camera sensor/1');
    expect(edge('supplies', camera.id, componentId('Falcon X', 'camera sensor'))).toBeDefined();
    expect(node(componentId('Falcon X', 'camera sensor')).status).toBe('unknown');
  });

  it('puts suppliers in countries and sizes a country by what depends on it', () => {
    expect(edge('in', supplierId('ChipFab'), countryId('TW'))).toBeDefined();
    expect(node(countryId('CN')).degree).toBeGreaterThan(node(countryId('DE')).degree);
    expect(node(countryId('CN')).models).toEqual(['Falcon X', 'Hawk 2']);
  });

  it('carries confidence and conflict onto suppliers', () => {
    expect(node(supplierId('LiPower')).flags).toMatchObject({ lowConfidence: true, conflict: true });
    expect(node(supplierId('CellCorp')).flags).toMatchObject({ lowConfidence: false, conflict: true });
  });

  it('has no dangling links', () => {
    const ids = new Set(graph.nodes.map(n => n.id));
    for (const l of graph.links) {
      expect(ids.has(l.source), l.id).toBe(true);
      expect(ids.has(l.target), l.id).toBe(true);
    }
  });
});

describe('adjacency', () => {
  const adj = adjacency(graph);

  it('lists a node\'s neighbours', () => {
    // NdMag supplies AeroMotor's motors in both models and sits in China, and nothing else.
    expect([...adj.nodesOf.get(supplierId('NdMag Ltd'))!].sort()).toEqual([countryId('CN'), supplierId('AeroMotor Inc')].sort());
  });

  it('lists the links touching a node, one per neighbour here', () => {
    expect(adj.linksOf.get(supplierId('NdMag Ltd'))!.size).toBe(2);
    expect(adj.linksOf.get(countryId('CN'))!.size).toBe(adj.nodesOf.get(countryId('CN'))!.size);
  });
});
