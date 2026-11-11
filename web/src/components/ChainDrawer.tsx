import { useEffect, useRef } from 'react';
import { countryName, label } from '../lib/countries';
import { isMapped, type Row } from '../lib/rows';
import { SupplierCards } from './SupplierCards';

export function ChainDrawer({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const chain = row?.chain ?? null;
  const ref = useRef<HTMLElement>(null);
  const key = chain ? `${chain.model}|${chain.component}` : null;
  // On a phone the drawer sits below the list, so bring it into view when a component is picked.
  useEffect(() => {
    if (key) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [key]);

  if (!chain) {
    return <aside className="drawer drawer-empty">Select a component to follow its chain to the country.</aside>;
  }

  const mappedTiers = chain.tiers.filter(t => t.links.some(isMapped));
  const gapTiers = chain.tiers.filter(t => t.links.some(l => !isMapped(l)));
  const last = mappedTiers.at(-1);
  const ends = last ? [...new Set(last.links.filter(isMapped).map(l => countryName(l.supplier_country)))] : [];

  return (
    <aside ref={ref} className="drawer" aria-label={`Chain for ${chain.component}`} data-testid="chain">
      <div className="drawer-head">
        <h3>{label(chain.component)}</h3>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      {row?.state === 'not_researched' ? (
        <p className="note">Not researched: no record for this component yet. A gap in the data, not a safe result.</p>
      ) : mappedTiers.length === 0 ? (
        <p className="note">Unmapped: no reliable source found. Ask the vendor.</p>
      ) : (
        <>
          <ol className="tiers">
            {chain.tiers.map(t => (
              <li key={t.tier}>
                <h4>Tier {t.tier}</h4>
                <SupplierCards links={t.links} tier={t.tier} showTier={false} />
              </li>
            ))}
          </ol>
          <p className="ends">
            Chain ends in: <strong>{ends.join(' and ')}</strong>
            {gapTiers.length > 0 && <> (tier {last!.tier}). Tier {gapTiers[0].tier} is unmapped, so it may continue.</>}
          </p>
        </>
      )}
    </aside>
  );
}
