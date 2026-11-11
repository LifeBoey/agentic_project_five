import type { ModelRisk } from '../api';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function RiskSummary({ risk, notResearched }: { risk: ModelRisk; notResearched: string[] }) {
  const { counts } = risk;
  const shared = risk.chokepoints.map(c => ({ supplier: c.supplier, others: c.models.filter(m => m !== risk.model) }));
  return (
    <section aria-label="Risk summary" className="summary">
      <h2 className={counts.single_country > 0 ? 'risk' : undefined} data-testid="headline">
        {counts.single_country} {plural(counts.single_country, 'component depends', 'components depend')} on a single country
      </h2>
      <ul className="counts">
        <li data-testid="count-unknown">{counts.unknown} unmapped or partly unmapped (never shown as safe)</li>
        <li data-testid="count-not-researched">{notResearched.length} not researched (no record yet, never shown as safe)</li>
        <li data-testid="count-low">{counts.low_confidence} with low confidence</li>
        <li data-testid="count-conflict">{counts.conflicts} with conflicting sources</li>
        <li data-testid="count-supplier">{counts.single_source} with a single supplier</li>
        <li data-testid="count-total">{risk.components.length + notResearched.length} components in total</li>
      </ul>
      {shared.length > 0 && (
        <p className="shared" data-testid="chokepoints">
          Suppliers shared with other models: {shared.map(s => `${s.supplier} (also ${s.others.join(', ')})`).join('; ')}
        </p>
      )}
    </section>
  );
}
