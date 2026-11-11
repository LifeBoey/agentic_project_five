import type { GraphLink, GraphNode } from './graph';

// One place for how the graph looks, shared by the 2D canvas and the 3D scene.
// Red means one thing only: the path to a single-country verdict. Everything else stays quiet.
export const COLOR = {
  stage: '#0f1720',
  stageEdge: '#1d2835',
  grid: '#17212c',
  line: '#7f9cc0',
  ok: '#7f9cc0',
  risk: '#e5484d',
  unknown: '#8a93a0',
  amber: '#e0a030',
  mist: '#dbe3ee',
  hub: '#f2f6fb',
} as const;

/** Node radius in graph units: role sets the base, connections add a little (Obsidian-style). */
export function radius(n: GraphNode): number {
  const d = Math.sqrt(n.degree);
  switch (n.type) {
    case 'model': return 11 + d * 0.9;
    case 'component': return 6 + d * 0.9;
    case 'country': return 6 + d * 1.5;
    case 'unmapped': return 5;
    default: return 3.6 + d * 1.1;
  }
}

export function nodeColor(n: GraphNode): string {
  if (n.type === 'model') return COLOR.hub;
  if (n.status === 'risk') return COLOR.risk;
  if (n.status === 'unknown' || n.status === 'not_researched') return COLOR.unknown;
  return COLOR.ok;
}

export const hasAmberFlag = (n: GraphNode) => n.type !== 'model' && (n.flags.lowConfidence || n.flags.conflict);

export function linkColor(l: GraphLink, alpha = 1): string {
  const rgb = l.risk ? '229,72,77' : l.unmapped ? '138,147,160' : '127,156,192';
  const base = l.risk ? 0.8 : l.unmapped ? 0.5 : l.kind === 'in' ? 0.22 : 0.34;
  return `rgba(${rgb},${(base * alpha).toFixed(3)})`;
}

export const linkWidth = (l: GraphLink) => (l.risk ? 2 : l.kind === 'has' ? 1.5 : 1);
export const linkDash = (l: GraphLink): number[] | null => (l.unmapped ? [4, 3] : l.kind === 'in' ? [1.5, 3] : null);
export const linkDistance = (l: GraphLink) => (l.kind === 'has' ? 70 : l.kind === 'in' ? 95 : 46);
export const linkStrength = (l: GraphLink) => (l.kind === 'in' ? 0.12 : 0.6);

export const TYPE_LABEL: Record<GraphNode['type'], string> = {
  model: 'Drone model',
  component: 'Component',
  supplier: 'Supplier',
  unmapped: 'Unmapped tier',
  country: 'Country',
};
