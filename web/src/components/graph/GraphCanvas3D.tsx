import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import type { GraphLink, GraphNode } from '../../lib/graph';
import { COLOR, hasAmberFlag, linkColor, linkDistance, linkStrength, nodeColor, radius } from '../../lib/graphStyle';
import { markOf, prefersReducedMotion, type GraphHandle, type GraphViewProps } from './types';
import { useSize } from './useSize';

type N = GraphNode & { x?: number; y?: number; z?: number };
type L = GraphLink;
const endId = (e: unknown) => (typeof e === 'object' && e !== null ? (e as GraphNode).id : (e as string));

/** The 3D view: the same network in Three.js. Orbit with the mouse, scroll to zoom, click a node to inspect it. */
const GraphCanvas3D = forwardRef<GraphHandle, GraphViewProps>(function GraphCanvas3D(
  { graph, adj, focusModel, selectedId, marks, hidden, onSelect }, handle,
) {
  const { ref: box, width, height } = useSize<HTMLDivElement>();
  const fg = useRef<ForceGraphMethods<N, L> | undefined>(undefined);
  const fitted = useRef(false);
  /** Once the user pans, zooms or drags, the view is theirs: a resize no longer refits it. */
  const touched = useRef(false);
  const reduced = useMemo(prefersReducedMotion, []);

  const data = useMemo(() => {
    const nodes = graph.nodes.filter(n => !hidden.has(n.type));
    const ids = new Set(nodes.map(n => n.id));
    return { nodes, links: graph.links.filter(l => ids.has(endId(l.source)) && ids.has(endId(l.target))) };
  }, [graph, hidden]);

  useEffect(() => {
    if (!touched.current && fitted.current) fg.current?.zoomToFit(0, 60);
  }, [width, height]);

  useEffect(() => {
    fitted.current = false;
    fg.current?.d3ReheatSimulation();
  }, [hidden]);

  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    g.d3Force('link')?.distance?.(linkDistance).strength?.(linkStrength);
    g.d3Force('charge')?.strength?.(-130);
  }, [width, height]);

  useImperativeHandle(handle, () => ({
    fit: () => fg.current?.zoomToFit(reduced ? 0 : 600, 60),
    zoomBy: f => {
      const g = fg.current;
      if (!g) return;
      // The getter form exists at runtime; the wrapper's types only declare the setter.
      const p = (g as unknown as { cameraPosition(): { x: number; y: number; z: number } }).cameraPosition();
      g.cameraPosition({ x: p.x / f, y: p.y / f, z: p.z / f }, undefined, reduced ? 0 : 250);
    },
    focusNode: id => {
      const g = fg.current;
      const n = graph.nodes.find(x => x.id === id) as N | undefined;
      if (!g || n?.x == null || n.y == null || n.z == null) return;
      const ratio = 1 + 90 / Math.max(Math.hypot(n.x, n.y, n.z), 1);
      g.cameraPosition({ x: n.x * ratio, y: n.y * ratio, z: n.z * ratio }, { x: n.x, y: n.y, z: n.z }, reduced ? 0 : 800);
    },
  }), [graph, reduced]);

  // Rebuilt only when what it depends on changes. Dimming mirrors the 2D view: other models fade back.
  const nodeObject = useMemo(() => (n: N) => {
    const size = Math.max(radius(n) * 0.55, 2);
    const mark = markOf(n, marks);
    const faded = focusModel && !n.models.includes(focusModel);
    const near = selectedId ? n.id === selectedId || adj.nodesOf.get(selectedId)?.has(n.id) : true;
    const opacity = (faded ? 0.3 : 1) * (near ? 1 : 0.35);
    const color = new THREE.Color(nodeColor(n));
    const group = new THREE.Group();

    const geometry = n.type === 'country' ? new THREE.BoxGeometry(size * 1.5, size * 1.5, size * 1.5)
      : n.type === 'model' ? new THREE.IcosahedronGeometry(size, 1)
      : new THREE.SphereGeometry(size, 24, 16);
    const material = n.type === 'unmapped'
      ? new THREE.MeshBasicMaterial({ color: COLOR.unknown, wireframe: true, transparent: true, opacity })
      : new THREE.MeshStandardMaterial({
          color, roughness: 0.45, metalness: 0.1, transparent: true, opacity,
          emissive: n.status === 'risk' ? new THREE.Color(COLOR.risk) : color,
          emissiveIntensity: n.status === 'risk' ? 0.7 : 0.12,
        });
    group.add(new THREE.Mesh(geometry, material));

    const ring = (r: number, c: string, o = 1) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(r, 20, 12),
        new THREE.MeshBasicMaterial({ color: c, wireframe: true, transparent: true, opacity: o * opacity }),
      );
      group.add(m);
    };
    if (hasAmberFlag(n)) ring(size * 1.35, COLOR.amber, 0.8);
    if (mark) ring(size * 1.7, mark === 'affected' ? COLOR.risk : COLOR.unknown, 0.9);
    if (n.id === selectedId) ring(size * 2.1, '#ffffff', 0.9);

    if (n.type !== 'unmapped') {
      const label = new SpriteText(n.label.length > 24 ? `${n.label.slice(0, 23)}…` : n.label, n.type === 'model' ? 3.4 : n.type === 'supplier' ? 2.2 : 2.8);
      label.color = n.status === 'risk' && n.type !== 'model' ? '#ffb4b6' : COLOR.mist;
      label.fontWeight = '500';
      label.backgroundColor = false as unknown as string;
      label.material.depthWrite = false;
      label.material.opacity = opacity;
      label.position.y = size + 3.2;
      group.add(label);
    }
    return group;
  }, [selectedId, marks, focusModel, adj]);

  return (
    <div ref={box} className="stage-canvas" onPointerDown={() => { touched.current = true; }} onWheel={() => { touched.current = true; }}>
      {width > 0 && height > 0 && (
        <ForceGraph3D<N, L>
          ref={fg}
          width={width}
          height={height}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          showNavInfo={false}
          warmupTicks={200}
          cooldownTicks={reduced ? 0 : 60}
          nodeThreeObject={nodeObject}
          nodeLabel={(n: N) => n.label}
          linkColor={(l: L) => linkColor(l)}
          linkOpacity={0.6}
          linkWidth={(l: L) => (l.risk ? 1.4 : 0.35)}
          linkDirectionalParticles={(l: L) => (l.risk && !reduced ? 2 : 0)}
          linkDirectionalParticleWidth={1.4}
          linkDirectionalParticleSpeed={0.005}
          linkDirectionalParticleColor={() => COLOR.risk}
          onNodeClick={(n: N) => onSelect(n.id)}
          onBackgroundClick={() => onSelect(null)}
          onEngineStop={() => {
            if (fitted.current) return;
            fitted.current = true;
            fg.current?.zoomToFit(reduced ? 0 : 700, 60);
          }}
        />
      )}
    </div>
  );
});

export default GraphCanvas3D;
