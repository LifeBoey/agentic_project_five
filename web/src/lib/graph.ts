import type { ChainLink } from '../api';
import type { ModelData } from './dataset';
import { isMapped, type Row } from './rows';

// The supply network as nodes and links, for the graph view. Pure: no drawing, no library.
//
//   model ── has ──▶ component ◀── supplies ── supplier (tier 1) ◀── supplies ── supplier (tier 2) …
//                                                 └── in ──▶ country
//
// A supplier is one node however many components or models it serves, so shared suppliers join models together.
// A tier with nothing found is a node of its own (type "unmapped"), so a gap is something you can see and click.

export type NodeType = 'model' | 'component' | 'supplier' | 'unmapped' | 'country';
/** risk: on the path to a single-country verdict. unknown: unmapped. not_researched: no record at all. */
export type NodeStatus = 'risk' | 'ok' | 'unknown' | 'not_researched';

export interface SupplierSource {
  model: string;
  component: string;
  tier: number;
  part?: string;
  url: string;
  confidence: ChainLink['confidence'];
  conflict: boolean;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  /** Shown on the node. Countries use their ISO code. */
  label: string;
  status: NodeStatus;
  /** The models this node belongs to. A node in several is a shared dependency. */
  models: string[];
  degree: number;
  flags: { lowConfidence: boolean; conflict: boolean; partlyUnmapped: boolean; singleSource: boolean };
  model?: string;
  component?: string;
  tier?: number;
  part?: string;
  country?: string;
  /** Mapped sources behind a supplier node. */
  sources: SupplierSource[];
  /** For a component node: the row the list view shows, so the same detail can open from the graph. */
  row?: Row;
}

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  kind: 'has' | 'supplies' | 'in';
  /** On the path from a model to a single-country verdict. */
  risk: boolean;
  /** Points at a tier with nothing found. */
  unmapped: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  links: GraphLink[];
}

const norm = (s: string) => s.trim().toLowerCase();
export const supplierId = (name: string) => `supplier:${norm(name)}`;
export const countryId = (code: string) => `country:${code.trim().toUpperCase()}`;
export const componentId = (model: string, component: string) => `component:${model}/${component}`;
export const modelId = (model: string) => `model:${model}`;

const NO_FLAGS = { lowConfidence: false, conflict: false, partlyUnmapped: false, singleSource: false };

export function buildGraph(dataset: ModelData[]): Graph {
  const nodes = new Map<string, GraphNode>();
  const links = new Map<string, GraphLink>();

  function node(id: string, init: Omit<GraphNode, 'id' | 'degree' | 'models' | 'sources' | 'flags'> & { flags?: GraphNode['flags'] }, model: string): GraphNode {
    let n = nodes.get(id);
    if (!n) {
      n = { id, degree: 0, models: [], sources: [], flags: NO_FLAGS, ...init };
      nodes.set(id, n);
    }
    if (!n.models.includes(model)) n.models.push(model);
    return n;
  }

  function link(source: string, target: string, kind: GraphLink['kind'], opts: { risk?: boolean; unmapped?: boolean } = {}) {
    const id = `${kind}:${source}>${target}`;
    const existing = links.get(id);
    if (existing) {
      existing.risk ||= opts.risk ?? false;
      return;
    }
    links.set(id, { id, source, target, kind, risk: opts.risk ?? false, unmapped: opts.unmapped ?? false });
  }

  for (const { model, rows } of dataset) {
    const hub = modelId(model);
    node(hub, { type: 'model', label: model, status: 'ok', model }, model);

    for (const row of rows) {
      const comp = componentId(model, row.name);
      const compStatus: NodeStatus = row.state === 'red' ? 'risk' : row.state === 'ok' ? 'ok' : row.state;
      node(comp, {
        type: 'component', label: row.name, status: compStatus, model, component: row.name, row,
        flags: { lowConfidence: row.lowConfidence, conflict: row.conflict, partlyUnmapped: row.partlyUnknown, singleSource: row.singleSource },
      }, model);
      link(hub, comp, 'has', { risk: row.state === 'red' });
      if (row.state === 'not_researched') continue; // nothing is known below it, and nothing is invented

      const tiers = row.chain.tiers;
      const deepestMapped = Math.max(0, ...tiers.filter(t => t.links.some(isMapped)).map(t => t.tier));
      let above: string[] = [comp];

      for (const t of tiers) {
        const here: string[] = [];
        const mapped = t.links.filter(isMapped);
        for (const l of mapped) {
          const id = supplierId(l.supplier);
          const verdict = row.state === 'red' && t.tier === deepestMapped;
          const n = node(id, { type: 'supplier', label: l.supplier, status: verdict ? 'risk' : 'ok', country: l.supplier_country.trim().toUpperCase() || undefined, part: l.part }, model);
          if (verdict) n.status = 'risk';
          n.flags = {
            lowConfidence: n.flags.lowConfidence || l.confidence === 'low',
            conflict: n.flags.conflict || l.conflict,
            partlyUnmapped: false,
            singleSource: false,
          };
          n.sources.push({ model, component: row.name, tier: t.tier, part: l.part, url: l.source_url, confidence: l.confidence, conflict: l.conflict });
          if (!here.includes(id)) here.push(id);
          for (const up of above) link(id, up, 'supplies', { risk: row.state === 'red' && t.tier <= deepestMapped });
          if (n.country) {
            const c = node(countryId(n.country), { type: 'country', label: n.country, status: 'ok', country: n.country }, model);
            if (verdict) c.status = 'risk';
            link(id, c.id, 'in', { risk: verdict });
          }
        }
        if (t.links.some(l => !isMapped(l))) {
          const part = t.links.find(l => !isMapped(l))?.part;
          const id = `unmapped:${model}/${row.name}/${t.tier}`;
          node(id, { type: 'unmapped', label: part ? `${part}?` : 'Unmapped', status: 'unknown', model, component: row.name, tier: t.tier, part }, model);
          for (const up of above) link(id, up, 'supplies', { unmapped: true });
          here.push(id);
        }
        if (here.length > 0) above = here;
      }
    }
  }

  for (const l of links.values()) {
    nodes.get(l.source)!.degree++;
    nodes.get(l.target)!.degree++;
  }
  return { nodes: [...nodes.values()], links: [...links.values()] };
}

/** Each node's neighbours and incident links, for highlight-on-hover. */
export function adjacency(graph: Graph) {
  const nodesOf = new Map<string, Set<string>>();
  const linksOf = new Map<string, Set<string>>();
  for (const n of graph.nodes) { nodesOf.set(n.id, new Set()); linksOf.set(n.id, new Set()); }
  for (const l of graph.links) {
    nodesOf.get(l.source)!.add(l.target);
    nodesOf.get(l.target)!.add(l.source);
    linksOf.get(l.source)!.add(l.id);
    linksOf.get(l.target)!.add(l.id);
  }
  return { nodesOf, linksOf };
}
