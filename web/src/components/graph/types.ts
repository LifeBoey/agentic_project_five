import type { Graph, GraphNode } from '../../lib/graph';
import type { adjacency } from '../../lib/graph';

export type Adjacency = ReturnType<typeof adjacency>;

/** What a country cut-off does to the graph: red rings on what depends on it, grey on what cannot be told. */
export interface GraphMarks {
  country: string;
  affected: Set<string>;
  unknown: Set<string>;
}

export interface GraphViewProps {
  graph: Graph;
  adj: Adjacency;
  /** Models other than this one are dimmed. */
  focusModel: string | null;
  selectedId: string | null;
  marks: GraphMarks | null;
  /** Node types the user has switched off. */
  hidden: ReadonlySet<GraphNode['type']>;
  onSelect: (id: string | null) => void;
}

export interface GraphHandle {
  fit: () => void;
  zoomBy: (factor: number) => void;
  focusNode: (id: string) => void;
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Is this node hit by the cut-off? A supplier or country in that country, or a component that depends on it. */
export function markOf(n: GraphNode, marks: GraphMarks | null): 'affected' | 'unknown' | null {
  if (!marks) return null;
  if (n.type === 'component') return marks.affected.has(n.id) ? 'affected' : marks.unknown.has(n.id) ? 'unknown' : null;
  if ((n.type === 'supplier' || n.type === 'country') && n.country === marks.country) return 'affected';
  return null;
}
