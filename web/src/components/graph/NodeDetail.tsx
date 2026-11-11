import type { ModelData } from '../../lib/dataset';
import { countryName, label } from '../../lib/countries';
import type { GraphNode } from '../../lib/graph';
import { TYPE_LABEL } from '../../lib/graphStyle';
import { ChainDrawer } from '../ChainDrawer';
import { SourceLink } from '../SourceLink';
import { StatusBadge } from '../StatusBadge';

type Props = {
  node: GraphNode;
  dataset: ModelData[];
  onClose: () => void;
  /** Turn on the cut-off simulation for a country. */
  onCutoff: (country: string) => void;
};

function Shell({ node, onClose, children }: { node: GraphNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside className="drawer" aria-label={`${TYPE_LABEL[node.type]}: ${node.label}`} data-testid="node-detail">
      <div className="drawer-head">
        <h3>{node.type === 'country' ? countryName(node.label) : label(node.label)}</h3>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <p className="note">{TYPE_LABEL[node.type]}</p>
      {children}
    </aside>
  );
}

/** What the selected node is, and the sources behind it. A component opens the same chain as the list view. */
export function NodeDetail({ node, dataset, onClose, onCutoff }: Props) {
  if (node.type === 'component' && node.row) return <ChainDrawer row={node.row} onClose={onClose} />;

  if (node.type === 'model') {
    const risk = dataset.find(d => d.model === node.model)?.risk;
    const c = risk?.counts;
    return (
      <Shell node={node} onClose={onClose}>
        {c && (
          <ul className="counts">
            <li>{c.single_country} {c.single_country === 1 ? 'component depends' : 'components depend'} on a single country</li>
            <li>{c.unknown} unmapped or partly unmapped (never shown as safe)</li>
            <li>{c.low_confidence} with low confidence, {c.conflicts} with conflicting sources</li>
          </ul>
        )}
        <p className="note">Select one of its components to follow the chain to the country.</p>
      </Shell>
    );
  }

  if (node.type === 'supplier') {
    return (
      <Shell node={node} onClose={onClose}>
        <div className="badges">
          {node.country && <span className="badge badge-supplier">{countryName(node.country)}</span>}
          {node.flags.lowConfidence && <StatusBadge kind="low" />}
          {node.flags.conflict && <StatusBadge kind="conflict" />}
          {node.models.length > 1 && <span className="badge badge-single">Shared by {node.models.length} models</span>}
        </div>
        <h4>Supplies</h4>
        <ul className="source-list">
          {node.sources.map((s, i) => (
            <li key={i}>
              {label(s.component)} of {s.model}, tier {s.tier}{s.part ? ` · ${s.part}` : ''}
              {s.confidence === 'low' && <> (low confidence)</>}{' '}
              <SourceLink url={s.url} />
            </li>
          ))}
        </ul>
      </Shell>
    );
  }

  if (node.type === 'unmapped') {
    return (
      <Shell node={node} onClose={onClose}>
        <p className="note">
          No reliable source found{node.part ? ` for ${node.part.toLowerCase()}` : ''} at tier {node.tier} of {label(node.component ?? '')} in {node.model}.
          This is a gap, not a safe result. Ask the vendor.
        </p>
      </Shell>
    );
  }

  // Country: who depends on it, and a shortcut to the cut-off simulation.
  const code = node.country ?? node.label;
  const reliant = dataset.flatMap(d => d.rows
    .filter(r => r.state === 'red' && r.countries.map(c => c.toUpperCase()).includes(code.toUpperCase()))
    .map(r => `${label(r.name)} of ${d.model}`));
  return (
    <Shell node={node} onClose={onClose}>
      {reliant.length > 0 ? (
        <>
          <p className="note">Every deepest-tier supplier of these is in {countryName(code)}:</p>
          <ul className="source-list">{reliant.map(r => <li key={r}>{r}</li>)}</ul>
        </>
      ) : (
        <p className="note">No component depends only on {countryName(code)}.</p>
      )}
      <button type="button" className="primary" onClick={() => onCutoff(code)}>
        What if {countryName(code)} is cut off?
      </button>
    </Shell>
  );
}
