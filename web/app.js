// shortcut: shows the first model and only its flagged components; Role 3 adds the model picker and full component list.
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
// Only allow http(s) links: source URLs come from research output.
const safeUrl = u => (/^https?:\/\//i.test(u) ? u : '#');
const api = async path => {
  const r = await fetch(`/api/${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
};

function renderComponent(f, chain) {
  if (chain.status === 'unknown') {
    return `<li class="unmapped">${esc(f.component)}: Unmapped, no reliable source found. Ask the vendor.</li>`;
  }
  const tiers = chain.tiers.map(t => `<div class="tier">${t.links.map(l =>
    `<a class="source ${l.confidence === 'low' ? 'low' : ''}" href="${esc(safeUrl(l.source_url))}" target="_blank" rel="noopener">
      T${esc(t.tier)}: ${esc(l.supplier)} (${esc(l.supplier_country)})</a>`).join('')}</div>`).join('');
  const single = f.reasons.includes('single_country');
  return `<li class="${single ? 'single' : ''}">${esc(f.component)} <small>${esc(f.reasons.join(', '))}</small>${tiers}</li>`;
}

try {
  const [model] = await api('models');
  if (!model) throw new Error('no models in links.json');
  const m = encodeURIComponent(model);
  const risk = await api(`models/${m}/risk`);
  const chains = await Promise.all(risk.flagged.map(f => api(`models/${m}/chain/${encodeURIComponent(f.component)}`)));
  const n = risk.counts.single_country;
  document.getElementById('model').textContent = model;
  document.getElementById('summary').textContent = `${n} component${n === 1 ? '' : 's'} depend${n === 1 ? 's' : ''} on a single country`;
  document.getElementById('components').innerHTML = risk.flagged.map((f, i) => renderComponent(f, chains[i])).join('');
} catch (e) {
  document.getElementById('model').textContent = 'Could not load the map';
  document.getElementById('summary').textContent = e.message;
}
