import type { Chain, ChainLink, ModelRisk } from '../api';
import { EXPECTED_COMPONENTS } from './expected';

// How one component is shown. Built from the risk summary plus that component's chain.
//   unknown: nothing is mapped. Grey, never safe.
//   red:     every deepest-tier supplier is in one country.
//   ok:      mapped and not single-country (it may still carry conflict or single-supplier marks).
//   not_researched: an expected component with no record at all. Grey, never safe, and not from the API.
export type RowState = 'unknown' | 'red' | 'ok' | 'not_researched';

export interface Row {
  name: string;
  state: RowState;
  /** Mapped upper tiers plus an unmapped deeper tier: show what is known and grey out the gap. */
  partlyUnknown: boolean;
  /** Unmapped tiers below the known ones, with Role 1's label when there is one. */
  gaps: { tier: number; part?: string }[];
  singleSource: boolean;
  conflict: boolean;
  lowConfidence: boolean;
  countries: string[];
  /** The links behind the verdict, each with its source. */
  shown: ChainLink[];
  chain: Chain;
}

export const isMapped = (l: ChainLink) => l.confidence !== 'unmapped';

export function buildRows(risk: ModelRisk, chains: Chain[]): Row[] {
  const fromApi: Row[] = risk.components.map(name => {
    const chain = chains.find(c => c.component === name);
    if (!chain) throw new Error(`The API returned no chain for "${name}".`);
    const flag = risk.flagged.find(f => f.component === name);
    const reasons = flag?.reasons ?? [];

    const mappedTiers = chain.tiers.filter(t => t.links.some(isMapped));
    const gaps = chain.tiers.filter(t => t.links.some(l => !isMapped(l))).map(t => ({ tier: t.tier, part: t.links.find(l => !isMapped(l))?.part }));
    // A chain that claims to be mapped but holds no mapped link is treated as unknown, never as fine.
    const fullyUnknown = chain.status === 'unknown' || mappedTiers.length === 0;

    const deepest = mappedTiers.at(-1)?.links.filter(isMapped) ?? [];
    const behindVerdict = deepest.filter(l => flag?.link_ids.includes(l.id));

    return {
      name,
      state: fullyUnknown ? 'unknown' : reasons.includes('single_country') ? 'red' : 'ok',
      partlyUnknown: !fullyUnknown && (gaps.length > 0 || reasons.includes('unknown')),
      gaps,
      singleSource: reasons.includes('single_source'),
      conflict: reasons.includes('conflict') || deepest.some(l => l.conflict),
      lowConfidence: flag?.low_confidence ?? false,
      countries: flag?.countries ?? [...new Set(deepest.map(l => l.supplier_country))],
      shown: behindVerdict.length > 0 ? behindVerdict : deepest,
      chain,
    };
  });

  // An expected component with no record must not silently disappear: show it as not researched.
  const have = new Set(risk.components.map(c => c.trim().toLowerCase()));
  const missing: Row[] = EXPECTED_COMPONENTS.filter(c => !have.has(c)).map(name => ({
    name,
    state: 'not_researched' as const,
    partlyUnknown: false,
    gaps: [],
    singleSource: false,
    conflict: false,
    lowConfidence: false,
    countries: [],
    shown: [],
    chain: { model: risk.model, component: name, status: 'unknown', tiers: [] },
  }));
  return [...fromApi, ...missing];
}
