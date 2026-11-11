import type { ChainLink } from '../api';
import { countryName } from '../lib/countries';
import { SourceLink } from './SourceLink';
import { StatusBadge } from './StatusBadge';

/** A tier with nothing found. Grey, and never read as safe. */
export function UnmappedCard({ tier }: { tier: number }) {
  return (
    <div className="card card-unmapped" data-testid="unmapped-card">
      <strong>Tier {tier}: unmapped</strong>
      <span>No reliable source found. Ask the vendor.</span>
    </div>
  );
}

/** Suppliers of one tier, side by side. Several cards with conflict true are a disagreement. */
export function SupplierCards({ links, tier, showTier = true }: { links: ChainLink[]; tier: number; showTier?: boolean }) {
  return (
    <div className="cards">
      {links.map(l => l.confidence === 'unmapped' ? (
        <UnmappedCard key={l.id} tier={tier} />
      ) : (
        <div key={l.id} className={`card${l.confidence === 'low' ? ' card-low' : ''}`}>
          {showTier && <small className="tier-caption">Tier {tier}</small>}
          <strong>{l.supplier}</strong>
          <span>{countryName(l.supplier_country)}</span>
          {l.confidence === 'low' && <StatusBadge kind="low" />}
          <SourceLink url={l.source_url} />
        </div>
      ))}
    </div>
  );
}
