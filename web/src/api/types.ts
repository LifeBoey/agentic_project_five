// Response shapes of Role 2's Risk API (see the README's "Risk API"). Kept exactly as the server sends them.

export type Confidence = 'high' | 'low' | 'unmapped';

/** One link as the chain endpoint returns it. An unmapped record has confidence "unmapped"
 *  and a blank supplier, country and source URL. */
export interface ChainLink {
  id: number;
  supplier: string;
  supplier_country: string;
  source_url: string;
  confidence: Confidence;
  conflict: boolean;
}

/** A full links.json record plus its id, as ask() cites it. */
export interface LinkRecord extends ChainLink {
  model: string;
  component: string;
  tier: number;
}

export type Reason = 'single_country' | 'single_source' | 'conflict' | 'unknown';

export interface FlaggedComponent {
  component: string;
  reasons: Reason[];
  countries: string[];
  low_confidence: boolean;
  /** The links behind this verdict. */
  link_ids: number[];
}

export interface ModelRisk {
  model: string;
  counts: {
    single_country: number;
    single_source: number;
    unknown: number;
    low_confidence: number;
    conflicts: number;
  };
  /** Every component of the model, flagged or not. Added for the interface; see README. */
  components: string[];
  flagged: FlaggedComponent[];
  chokepoints: { supplier: string; models: string[] }[];
}

export interface ChainTier {
  tier: number;
  links: ChainLink[];
}

/** "unknown" means nothing is mapped. "mapped" can still hold unmapped records at a deeper tier. */
export interface Chain {
  model: string;
  component: string;
  status: 'mapped' | 'unknown';
  tiers: ChainTier[];
}

export interface Cutoff {
  country: string;
  affected: { model: string; component: string; link_ids: number[] }[];
  fully_blocked: { model: string; component: string }[];
  /** Could be affected but cannot be told: never "unaffected". */
  unknown: { model: string; component: string; link_ids: number[] }[];
  models_affected: string[];
}

export interface AskResult {
  answer: string;
  links: LinkRecord[];
}

export interface RiskApi {
  get_models(): Promise<string[]>;
  get_model_risk(model: string): Promise<ModelRisk>;
  get_chain(model: string, component: string): Promise<Chain>;
  simulate_cutoff(country: string): Promise<Cutoff>;
  ask(question: string): Promise<AskResult>;
}

/** The exact answer ask() returns when it cannot cite anything. A normal answer, not an error. */
export const NO_DATA_ANSWER = 'No mapped data to answer that.';
