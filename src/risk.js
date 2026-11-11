// Risk engine: pure functions over the links.json array. Each link's id is its array index.
import { readFile } from 'node:fs/promises';

const LINKS_PATH = new URL('../data/links.json', import.meta.url);

// Tests pass their fixture path; the server uses Role 1's real data.
export const loadLinks = async (path = LINKS_PATH) => parseLinks(JSON.parse(await readFile(path, 'utf8')));

const CONFIDENCE = ['high', 'low', 'unmapped'];
const MAX_REPORTED = 10;

// Rejects the whole file on any bad record: skipping one could silently make a component look safe.
export function parseLinks(raw) {
  if (!Array.isArray(raw)) throw new Error('links.json must be an array of records');
  const problems = raw.flatMap((l, i) => recordProblems(l).map(p => `record ${i}${where(l)}: ${p}`));
  if (problems.length) {
    const more = problems.length > MAX_REPORTED ? ` (and ${problems.length - MAX_REPORTED} more)` : '';
    throw new Error(`${problems.slice(0, MAX_REPORTED).join('; ')}${more}`);
  }
  return raw.map((l, id) => ({ id, ...l }));
}

const where = l => (l && typeof l === 'object' && l.model ? ` (${l.model} / ${l.component})` : '');
const isText = v => typeof v === 'string';

function recordProblems(l) {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return ['must be an object'];
  const p = [];
  for (const k of ['model', 'component']) if (!isText(l[k]) || !l[k].trim()) p.push(`${k} must be a non-empty string`);
  for (const k of ['supplier', 'supplier_country', 'source_url']) if (!isText(l[k])) p.push(`${k} must be a string`);
  if (!Number.isInteger(l.tier) || l.tier < 1) p.push('tier must be a whole number from 1');
  if (!CONFIDENCE.includes(l.confidence)) p.push(`confidence must be one of ${CONFIDENCE.join(', ')}`);
  if (typeof l.conflict !== 'boolean') p.push('conflict must be true or false');
  // A mapped link is a claim, so it needs a supplier and a source a reader can open.
  if (l.confidence === 'high' || l.confidence === 'low') {
    if (isText(l.supplier) && !l.supplier.trim()) p.push('a mapped link needs a supplier');
    if (isText(l.source_url) && !/^https?:\/\//i.test(l.source_url)) p.push('a mapped link needs an http(s) source_url');
  }
  return p;
}

const isMapped = l => l.confidence !== 'unmapped';
const norm = s => String(s ?? '').trim().toUpperCase();
// `part` is Role 1's optional sub-tier label (e.g. "Magnets"); undefined drops out of the JSON when absent.
const linkOut = ({ id, supplier, supplier_country, source_url, confidence, conflict, part }) =>
  ({ id, supplier, supplier_country, source_url, confidence, conflict, part });
// Reason names are singular; the README's count keys pluralise only this one.
const COUNT_KEY = { conflict: 'conflicts' };

// Map of model -> Map of component -> links, in file order.
const group = links =>
  new Map([...Map.groupBy(links, l => l.model)].map(([model, ls]) => [model, Map.groupBy(ls, l => l.component)]));

// The verdict for one component, read from its deepest mapped tier.
function assess(compLinks) {
  const mapped = compLinks.filter(isMapped);
  const deepest = Math.max(...mapped.map(l => l.tier)); // -Infinity when nothing is mapped
  const deep = mapped.filter(l => l.tier === deepest);
  // Unmapped records that decide the verdict: all of them when nothing is mapped,
  // otherwise those searched below the deepest mapped tier (the deeper truth is unknown).
  const gaps = compLinks.filter(l => !isMapped(l) && l.tier > deepest);
  const rawCountries = new Set(deep.map(l => norm(l.supplier_country)));
  const countries = [...rawCountries].filter(Boolean);
  const reasons = [];
  // A link with no country can't support a single-country claim.
  if (countries.length === 1 && !rawCountries.has('')) reasons.push('single_country');
  if (new Set(deep.map(l => norm(l.supplier))).size === 1) reasons.push('single_source');
  if (mapped.some(l => l.conflict)) reasons.push('conflict');
  if (gaps.length) reasons.push('unknown');
  return {
    mapped, gaps, countries, reasons,
    low_confidence: deep.length > 0 && deep.every(l => l.confidence === 'low'),
    cite: [...deep, ...gaps], // ids backing the verdict, so the agent can cite a gap too
  };
}

export const getModels = links => [...new Set(links.map(l => l.model))];

function chokepoints(links) {
  // Grouped by normalised name so "NdMag Ltd" and "ndmag ltd " count as one supplier; shows the first spelling seen.
  return [...Map.groupBy(links.filter(isMapped), l => norm(l.supplier)).values()]
    .map(ls => ({ supplier: ls[0].supplier, models: [...new Set(ls.map(l => l.model))] }))
    .filter(s => s.models.length >= 2);
}

export function getModelRisk(links, model) {
  const comps = group(links).get(model);
  if (!comps) return null;
  const counts = { single_country: 0, single_source: 0, unknown: 0, low_confidence: 0, conflicts: 0 };
  const flagged = [];
  for (const [component, compLinks] of comps) {
    const verdict = assess(compLinks);
    if (!verdict.reasons.length) continue;
    for (const r of verdict.reasons) counts[COUNT_KEY[r] ?? r]++;
    if (verdict.low_confidence) counts.low_confidence++;
    flagged.push({ component, reasons: verdict.reasons, countries: verdict.countries, low_confidence: verdict.low_confidence, link_ids: verdict.cite.map(l => l.id) });
  }
  // components lists every component of the model, flagged or not, so a viewer can show unflagged ones too.
  return { model, counts, components: [...comps.keys()], flagged, chokepoints: chokepoints(links).filter(c => c.models.includes(model)) };
}

export function getChain(links, model, component) {
  const compLinks = group(links).get(model)?.get(component);
  if (!compLinks) return null;
  const verdict = assess(compLinks);
  // Unmapped records are shown where they decide the verdict, so the gap itself has a citable source.
  const byTier = Map.groupBy([...verdict.mapped, ...verdict.gaps], l => l.tier);
  const tiers = [...byTier.keys()].sort((x, y) => x - y).map(tier => ({ tier, links: byTier.get(tier).map(linkOut) }));
  return { model, component, status: verdict.mapped.length ? 'mapped' : 'unknown', tiers };
}

export function simulateCutoff(links, country) {
  const c = norm(country);
  const out = { country: c, affected: [], fully_blocked: [], unknown: [], models_affected: [] };
  for (const [model, comps] of group(links)) {
    for (const [component, compLinks] of comps) {
      const verdict = assess(compLinks);
      const hit = verdict.mapped.filter(l => norm(l.supplier_country) === c);
      if (!hit.length) {
        // Nothing mapped there, but an unknown tier could be: never report it as safe.
        if (verdict.gaps.length) out.unknown.push({ model, component, link_ids: verdict.cite.map(l => l.id) });
        continue;
      }
      out.affected.push({ model, component, link_ids: hit.map(l => l.id) });
      if (verdict.countries.length === 1 && verdict.countries[0] === c) out.fully_blocked.push({ model, component });
    }
  }
  out.models_affected = [...new Set(out.affected.map(x => x.model))];
  return out;
}
