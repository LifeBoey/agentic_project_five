import type { ChainLink } from '../api';
import { countryName } from '../lib/countries';
import { SourceLink } from './SourceLink';
import { StatusBadge } from './StatusBadge';

const tierLabel = (tier: number, part?: string) => `Tier ${tier}${part ? ` · ${part}` : ''}`;

/** A tier with nothing found. Hatched like uncharted ground, and never read as safe. */
export function UnmappedCard({ tier, part }: { tier: number; part?: string }) {
  return (
    <div className="card card-unmapped" data-testid="unmapped-card">
      <strong>{tierLabel(tier, part)}: unmapped</strong>
      <span>No reliable source found. Ask the vendor.</span>
    </div>
  );
}

// Several sources naming the same supplier, country and confidence are one claim with more evidence:
// show one card with every source. Different suppliers stay side by side, so a disagreement stays visible.
function groupClaims(links: ChainLink[]): ChainLink[][] {
  const groups = new Map<string, ChainLink[]>();
  for (const l of links) {
    const key = l.confidence === 'unmapped' ? `u${l.id}` : `${l.supplier}|${l.supplier_country}|${l.confidence}|${l.part ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  return [...groups.values()];
}

/** Suppliers of one tier, side by side. Several cards with conflict true are a disagreement. */
export function SupplierCards({ links, tier, showTier = true }: { links: ChainLink[]; tier: number; showTier?: boolean }) {
  return (
    <div className="cards">
      {groupClaims(links).map(group => {
        const [l] = group;
        if (l.confidence === 'unmapped') return <UnmappedCard key={l.id} tier={tier} part={l.part} />;
        return (
          <div key={l.id} className={`card${l.confidence === 'low' ? ' card-low' : ''}`}>
            {showTier && <small className="tier-caption">{tierLabel(tier, l.part)}</small>}
            <strong className="card-supplier">{l.supplier}</strong>
            <span className="card-country">{countryName(l.supplier_country)}</span>
            {l.confidence === 'low' && <StatusBadge kind="low" />}
            <span className="card-sources">
              {group.length === 1
                ? <SourceLink url={l.source_url} />
                : group.map((g, i) => <SourceLink key={g.id} url={g.source_url}>Source {i + 1}</SourceLink>)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
