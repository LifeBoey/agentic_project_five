import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { useAsync } from './lib/useAsync';
import { buildRows, isMapped } from './lib/rows';
import { AskBox } from './components/AskBox';
import { Logo } from './components/Logo';
import { ChainDrawer } from './components/ChainDrawer';
import { ChainGraph } from './components/ChainGraph';
import { ComponentList, type CutoffMarks } from './components/ComponentList';
import { CountryExposure } from './components/CountryExposure';
import { CutoffToggle } from './components/CutoffToggle';
import { ModelPicker } from './components/ModelPicker';
import { RiskBrief } from './components/RiskBrief';
import { RiskSummary } from './components/RiskSummary';

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="error panel">
      <p>Could not load the data: {message}</p>
      <button type="button" onClick={onRetry}>Try again</button>
    </div>
  );
}

export default function App() {
  const models = useAsync(() => api.get_models(), []);
  const [model, setModel] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cutoffOn, setCutoffOn] = useState(false);
  const [country, setCountry] = useState('CN');

  useEffect(() => {
    if (models.data && model === null && models.data.length > 0) setModel(models.data[0]);
  }, [models.data, model]);

  const risk = useAsync(() => (model ? api.get_model_risk(model) : Promise.resolve(null)), [model]);

  // One chain per component, so every row shows its suppliers and sources without a click.
  const chains = useAsync(async () => {
    if (!model || !risk.data || risk.data.model !== model) return null;
    return Promise.all(risk.data.components.map(c => api.get_chain(model, c)));
  }, [model, risk.data]);

  const rows = useMemo(
    () => (risk.data && chains.data ? buildRows(risk.data, chains.data) : null),
    [risk.data, chains.data],
  );
  const countriesSeen = useMemo(
    () => [...new Set((chains.data ?? []).flatMap(c => c.tiers.flatMap(t => t.links.filter(isMapped).map(l => l.supplier_country))))],
    [chains.data],
  );

  const cutoff = useAsync(() => (cutoffOn ? api.simulate_cutoff(country) : Promise.resolve(null)), [cutoffOn, country]);
  const marks = useMemo<CutoffMarks | null>(() => {
    if (!cutoffOn || !cutoff.data) return null;
    const mine = (xs: { model: string; component: string }[]) => new Set(xs.filter(x => x.model === model).map(x => x.component));
    return { affected: mine(cutoff.data.affected), blocked: mine(cutoff.data.fully_blocked), unknown: mine(cutoff.data.unknown) };
  }, [cutoffOn, cutoff.data, model]);

  const pickModel = (m: string) => { setModel(m); setSelected(null); };
  const selectedRow = rows?.find(r => r.name === selected) ?? null;
  const notResearched = useMemo(() => (rows ?? []).filter(r => r.state === 'not_researched').map(r => r.name), [rows]);
  const simulate = (code: string) => {
    setCountry(code);
    setCutoffOn(true);
    document.getElementById('cutoff')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <main>
      <header className="top">
        <h1 className="brand">
          <Logo />
          <span>Drone dependency map</span>
        </h1>
        {models.data && model && <ModelPicker models={models.data} value={model} onChange={pickModel} />}
      </header>

      {models.error && <ErrorPanel message={models.error} onRetry={models.retry} />}
      {models.data?.length === 0 && <p className="panel">The graph has no drone models yet.</p>}
      {risk.error && <ErrorPanel message={risk.error} onRetry={risk.retry} />}
      {chains.error && <ErrorPanel message={chains.error} onRetry={chains.retry} />}

      {model && risk.data && (
        <>
          <div className="hero">
            <p className="hero-model">{model}</p>
            <RiskSummary risk={risk.data} notResearched={notResearched} />
            {rows && <CountryExposure rows={rows} onSimulate={simulate} />}
          </div>
          <CutoffToggle
            on={cutoffOn} country={country} countries={countriesSeen} model={model} notResearched={notResearched} result={cutoff.data} error={cutoff.error}
            onToggle={setCutoffOn} onCountry={setCountry}
          />
          {rows && (
            <ChainGraph model={model} rows={rows} cutoff={marks} cutoffCountry={cutoffOn ? country : null} selected={selected} onSelect={setSelected} />
          )}
          {rows && (
            <div className="layout">
              <ComponentList rows={rows} selected={selected} onSelect={setSelected} cutoff={marks} />
              <ChainDrawer row={selectedRow} onClose={() => setSelected(null)} />
            </div>
          )}
        </>
      )}
      {(models.loading || risk.loading || (risk.data && chains.loading)) && !models.error && !risk.error && !chains.error && (
        <p className="note">Loading…</p>
      )}

      <div className="footer-grid">
        {model && risk.data && <RiskBrief model={model} />}
        <AskBox />
      </div>
    </main>
  );
}
