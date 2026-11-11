import { useMemo, useState } from 'react';
import { countryName, label } from '../lib/countries';
import { isMapped, type Row } from '../lib/rows';
import type { CutoffMarks } from './ComponentList';

// The whole model as one picture: model -> components -> tier 1 -> deeper tiers -> country of origin.
// Unmapped tiers are hatched and flow into "Unknown origin", so a gap never reads as a safe dead end.

type Kind = 'model' | 'component' | 'supplier' | 'gap' | 'country' | 'unknown';
interface GNode { id: string; col: number; kind: Kind; text: string; title: string; component?: string; red?: boolean; low?: boolean; country?: string }
interface GEdge { from: string; to: string; component?: string; red?: boolean; gap?: boolean; country?: string }

const W = 1000, NODE_W = 132, NODE_H = 30, ROW_H = 42, PAD_Y = 34;
const UNKNOWN = 'country:?';
const clip = (s: string, n = 19) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function build(model: string, rows: Row[]) {
  const nodes = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const maxTier = Math.max(1, ...rows.flatMap(r => r.chain.tiers.map(t => t.tier)));
  const countryCol = maxTier + 2;
  const add = (n: GNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); return n.id; };

  const modelId = add({ id: 'model', col: 0, kind: 'model', text: clip(model), title: model });
  for (const r of rows) {
    const red = r.state === 'red';
    const unknown = r.state === 'unknown' || r.state === 'not_researched';
    const compId = add({ id: `c:${r.name}`, col: 1, kind: unknown ? 'gap' : 'component', text: clip(label(r.name)), title: label(r.name), component: r.name, red });
    edges.push({ from: modelId, to: compId, component: r.name });

    let prev = [compId];
    const tiers = [...r.chain.tiers].sort((a, b) => a.tier - b.tier);
    if (tiers.length === 0) { add({ id: UNKNOWN, col: countryCol, kind: 'unknown', text: 'Unknown origin', title: 'Unknown origin' }); edges.push({ from: compId, to: UNKNOWN, component: r.name, gap: true }); continue; }
    for (const t of tiers) {
      const here: string[] = [];
      for (const l of t.links) {
        if (!isMapped(l)) {
          const id = add({ id: `g:${r.name}:${t.tier}`, col: t.tier + 1, kind: 'gap', text: clip(l.part ?? 'Unmapped'), title: `Tier ${t.tier}${l.part ? ` · ${l.part}` : ''}: unmapped`, component: r.name });
          add({ id: UNKNOWN, col: countryCol, kind: 'unknown', text: 'Unknown origin', title: 'Unknown origin' });
          if (!here.includes(id)) { here.push(id); edges.push({ from: id, to: UNKNOWN, component: r.name, gap: true }); }
          continue;
        }
        const code = l.supplier_country.trim().toUpperCase();
        const id = add({ id: `s:${r.name}:${t.tier}:${l.supplier}|${code}`, col: t.tier + 1, kind: 'supplier', text: clip(l.supplier), title: `${l.supplier} (${countryName(code)}), tier ${t.tier}${l.part ? ` · ${l.part}` : ''}`, component: r.name, low: l.confidence === 'low' });
        if (here.includes(id)) continue;
        here.push(id);
        const cid = add({ id: `country:${code}`, col: countryCol, kind: 'country', text: clip(countryName(code)), title: countryName(code), country: code });
        edges.push({ from: id, to: cid, component: r.name, country: code, red: red && r.countries.includes(code) });
      }
      for (const p of prev) for (const h of here) edges.push({ from: p, to: h, component: r.name, red, gap: h.startsWith('g:') });
      prev = here;
    }
  }
  // A country is red when some component depends on it alone.
  for (const r of rows) if (r.state === 'red') for (const c of r.countries) { const n = nodes.get(`country:${c}`); if (n) n.red = true; }
  return { nodes: [...nodes.values()], edges, cols: countryCol + 1, maxTier };
}

type Props = { model: string; rows: Row[]; cutoff: CutoffMarks | null; cutoffCountry: string | null; selected: string | null; onSelect: (c: string) => void };

