import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../lib/graph';
import { markOf, type GraphMarks } from './types';

const node = (over: Partial<GraphNode>): GraphNode => ({
  id: 'x', type: 'supplier', label: 'x', status: 'ok', models: [], degree: 1,
  flags: { lowConfidence: false, conflict: false, partlyUnmapped: false, singleSource: false }, sources: [], ...over,
});
const marks: GraphMarks = {
  country: 'CN',
  affected: new Set(['component:A/motors']),
  unknown: new Set(['component:A/radio']),
};

describe('markOf (what a country cut-off does to a node)', () => {
  it('rings a component that depends on the country, and one that cannot be told', () => {
    expect(markOf(node({ id: 'component:A/motors', type: 'component' }), marks)).toBe('affected');
    expect(markOf(node({ id: 'component:A/radio', type: 'component' }), marks)).toBe('unknown');
    expect(markOf(node({ id: 'component:A/chip', type: 'component' }), marks)).toBeNull();
  });

  it('rings suppliers and the country itself when they are in that country', () => {
    expect(markOf(node({ type: 'supplier', country: 'CN' }), marks)).toBe('affected');
    expect(markOf(node({ type: 'country', country: 'CN' }), marks)).toBe('affected');
    expect(markOf(node({ type: 'supplier', country: 'JP' }), marks)).toBeNull();
    expect(markOf(node({ type: 'country', country: 'JP' }), marks)).toBeNull();
  });

  it('leaves hubs and gaps alone, and marks nothing when there is no cut-off', () => {
    expect(markOf(node({ type: 'model' }), marks)).toBeNull();
    expect(markOf(node({ type: 'unmapped' }), marks)).toBeNull();
    expect(markOf(node({ id: 'component:A/motors', type: 'component' }), null)).toBeNull();
  });
});
