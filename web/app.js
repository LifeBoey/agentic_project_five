// shortcut: one hard-coded model; add a model picker when there is a second model.
const MODEL_URL = '../data/models/example.json';

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
// Only allow http(s) links: source URLs come from research output.
const safeUrl = u => (/^https?:\/\//i.test(u) ? u : '#');

export const isUnmapped = c => c.chain.length === 0;
export const isSingleCountry = c =>
  !isUnmapped(c) && new Set(c.chain.at(-1).sources.map(s => s.country)).size === 1;

function renderComponent(c) {
  if (isUnmapped(c)) {
    return `<li class="unmapped">${esc(c.name)}: Unmapped, no reliable source found. Ask the vendor.</li>`;
  }
  const tiers = c.chain.map(t => `<div class="tier">${t.sources.map(s =>
    `<a class="source ${s.confidence === 'low' ? 'low' : ''}" href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">
      T${esc(t.tier)}${t.part ? ` ${esc(t.part)}` : ''}: ${esc(s.supplier)} (${esc(s.country)})</a>`).join('')}</div>`).join('');
  return `<li class="${isSingleCountry(c) ? 'single' : ''}">${esc(c.name)}${tiers}</li>`;
}

const data = await (await fetch(MODEL_URL)).json();
const single = data.components.filter(isSingleCountry).length;
document.getElementById('model').textContent = data.model;
document.getElementById('summary').textContent =
  `${single} component${single === 1 ? '' : 's'} depend${single === 1 ? 's' : ''} on a single country`;
document.getElementById('components').innerHTML = data.components.map(renderComponent).join('');
