import type { Chain, ModelRisk, RiskApi } from '../api';
import { buildRows, type Row } from './rows';

/** Everything the page knows about one model: the risk summary, every chain, and the rows built from them. */
export interface ModelData {
  model: string;
  risk: ModelRisk;
  chains: Chain[];
  rows: Row[];
}

/** Loads every model once, so the graph can connect suppliers shared between models and the list can switch instantly. */
export function loadDataset(api: RiskApi, models: string[]): Promise<ModelData[]> {
  return Promise.all(models.map(async model => {
    const risk = await api.get_model_risk(model);
    const chains = await Promise.all(risk.components.map(c => api.get_chain(model, c)));
    return { model, risk, chains, rows: buildRows(risk, chains) };
  }));
}
