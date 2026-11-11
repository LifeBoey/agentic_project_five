import type { Cutoff } from '../api';
import { COUNTRIES, countryName, label } from '../lib/countries';

type Props = {
  on: boolean;
  country: string;
  countries: string[];
  model: string;
  /** Expected components with no record: they cannot be assessed, so they are unknown, never unaffected. */
  notResearched: string[];
  result: Cutoff | null;
  error: string | null;
  onToggle: (on: boolean) => void;
  onCountry: (code: string) => void;
};

export function CutoffToggle({ on, country, countries, model, notResearched, result, error, onToggle, onCountry }: Props) {
  const codes = [...new Set([...Object.keys(COUNTRIES), ...countries])];
  return (
    <section aria-label="Country cut-off" className="cutoff">
      <label className="toggle">
        <input type="checkbox" checked={on} onChange={e => onToggle(e.target.checked)} />
        <span>What if {countryName(country)} is cut off?</span>
      </label>
      <label className="picker picker-inline">
        <span aria-hidden="true">Country</span>
        <select aria-label="Cut-off country" value={country} onChange={e => onCountry(e.target.value)}>
          {codes.map(code => <option key={code} value={code}>{countryName(code)}</option>)}
        </select>
      </label>
      {on && error && <p role="alert" className="error">Could not simulate the cut-off: {error}</p>}
      {on && result && (
        <div data-testid="cutoff-result">
          {result.models_affected.length === 0 ? (
            <p>No mapped component depends on {countryName(country)}.</p>
          ) : (
            <ul>
              {result.models_affected.map(m => {
                const hit = result.affected.filter(a => a.model === m).length;
                const blocked = result.fully_blocked.filter(b => b.model === m).length;
                return <li key={m}>{m}: {hit} {hit === 1 ? 'component' : 'components'} affected, {blocked} fully blocked</li>;
              })}
            </ul>
          )}
          {(result.unknown.length > 0 || notResearched.length > 0) && (
            <div data-testid="cutoff-unknown">
              <p><strong>Unknown, not counted as unaffected:</strong> these have unmapped tiers or no record, so they may also depend on {countryName(country)}.</p>
              <ul>
                {result.unknown.map(u => <li key={`${u.model}|${u.component}`}>{u.model}: {label(u.component)}</li>)}
                {notResearched.map(c => <li key={`nr|${c}`}>{model}: {label(c)} (not researched)</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
