import { countryName, label } from '../lib/countries';
import type { Row } from '../lib/rows';
import { StatusBadge } from './StatusBadge';
import { SupplierCards, UnmappedCard } from './SupplierCards';

export interface CutoffMarks {
  affected: Set<string>;
  blocked: Set<string>;
  unknown: Set<string>;
}

type Props = {
  rows: Row[];
  selected: string | null;
  onSelect: (component: string) => void;
  /** Marks from the country cut-off, or null when the toggle is off. */
  cutoff: CutoffMarks | null;
};

export function ComponentList({ rows, selected, onSelect, cutoff }: Props) {
  return (
    <ul className="components" aria-label="Components">
      {rows.map(r => {
        const deepestTier = r.chain.tiers.filter(t => t.links.some(l => l.confidence !== 'unmapped')).at(-1)?.tier ?? 1;
        const hit = cutoff?.affected.has(r.name);
        return (
          <li
            key={r.name}
            className={`row row-${r.state}${hit ? ' row-cutoff' : ''}${selected === r.name ? ' row-selected' : ''}`}
            data-testid={`row-${r.name}`}
            data-state={r.state}
          >
            <button type="button" className="row-title" aria-pressed={selected === r.name} onClick={() => onSelect(r.name)}>
              {label(r.name)}
            </button>
            <div className="badges">
              {r.state === 'red' && <StatusBadge kind="single" detail={r.countries.map(countryName).join(', ')} />}
              {r.state === 'unknown' && <StatusBadge kind="unmapped" />}
              {r.state === 'not_researched' && <StatusBadge kind="not-researched" />}
              {r.partlyUnknown && <StatusBadge kind="partly" />}
              {r.lowConfidence && <StatusBadge kind="low" />}
              {r.conflict && <StatusBadge kind="conflict" />}
              {r.singleSource && <StatusBadge kind="supplier" />}
              {hit && <StatusBadge kind="affected" />}
              {cutoff?.blocked.has(r.name) && <StatusBadge kind="blocked" />}
              {cutoff && (cutoff.unknown.has(r.name) || r.state === 'not_researched') && <StatusBadge kind="cutoff-unknown" />}
            </div>
            {r.state === 'not_researched' ? (
              <p className="note">Not researched: no record for this component yet. A gap in the data, not a safe result.</p>
            ) : r.state === 'unknown' ? (
              <p className="note">Unmapped: no reliable source found. Ask the vendor.</p>
            ) : (
              <div className="cards">
                <SupplierCards links={r.shown} tier={deepestTier} />
                {r.gapTiers.map(t => <UnmappedCard key={t} tier={t} />)}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