export function ChainGraph({ model, rows, cutoff, cutoffCountry, selected, onSelect }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const g = useMemo(() => build(model, rows), [model, rows]);

  const perCol = Array.from({ length: g.cols }, (_, c) => g.nodes.filter(n => n.col === c));
  const tallest = Math.max(...perCol.map(c => c.length));
  const H = tallest * ROW_H + PAD_Y * 2;
  const colX = (c: number) => (NODE_W / 2) + c * ((W - NODE_W) / (g.cols - 1));
  const pos = new Map<string, { x: number; y: number }>();
  perCol.forEach((col, c) => {
    const top = (H - col.length * ROW_H) / 2;
    col.forEach((n, i) => pos.set(n.id, { x: colX(c), y: top + i * ROW_H + ROW_H / 2 }));
  });

  // What to emphasise: a hovered component's chain, or everything a cut-off touches.
  const hit = (component?: string, country?: string) => {
    if (hover) return component === hover;
    if (cutoff && cutoffCountry) return (component && (cutoff.affected.has(component) || cutoff.unknown.has(component))) || country === cutoffCountry;
    return true;
  };
  const headers = ['Model', 'Component', ...Array.from({ length: g.maxTier }, (_, i) => `Tier ${i + 1}`), 'Origin'];

  return (
    <section className="graph" aria-label="Supply chain map">
      <div className="graph-head">
        <h3>Supply chain map</h3>
        <ul className="legend" aria-hidden="true">
          <li><span className="key key-red" />Depends on one country</li>
          <li><span className="key key-gap" />Unmapped, origin unknown</li>
          <li><span className="key key-low" />Low-confidence source</li>
        </ul>
      </div>
      <p className="visually-hidden">The same chains are listed component by component below the map.</p>
      <div className="graph-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" onMouseLeave={() => setHover(null)}>
          <defs>
            <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" fill="#eef1f4" /><line x1="0" y1="0" x2="0" y2="7" stroke="#cdd3da" strokeWidth="2" />
            </pattern>
          </defs>
          {headers.map((h, c) => <text key={h} className="g-col" x={colX(c)} y={16} textAnchor="middle">{h}</text>)}
          {g.edges.map((e, i) => {
            const a = pos.get(e.from)!, b = pos.get(e.to)!;
            const x1 = a.x + NODE_W / 2, x2 = b.x - NODE_W / 2, mid = (x1 + x2) / 2;
            const on = hit(e.component, e.country);
            const cut = cutoffCountry && e.country === cutoffCountry && on;
            return (
              <path key={i} d={`M${x1},${a.y} C${mid},${a.y} ${mid},${b.y} ${x2},${b.y}`}
                className={`g-edge${e.red ? ' g-edge-red' : ''}${e.gap ? ' g-edge-gap' : ''}${cut ? ' g-edge-cut' : ''}${on ? '' : ' g-dim'}`} />
            );
          })}
          {g.nodes.map(n => {
            const p = pos.get(n.id)!;
            const on = hit(n.component, n.country) || n.kind === 'model' || (n.kind === 'unknown' && !hover);
            const cut = n.kind === 'country' && n.country === cutoffCountry && !!cutoff;
            const clickable = n.kind === 'component' || (n.kind === 'gap' && n.col === 1);
            const cls = [
              'g-node', `g-${n.kind}`, n.red && 'g-red', n.low && 'g-low', cut && 'g-cut', !on && 'g-dim',
              n.component && n.component === selected && n.col === 1 && 'g-selected', clickable && 'g-click',
            ].filter(Boolean).join(' ');
            return (
              <g key={n.id} className={cls} transform={`translate(${p.x - NODE_W / 2},${p.y - NODE_H / 2})`}
                onMouseEnter={() => n.component && setHover(n.component)}
                onClick={clickable ? () => onSelect(n.component!) : undefined}>
                <title>{n.title}</title>
                <rect width={NODE_W} height={NODE_H} rx={n.kind === 'country' || n.kind === 'unknown' ? NODE_H / 2 : 4} />
                <text x={NODE_W / 2} y={NODE_H / 2} dy="0.35em" textAnchor="middle">{n.text}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
