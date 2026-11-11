import type { ChainLink } from '../api';
import { countryName } from '../lib/countries';
import { SourceLink } from './SourceLink';
import { StatusBadge } from './StatusBadge';

const tierLabel = (tier: number, part?: string) => `Tier ${tier}${part ? ` · ${part}` : ''}`;

/** A tier with nothing found. Grey, and never read as safe. */
export function UnmappedCard({ tier, part }: { tier: number; part?: string }) {
  return (
    <div className="card card-unmapped" data-testid="unmapped-card">
      <strong>{tierLabel(tier, part)}: unmapped</strong>
      <span>No reliable source found. Ask the vendor.</span>
    </div>
  );
}

/** Suppliers of one tier, side by side. Several cards with conflict true are a disagreement. */
export function SupplierCards({ links, tier, showTier = true }: { links: ChainLink[]; tier: number; showTier?: boolean }) {
  return (
    <div className="cards">
      {links.map(l => l.confidence === 'unmapped' ? (
        <UnmappedCard key={l.id} tier={tier} part={l.part} />
      ) : (
        <div key={l.id} className={`card${l.confidence === 'low' ? ' card-low' : ''}`}>
          {showTier && <small className="tier-caption">{tierLabel(tier, l.part)}</small>}
          <strong>{l.supplier}</strong>
          <span>{countryName(l.supplier_country)}</span>
          {l.confidence === 'low' && <StatusBadge kind="low" />}
          <SourceLink url={l.source_url} />
        </div>
      ))}
    </div>
  );
}
