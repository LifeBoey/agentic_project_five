import { COLOR } from '../../lib/graphStyle';

const S = 18;
const Swatch = ({ children }: { children: React.ReactNode }) => (
  <svg width={S} height={S} viewBox="0 0 18 18" aria-hidden="true" focusable="false">{children}</svg>
);

/** The graph's key. Shape says what a node is; colour only says risk. */
export function Legend() {
  return (
    <section className="graph-key" aria-label="Legend">
      <h4>Key</h4>
      <ul>
        <li><Swatch><circle cx="9" cy="9" r="6.5" fill={COLOR.hub} /></Swatch> Drone model</li>
        <li><Swatch><circle cx="9" cy="9" r="5.5" fill={COLOR.stage} stroke={COLOR.ok} strokeWidth="2" /></Swatch> Component</li>
        <li><Swatch><circle cx="9" cy="9" r="4" fill={COLOR.ok} /></Swatch> Supplier</li>
        <li><Swatch><rect x="3" y="3" width="12" height="12" rx="3" fill={COLOR.stage} stroke={COLOR.ok} strokeWidth="1.6" /></Swatch> Country</li>
        <li><Swatch><circle cx="9" cy="9" r="5.5" fill="none" stroke={COLOR.unknown} strokeWidth="1.6" strokeDasharray="3 2.5" /></Swatch> Unmapped tier or not researched</li>
        <li><Swatch><circle cx="9" cy="9" r="4.5" fill={COLOR.risk} /><circle cx="9" cy="9" r="7.5" fill="none" stroke={COLOR.risk} strokeOpacity="0.35" /></Swatch> On the path to a single-country dependency</li>
        <li><Swatch><circle cx="9" cy="9" r="4" fill={COLOR.ok} /><circle cx="9" cy="9" r="6.8" fill="none" stroke={COLOR.amber} strokeWidth="1.4" /></Swatch> Low confidence or sources disagree</li>
      </ul>
    </section>
  );
}
