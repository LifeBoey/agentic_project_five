// Risk engine: pure functions over the links.json array. Each link's id is its array index.
import { readFile } from 'node:fs/promises';

export const LINKS_PATH = new URL('../data/links.json', import.meta.url);

export async function loadLinks(path = LINKS_PATH) {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('links.json must be an array');
  return raw.map((l, id) => ({ id, ...l }));
}

const isMapped = l => l.confidence !== 'unmapped';
const norm = s => String(s ?? '').trim().toUpperCase();
const linkOut = ({ id, supplier, supplier_country, source_url, confidence, conflict }) =>
  ({ id, supplier, supplier_country, source_url, confidence, conflict });

// Map of model -> Map of component -> links, in file order.
function group(links) {
  const models = new Map();
  for (const l of links) {
    if (!models.has(l.model)) models.set(l.model, new Map());
    const comps = models.get(l.model);
    if (!comps.has(l.component)) comps.set(l.component, []);
    comps.get(l.component).push(l);
  }
  return models;
}

// Everything the rules need for one component, read from its deepest mapped tier.
// Unknown components keep their unmapped records in `deep` so the agent can cite "unmapped" as evidence.
function assess(compLinks) {
  const mapped = compLinks.filter(isMapped);
  if (mapped.length === 0) return { unknown: true, deep: compLinks, countries: [], reasons: ['unknown'], low_confidence: false };
  const deepest = Math.max(...mapped.map(l => l.tier));
  const deep = mapped.filter(l => l.tier === deepest);
  const rawCountries = new Set(deep.map(l => norm(l.supplier_country)));
  const countries = [...rawCountries].filter(Boolean);
  const reasons = [];
  // A link with no country can't support a single-country claim.
  if (countries.length === 1 && !rawCountries.has('')) reasons.push('single_country');
  if (new Set(deep.map(l => norm(l.supplier))).size === 1) reasons.push('single_source');
  if (mapped.some(l => l.conflict)) reasons.push('conflict');
  return { unknown: false, deep, countries, reasons, low_confidence: deep.every(l => l.confidence === 'low') };
}

export const getModels = links => [...group(links).keys()];

function chokepoints(links) {
  // Keyed by normalised name so "NdMag Ltd" and "ndmag ltd " count as one supplier; shows the first spelling seen.
  const bySupplier = new Map();
  for (const l of links.filter(isMapped)) {
    const key = norm(l.supplier);
    if (!bySupplier.has(key)) bySupplier.set(key, { supplier: l.supplier, models: new Set() });
    bySupplier.get(key).models.add(l.model);
  }
  return [...bySupplier.values()].filter(s => s.models.size >= 2).map(s => ({ supplier: s.supplier, models: [...s.models] }));
}

export function getModelRisk(links, model) {
  const comps = group(links).get(model);
  if (!comps) return null;
  const counts = { single_country: 0, single_source: 0, unknown: 0, low_confidence: 0, conflicts: 0 };
  const flagged = [];
  for (const [component, compLinks] of comps) {
    const a = assess(compLinks);
    for (const r of a.reasons) counts[r === 'conflict' ? 'conflicts' : r]++;
    if (a.reasons.length) {
      if (a.low_confidence) counts.low_confidence++;
      flagged.push({ component, reasons: a.reasons, countries: a.countries, low_confidence: !!a.low_confidence, link_ids: a.deep.map(l => l.id) });
    }
  }
  return { model, counts, flagged, chokepoints: chokepoints(links).filter(c => c.models.includes(model)) };
}

export function getChain(links, model, component) {
  const compLinks = group(links).get(model)?.get(component);
  if (!compLinks) return null;
  const mapped = compLinks.filter(isMapped);
  // An unknown component shows its unmapped records, so the gap itself has a citable source.
  const shown = mapped.length ? mapped : compLinks;
  const tiers = [...new Set(shown.map(l => l.tier))].sort((a, b) => a - b)
    .map(tier => ({ tier, links: shown.filter(l => l.tier === tier).map(linkOut) }));
  return { model, component, status: mapped.length ? 'mapped' : 'unknown', tiers };
}

export function simulateCutoff(links, country) {
  const c = norm(country);
  const out = { country: c, affected: [], fully_blocked: [], unknown: [], models_affected: [] };
  for (const [model, comps] of group(links)) {
    for (const [component, compLinks] of comps) {
      const a = assess(compLinks);
      if (a.unknown) { out.unknown.push({ model, component, link_ids: a.deep.map(l => l.id) }); continue; }
      const hit = compLinks.filter(l => isMapped(l) && norm(l.supplier_country) === c);
      if (!hit.length) continue;
      out.affected.push({ model, component, link_ids: hit.map(l => l.id) });
      if (a.countries.length === 1 && a.countries[0] === c) out.fully_blocked.push({ model, component });
    }
  }
  out.models_affected = [...new Set(out.affected.map(x => x.model))];
  return out;
}
