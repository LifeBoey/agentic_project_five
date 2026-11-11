export type View = 'graph' | 'chains';

const TABS: { id: View; label: string }[] = [
  { id: 'graph', label: 'Graph' },
  { id: 'chains', label: 'Chains and list' },
];

/** Graph for the shape of the dependencies across models; Chains and list for one model's tiers and every component with its sources. */
export function ViewTabs({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  function onKey(e: React.KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id;
    onChange(next);
    document.getElementById(`tab-${next}`)?.focus();
  }
  return (
    <div className="tabs" role="tablist" aria-label="View">
      {TABS.map((t, i) => (
        <button
          key={t.id}
          id={`tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={view === t.id}
          aria-controls="view-panel"
          tabIndex={view === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={e => onKey(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
