import { useState } from 'react';
import { api, ApiError, NO_DATA_ANSWER, type AskResult } from '../api';
import { label } from '../lib/countries';
import { SourceLink } from './SourceLink';

function describeError(e: unknown): string {
  if (e instanceof ApiError && e.status === 503) return 'The question box is not set up on this server (no API key configured).';
  if (e instanceof ApiError && e.status === 502) return 'The query agent failed. Try again.';
  return `Could not get an answer: ${e instanceof Error ? e.message : String(e)}`;
}

export function AskBox() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.ask(q.trim()));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Ask a question" className="ask">
      <form onSubmit={submit}>
        <label htmlFor="ask-input">Ask about the map</label>
        <div className="ask-row">
          <input id="ask-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Which models depend only on China for magnets?" />
          <button type="submit" disabled={busy || !q.trim()}>{busy ? 'Asking…' : 'Ask'}</button>
        </div>
      </form>
      {busy && <p role="status" className="note" data-testid="ask-loading">Checking the data. This can take up to 10 seconds.</p>}
      {error && <p role="alert" className="error" data-testid="ask-error">{error}</p>}
      {result && (
        // The no-data answer is a normal answer, not an error: the map simply has nothing to say.
        <div className="answer" data-testid="answer" data-refused={result.answer === NO_DATA_ANSWER}>
          <p>{result.answer}</p>
          {result.links.length > 0 && (
            <ul aria-label="Sources used">
              {result.links.map(l => (
                <li key={l.id}>
                  {label(l.component)} in {l.model}, tier {l.tier}:{' '}
                  {l.confidence === 'unmapped'
                    ? <span className="source-missing">unmapped (searched, nothing found)</span>
                    : <SourceLink url={l.source_url}>{l.supplier} ({l.supplier_country})</SourceLink>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
