import type { AskResult, Chain, Cutoff, ModelRisk, RiskApi } from './types';

/** A non-2xx answer from the API. `status` is what the interface branches on (503 = no key configured). */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// No import.meta.env in here, so the scripts can run this under Node.
export function createApi(base = ''): RiskApi {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}/api/${path}`, init);
    if (!res.ok) {
      const detail = await res.json().then((b: { error?: string }) => b.error, () => undefined);
      throw new ApiError(res.status, detail ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }
  const seg = encodeURIComponent;

  return {
    get_models: () => request('models'),
    async get_model_risk(model) {
      const risk = await request<ModelRisk>(`models/${seg(model)}/risk`);
      // Without the full list, unflagged components would silently disappear from the page.
      if (!Array.isArray(risk.components)) throw new Error('The API response has no "components" list for this model.');
      return risk;
    },
    get_chain: (model, component) => request<Chain>(`models/${seg(model)}/chain/${seg(component)}`),
    simulate_cutoff: country => request<Cutoff>(`cutoff/${seg(country)}`),
    ask: question => request<AskResult>('ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
    }),
  };
}
