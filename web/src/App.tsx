import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { useAsync } from './lib/useAsync';
import { isMapped } from './lib/rows';
import { loadDataset } from './lib/dataset';
import { adjacency, buildGraph } from './lib/graph';
import { AskBox } from './components/AskBox';
import { Logo } from './components/Logo';
import { ChainDrawer } from './components/ChainDrawer';
import { ChainGraph } from './components/ChainGraph';
import { ComponentList, type CutoffMarks } from './components/ComponentList';
import { CountryExposure } from './components/CountryExposure';
import { CutoffToggle } from './components/CutoffToggle';
import { GraphPanel } from './components/graph/GraphPanel';
import { ModelPicker } from './components/ModelPicker';
import { RiskBrief } from './components/RiskBrief';
import { RiskSummary } from './components/RiskSummary';
import { ViewTabs, type View } from './components/ViewTabs';

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
  const [view, setView] = useState<View>('graph');
  const [cutoffOn, setCutoffOn] = useState(false);
  const [country, setCountry] = useState('CN');

  useEffect(() => {
    if (models.data && model === null && models.data.length > 0) setModel(models.data[0]);
  }, [models.data, model]);

  // Every model is loaded once: the graph joins models through shared suppliers, and switching model is then instant.
  const dataset = useAsync(
    () => (models.data ? loadDataset(api, models.data) : Promise.resolve(null)),
    [models.data],
  );
  const current = dataset.data?.find(d => d.model === model) ?? null;
  const rows = current?.rows ?? null;
  const countriesSeen = useMemo(
    () => [...new Set((current?.chains ?? []).flatMap(c => c.tiers.flatMap(t => t.links.filter(isMapped).map(l => l.supplier_country))))],
    [current],
  );

  // Built once per data load, so node positions survive switching between the two views.
  const graph = useMemo(() => (dataset.data ? buildGraph(dataset.data) : null), [dataset.data]);
  const adj = useMemo(() => (graph ? adjacency(graph) : null), [graph]);

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
      {dataset.error && <ErrorPanel message={dataset.error} onRetry={dataset.retry} />}

      {model && current && (
        <>
          <div className="hero">
            <p className="hero-model">{model}</p>
            <RiskSummary risk={current.risk} notResearched={notResearched} />
            {rows && <CountryExposure rows={rows} onSimulate={simulate} />}
          </div>
          <CutoffToggle
            on={cutoffOn} country={country} countries={countriesSeen} model={model} notResearched={notResearched} result={cutoff.data} error={cutoff.error}
            onToggle={setCutoffOn} onCountry={setCountry}
          />
          <ViewTabs view={view} onChange={setView} />
          <div id="view-panel" role="tabpanel" aria-labelledby={`tab-${view}`}>
            {view === 'graph' && graph && adj && dataset.data && (
              <GraphPanel
                graph={graph} adj={adj} dataset={dataset.data} model={model}
                cutoffOn={cutoffOn} cutoff={cutoff.data}
                onCutoff={simulate}
              />
            )}
            {view === 'chains' && rows && (
              <>
                <ChainGraph model={model} rows={rows} cutoff={marks} cutoffCountry={cutoffOn ? country : null} selected={selected} onSelect={setSelected} />
                <div className="layout">
                  <ComponentList rows={rows} selected={selected} onSelect={setSelected} cutoff={marks} />
                  <ChainDrawer row={selectedRow} onClose={() => setSelected(null)} />
                </div>
              </>
            )}
          </div>
        </>
      )}
      {(models.loading || dataset.loading) && !models.error && !dataset.error && <p className="note">Loading…</p>}

      <div className="footer-grid">
        {model && current && <RiskBrief model={model} />}
        <AskBox />
      </div>
    </main>
  );
}
