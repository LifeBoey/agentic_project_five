import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import type { GraphLink, GraphNode } from '../../lib/graph';
import { COLOR, hasAmberFlag, linkColor, linkDash, linkDistance, linkStrength, linkWidth, nodeColor, radius } from '../../lib/graphStyle';
import { markOf, prefersReducedMotion, type GraphHandle, type GraphViewProps } from './types';
import { useSize } from './useSize';

type N = GraphNode & { x?: number; y?: number };
type L = GraphLink;

const FONT = '500 11px system-ui, -apple-system, "Segoe UI", sans-serif';
const endId = (e: unknown) => (typeof e === 'object' && e !== null ? (e as GraphNode).id : (e as string));
const clip = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The 2D view: a force-directed network on a canvas, in the manner of Obsidian's graph. */
export const GraphCanvas2D = forwardRef<GraphHandle, GraphViewProps>(function GraphCanvas2D(
  { graph, adj, focusModel, selectedId, marks, hidden, onSelect }, handle,
) {
  const { ref: box, width, height } = useSize<HTMLDivElement>();
  const fg = useRef<ForceGraphMethods<N, L> | undefined>(undefined);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const fitted = useRef(false);
  const firstFit = useRef(false);
  /** Once the user pans, zooms or drags, the view is theirs: a resize no longer refits it. */
  const touched = useRef(false);
  const reduced = useMemo(prefersReducedMotion, []);

  // Drawing reads the latest interaction state from here, so the accessors can stay stable.
  const roomy = graph.nodes.length <= 60; // a small graph has space for every label at any zoom
  const live = useRef({ hoverId, selectedId, marks, focusModel, adj, roomy });
  live.current = { hoverId, selectedId, marks, focusModel, adj, roomy };

  // Same node objects every time, so positions survive filtering and tab switches.
  const data = useMemo(() => {
    const nodes = graph.nodes.filter(n => !hidden.has(n.type));
    const ids = new Set(nodes.map(n => n.id));
    return { nodes, links: graph.links.filter(l => ids.has(endId(l.source)) && ids.has(endId(l.target))) };
  }, [graph, hidden]);

  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    g.d3Force('link')?.distance?.(linkDistance).strength?.(linkStrength);
    g.d3Force('charge')?.strength?.(-130);
  }, [width, height]);

  // The canvas changed size (layout settling, window resize): keep the whole graph in view until the user takes over.
  useEffect(() => {
    if (!touched.current && fitted.current) fg.current?.zoomToFit(0, 50);
  }, [width, height]);

  // A filter changed what is shown: settle again and refit.
  useEffect(() => {
    fitted.current = false;
    fg.current?.d3ReheatSimulation();
  }, [hidden]);

  useImperativeHandle(handle, () => ({
    fit: () => fg.current?.zoomToFit(reduced ? 0 : 450, 60),
    zoomBy: f => { const g = fg.current; if (g) g.zoom(g.zoom() * f, reduced ? 0 : 250); },
    focusNode: id => {
      const g = fg.current;
      const n = graph.nodes.find(x => x.id === id) as N | undefined;
      if (!g || n?.x == null || n.y == null) return;
      g.centerAt(n.x, n.y, reduced ? 0 : 500);
      g.zoom(Math.max(g.zoom(), 2.2), reduced ? 0 : 500);
    },
  }), [graph, reduced]);

  // Test hook: where a node is on screen, so a test can click it. Development builds only.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__graph = {
      screenPos(id: string) {
        const n = graph.nodes.find(x => x.id === id) as N | undefined;
        const p = n?.x == null || n.y == null ? null : fg.current?.graph2ScreenCoords(n.x, n.y);
        const r = box.current?.getBoundingClientRect();
        return p && r ? { x: r.left + p.x, y: r.top + p.y } : null;
      },
    };
  });

  function paintNode(n: N, ctx: CanvasRenderingContext2D, scale: number) {
    if (n.x == null || n.y == null) return;
    const { hoverId: hover, selectedId: sel, marks: mk, focusModel: fm, adj: a, roomy: room } = live.current;
    const near = !!hover && (n.id === hover || a.nodesOf.get(hover)?.has(n.id));
    const alpha = hover ? (near ? 1 : 0.12) : fm && !n.models.includes(fm) ? 0.3 : 1;
    // Never smaller than a few screen pixels, so a zoomed-out graph stays readable.
    const r = Math.max(radius(n), (n.type === 'country' ? 8 : 4.5) / scale);
    const color = nodeColor(n);
    const mark = markOf(n, mk);

    ctx.save();
    ctx.globalAlpha = alpha;

    if (mark) { // cut-off: a ring around what is hit (red) or cannot be told (grey, dotted)
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 5 / scale * 1.1, 0, Math.PI * 2);
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = mark === 'affected' ? COLOR.risk : COLOR.unknown;
      ctx.setLineDash(mark === 'unknown' ? [2 / scale, 3 / scale] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (n.status === 'risk') { ctx.shadowColor = COLOR.risk; ctx.shadowBlur = 14; }

    ctx.beginPath();
    if (n.type === 'country') {
      const s = Math.max(r * 1.7, 19 / scale);
      ctx.roundRect(n.x - s / 2, n.y - s / 2, s, s, s * 0.22);
    } else {
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    }

    if (n.type === 'supplier' || n.type === 'model') {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.fillStyle = n.type === 'country' && n.status === 'risk' ? 'rgba(229,72,77,0.22)' : COLOR.stage;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = (n.type === 'component' ? 2 : 1.6) / scale * 1.1;
      ctx.strokeStyle = n.type === 'country' && n.status !== 'risk' ? COLOR.ok : color;
      ctx.setLineDash(n.type === 'unmapped' || n.status === 'not_researched' ? [3 / scale, 2.5 / scale] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.shadowBlur = 0;

    if (hasAmberFlag(n)) { // low confidence or conflicting sources
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 2.2 / scale * 1.1, 0, Math.PI * 2);
      ctx.lineWidth = 1.4 / scale * 1.1;
      ctx.strokeStyle = COLOR.amber;
      ctx.stroke();
    }
    if (n.id === sel) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 6 / scale * 1.1, 0, Math.PI * 2);
      ctx.lineWidth = 2 / scale * 1.1;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }

    // Inside the node: a country's code, or the "?" of a tier with nothing found.
    if (n.type === 'country' || n.type === 'unmapped') {
      ctx.font = `600 ${n.type === 'country' ? 10 / scale : Math.max(r * 0.8, 6 / scale)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = n.type === 'country' ? COLOR.mist : COLOR.unknown;
      ctx.fillText(n.type === 'country' ? n.label : '?', n.x, n.y + 0.5 / scale);
    }

    // Labels: models and countries always, the rest as you zoom in (or when hovered, selected, or next to the hovered node).
    const show = n.id === sel || near || n.type === 'model' || n.type === 'country'
      || (n.type === 'component' && scale > 0.4) || (n.type === 'supplier' && scale > (room ? 0.5 : 1.1)) || (n.type === 'unmapped' && scale > (room ? 0.9 : 1.5));
    if (show && n.type !== 'country') {
      const fs = 11 / scale;
      ctx.font = FONT.replace('11px', `${fs}px`);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const y = n.y + r + 3 / scale;
      const text = clip(n.label);
      ctx.lineWidth = 3.2 / scale;
      ctx.strokeStyle = 'rgba(15,23,32,0.92)';
      ctx.lineJoin = 'round';
      ctx.strokeText(text, n.x, y);
      ctx.fillStyle = n.status === 'risk' && n.type !== 'model' ? '#ffb4b6' : COLOR.mist;
      ctx.fillText(text, n.x, y);
    }
    ctx.restore();
  }

  const linkAlpha = (l: L) => {
    const { hoverId: hover, adj: a } = live.current;
    return hover ? (a.linksOf.get(hover)?.has(l.id) ? 2.2 : 0.18) : 1;
  };

  return (
    <div
      ref={box}
      className="stage-canvas"
      style={{ cursor: hoverId ? 'pointer' : 'grab' }}
      onPointerDown={() => { touched.current = true; }}
      onWheel={() => { touched.current = true; }}
    >
      {width > 0 && height > 0 && (
        <ForceGraph2D<N, L>
          ref={fg}
          width={width}
          height={height}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          autoPauseRedraw={false}
          minZoom={0.3}
          maxZoom={8}
          warmupTicks={260}
          cooldownTicks={reduced ? 0 : 60}
          d3VelocityDecay={0.34}
          nodeRelSize={1}
          nodeLabel={(n: N) => `${n.label}`}
          nodeCanvasObject={paintNode}
          nodeCanvasObjectMode={() => 'replace'}
          nodePointerAreaPaint={(n: N, color: string, ctx: CanvasRenderingContext2D) => {
            if (n.x == null || n.y == null) return;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, radius(n) + 3, 0, Math.PI * 2);
            ctx.fill();
          }}
          linkColor={(l: L) => linkColor(l, linkAlpha(l))}
          linkWidth={linkWidth}
          linkLineDash={linkDash}
          onNodeHover={(n: N | null) => setHoverId(n?.id ?? null)}
          onNodeClick={(n: N) => onSelect(n.id)}
          onBackgroundClick={() => onSelect(null)}
          onEngineTick={() => {
            // The layout is already warmed up: frame it straight away instead of waiting for it to settle.
            if (firstFit.current || touched.current) return;
            firstFit.current = true;
            fg.current?.zoomToFit(0, 50);
          }}
          onEngineStop={() => {
            if (fitted.current) return;
            fitted.current = true;
            fg.current?.zoomToFit(reduced ? 0 : 500, 50);
          }}
        />
      )}
    </div>
  );
});
