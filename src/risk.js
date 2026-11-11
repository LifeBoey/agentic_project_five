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
function assess(compLinks) {
  const mapped = compLinks.filter(isMapped);
  if (mapped.length === 0) return { unknown: true, deep: [], countries: [], reasons: ['unknown'] };
  const deepest = Math.max(...mapped.map(l => l.tier));
  const deep = mapped.filter(l => l.tier === deepest);
  const countries = [...new Set(deep.map(l => norm(l.supplier_country)))];
  const suppliers = new Set(deep.map(l => l.supplier));
  const reasons = [];
  if (countries.length === 1) reasons.push('single_country');
  if (suppliers.size === 1) reasons.push('single_source');
  if (compLinks.some(l => l.conflict)) reasons.push('conflict');
  return { unknown: false, deep, countries, reasons, low_confidence: deep.every(l => l.confidence === 'low') };
}

export const getModels = links => [...group(links).keys()];

function chokepoints(links) {
  const bySupplier = new Map();
  for (const l of links.filter(isMapped)) {
    if (!bySupplier.has(l.supplier)) bySupplier.set(l.supplier, new Set());
    bySupplier.get(l.supplier).add(l.model);
  }
  return [...bySupplier].filter(([, m]) => m.size >= 2).map(([supplier, m]) => ({ supplier, models: [...m] }));
}

export function getModelRisk(links, model) {
  const comps = group(links).get(model);
  if (!comps) return null;
  const counts = { single_country: 0, single_source: 0, unknown: 0, low_confidence: 0, conflicts: 0 };
  const flagged = [];
  for (const [component, compLinks] of comps) {
    const a = assess(compLinks);
    for (const r of a.reasons) counts[r === 'conflict' ? 'conflicts' : r]++;
    if (a.low_confidence) counts.low_confidence++;
    if (a.reasons.length) {
      flagged.push({ component, reasons: a.reasons, countries: a.countries, low_confidence: !!a.low_confidence, link_ids: a.deep.map(l => l.id) });
    }
  }
  return { model, counts, flagged, chokepoints: chokepoints(links).filter(c => c.models.includes(model)) };
}

export function getChain(links, model, component) {
  const compLinks = group(links).get(model)?.get(component);
  if (!compLinks) return null;
  const mapped = compLinks.filter(isMapped);
  const tiers = [...new Set(mapped.map(l => l.tier))].sort((a, b) => a - b)
    .map(tier => ({ tier, links: mapped.filter(l => l.tier === tier).map(linkOut) }));
  return { model, component, status: mapped.length ? 'mapped' : 'unknown', tiers };
}

export function simulateCutoff(links, country) {
  const c = norm(country);
  const out = { country: c, affected: [], fully_blocked: [], unknown: [], models_affected: [] };
  for (const [model, comps] of group(links)) {
    for (const [component, compLinks] of comps) {
      const a = assess(compLinks);
      if (a.unknown) { out.unknown.push({ model, component }); continue; }
      const hit = compLinks.filter(l => isMapped(l) && norm(l.supplier_country) === c);
      if (!hit.length) continue;
      out.affected.push({ model, component, link_ids: hit.map(l => l.id) });
      if (a.countries.length === 1 && a.countries[0] === c) out.fully_blocked.push({ model, component });
    }
  }
  out.models_affected = [...new Set(out.affected.map(x => x.model))];
  return out;
}
