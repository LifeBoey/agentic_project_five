import { countryName, label } from '../lib/countries';
import type { Row } from '../lib/rows';

/** Single-country components grouped by the country they depend on, each a one-click cut-off scenario. */
export function CountryExposure({ rows, onSimulate }: { rows: Row[]; onSimulate: (code: string) => void }) {
  const byCountry = new Map<string, string[]>();
  for (const r of rows) {
    if (r.state !== 'red') continue;
    for (const c of r.countries) byCountry.set(c, [...(byCountry.get(c) ?? []), r.name]);
  }
  if (byCountry.size === 0) return null;
  const ordered = [...byCountry].sort((a, b) => b[1].length - a[1].length);

  return (
    <section aria-label="Single-country dependencies by country" className="exposure">
      <ul>
        {ordered.map(([code, parts]) => (
          <li key={code} className="exposure-item">
            <span className="exposure-country">{countryName(code)}</span>
            <span className="exposure-parts">{parts.map(label).join(', ')}</span>
            <button type="button" className="exposure-action" onClick={() => onSimulate(code)} aria-label={`Simulate a ${countryName(code)} cut-off`}>
              Simulate cut-off
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
