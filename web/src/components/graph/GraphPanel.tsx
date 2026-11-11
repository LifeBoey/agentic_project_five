import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Cutoff } from '../../api';
import { countryName } from '../../lib/countries';
import type { ModelData } from '../../lib/dataset';
import { componentId, type Graph, type GraphNode, type NodeType } from '../../lib/graph';
import { TYPE_LABEL } from '../../lib/graphStyle';
import { GraphCanvas2D } from './GraphCanvas2D';
import { Legend } from './Legend';
import { NodeDetail } from './NodeDetail';
import type { Adjacency, GraphHandle, GraphMarks } from './types';

// Three.js is large, so the 3D view downloads only when someone asks for it.
const GraphCanvas3D = lazy(() => import('./GraphCanvas3D'));

type Props = {
  graph: Graph;
  adj: Adjacency;
  dataset: ModelData[];
  /** The model picked in the page header: its part of the graph stays bright, the rest fades back. */
  model: string | null;
  cutoffOn: boolean;
  cutoff: Cutoff | null;
  onCutoff: (country: string) => void;
};

const ORDER: NodeType[] = ['model', 'component', 'country', 'supplier', 'unmapped'];

export function GraphPanel({ graph, adj, dataset, model, cutoffOn, cutoff, onCutoff }: Props) {
  const canvas = useRef<GraphHandle>(null);
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<NodeType>>(new Set());
  const [query, setQuery] = useState('');

  const selected = graph.nodes.find(n => n.id === selectedId) ?? null;
  useEffect(() => { if (selected && hidden.has(selected.type)) setSelectedId(null); }, [hidden, selected]);

  // A cut-off rings what depends on the country. Components with no record cannot be told, so they ring grey.
  const marks = useMemo<GraphMarks | null>(() => {
    if (!cutoffOn || !cutoff) return null;
    const unknown = new Set(cutoff.unknown.map(u => componentId(u.model, u.component)));
    for (const n of graph.nodes) if (n.status === 'not_researched') unknown.add(n.id);
    return { country: cutoff.country, affected: new Set(cutoff.affected.map(a => componentId(a.model, a.component))), unknown };
  }, [cutoffOn, cutoff, graph]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const rank = (n: GraphNode) => ORDER.indexOf(n.type);
    return graph.nodes
      .filter(n => `${n.label} ${n.type === 'country' ? countryName(n.label) : ''}`.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || b.degree - a.degree)
      .slice(0, 8);
  }, [graph, query]);

  const pick = (id: string) => {
    setSelectedId(id);
    setQuery('');
    canvas.current?.focusNode(id);
  };
  const toggle = (t: NodeType) => setHidden(h => { const next = new Set(h); if (next.has(t)) next.delete(t); else next.add(t); return next; });
  const View = mode === '3d' ? GraphCanvas3D : GraphCanvas2D;

  return (
    <section className="graph-panel" aria-label="Supply network">
      <div
        className="stage"
        role="group"
        aria-label={`Supply network graph with ${graph.nodes.length} nodes and ${graph.links.length} links. Use the search box, or the List view, to reach every component without the mouse.`}
      >
        <div className="stage-toolbar" role="toolbar" aria-label="Graph controls">
          <div className="seg" role="group" aria-label="View">
            <button type="button" aria-pressed={mode === '2d'} onClick={() => setMode('2d')}>2D</button>
            <button type="button" aria-pressed={mode === '3d'} onClick={() => setMode('3d')}>3D</button>
          </div>
          <div className="seg" role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom in" onClick={() => canvas.current?.zoomBy(1.4)}>+</button>
            <button type="button" aria-label="Zoom out" onClick={() => canvas.current?.zoomBy(1 / 1.4)}>−</button>
            <button type="button" onClick={() => canvas.current?.fit()}>Fit</button>
          </div>
          <div className="seg" role="group" aria-label="Show">
            <button type="button" aria-pressed={!hidden.has('country')} onClick={() => toggle('country')}>Countries</button>
            <button type="button" aria-pressed={!hidden.has('unmapped')} onClick={() => toggle('unmapped')}>Unmapped tiers</button>
          </div>
        </div>
        <Suspense fallback={<p className="stage-note" role="status">Loading the 3D view…</p>}>
          <View
            key={mode}
            ref={canvas}
            graph={graph}
            adj={adj}
            focusModel={model}
            selectedId={selectedId}
            marks={marks}
            hidden={hidden}
            onSelect={setSelectedId}
          />
        </Suspense>
        <p className="stage-hint">{mode === '2d' ? 'Drag to pan, scroll to zoom, drag a node to move it.' : 'Drag to orbit, scroll to zoom, click a node to inspect it.'}</p>
      </div>

      <div className="inspector">
        <div className="find">
          <label htmlFor="graph-find">Find in the graph</label>
          <input id="graph-find" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="A supplier, component or country" autoComplete="off" />
          {results.length > 0 && (
            <ul className="find-results" aria-label="Matches">
              {results.map(n => (
                <li key={n.id}>
                  <button type="button" onClick={() => pick(n.id)}>
                    <span>{n.type === 'country' ? countryName(n.label) : n.label}</span>
                    <small>{TYPE_LABEL[n.type]}{n.model ? ` · ${n.model}` : ''}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim() && results.length === 0 && <p className="note" role="status">Nothing in the graph matches “{query.trim()}”.</p>}
        </div>

        {selected
          ? <NodeDetail node={selected} dataset={dataset} onClose={() => setSelectedId(null)} onCutoff={onCutoff} />
          : <aside className="drawer drawer-empty" data-testid="node-detail-empty">Select a node to see its sources. Red marks the path from a drone to the one country it depends on.</aside>}
        <Legend />
      </div>
    </section>
  );
}
