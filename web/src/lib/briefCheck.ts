import type { Chain, Cutoff, ModelRisk, Reason } from '../api';
import { buildRows } from './rows';

// Facts handed to the brief-writing agent, and the checks its paragraph must pass.
// The agent sees only these facts, and the paragraph is rejected if it strays from them.

export interface BriefFacts {
  model: string;
  counts: ModelRisk['counts'];
  total_components: number;
  components: {
    name: string;
    status: 'unmapped' | 'partly_unmapped' | 'not_researched' | 'mapped';
    reasons: Reason[];
    countries: string[];
    low_confidence: boolean;
    tiers: { tier: number; part?: string; suppliers: string[]; unmapped: boolean }[];
  }[];
  shared_suppliers: { supplier: string; also_in: string[] }[];
  cutoffs: { country: string; affected: string[]; fully_blocked: string[]; unknown: string[] }[];
}

export function buildFacts(risk: ModelRisk, chains: Chain[], cutoffs: Cutoff[]): BriefFacts {
  const mine = (xs: { model: string; component: string }[]) => xs.filter(x => x.model === risk.model).map(x => x.component);
  const rows = buildRows(risk, chains);
  return {
    model: risk.model,
    counts: risk.counts,
    total_components: rows.length,
    components: rows.map(r => ({
      name: r.name,
      status: r.state === 'not_researched' ? 'not_researched' : r.state === 'unknown' ? 'unmapped' : r.partlyUnknown ? 'partly_unmapped' : 'mapped',
      reasons: risk.flagged.find(f => f.component === r.name)?.reasons ?? [],
      countries: r.countries,
      low_confidence: r.lowConfidence,
      tiers: r.chain.tiers.map(t => ({
        tier: t.tier,
        part: t.links.find(l => l.part)?.part,
        suppliers: t.links.filter(l => l.confidence !== 'unmapped').map(l => `${l.supplier} (${l.supplier_country})`),
        unmapped: t.links.some(l => l.confidence === 'unmapped'),
      })),
    })),
    shared_suppliers: risk.chokepoints.map(c => ({ supplier: c.supplier, also_in: c.models.filter(m => m !== risk.model) })),
    cutoffs: cutoffs.map(c => ({
      country: c.country,
      affected: mine(c.affected),
      fully_blocked: mine(c.fully_blocked),
      unknown: mine(c.unknown),
    })),
  };
}

export function allowedNumbers(f: BriefFacts): Set<number> {
  const notResearched = f.components.filter(c => c.status === 'not_researched').length;
  const out = new Set<number>([...Object.values(f.counts), f.total_components, f.shared_suppliers.length, notResearched]);
  for (const c of f.cutoffs) { out.add(c.affected.length); out.add(c.fully_blocked.length); out.add(c.unknown.length); }
  for (const c of f.components) for (const t of c.tiers) out.add(t.tier);
  return out;
}

const MAX_WORDS = 160;

/** Returns the reasons a draft must be rejected; empty means it passes. */
export function checkBrief(text: string, f: BriefFacts): string[] {
  const problems: string[] = [];
  const body = text.trim();
  if (!body) return ['empty brief'];

  // Model names such as "Hawk 2" carry digits that are not claims.
  let numeric = body;
  for (const name of [f.model, ...f.shared_suppliers.flatMap(s => s.also_in)]) numeric = numeric.split(name).join(' ');
  const allowed = allowedNumbers(f);
  for (const m of numeric.match(/\d+/g) ?? []) {
    if (!allowed.has(Number(m))) problems.push(`number ${m} does not appear in the data`);
  }
  const gaps = f.components.filter(x => x.status !== 'mapped');
  for (const c of gaps) {
    if (!body.toLowerCase().includes(c.name.toLowerCase())) problems.push(`unmapped component "${c.name}" is not mentioned`);
  }
  // Naming a gap is not enough: the brief has to say it is unmapped, so it is never read as safe.
  if (gaps.length > 0 && !/unmapped|not researched|no reliable source|no source|no record/i.test(body)) problems.push('unmapped components are not described as unmapped');
  if (/not_researched|partly_unmapped|single_country|single_source/.test(body)) problems.push('uses an internal label instead of plain words');
  if (f.counts.conflicts > 0 && !/conflict|disagree/i.test(body)) problems.push('conflicting sources exist but are not mentioned');
  if (/\n\s*\n|^\s*[-*#]/m.test(body)) problems.push('must be one plain paragraph');
  if (body.split(/\s+/).length > MAX_WORDS) problems.push(`longer than ${MAX_WORDS} words`);
  return problems;
}
