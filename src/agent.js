// Query agent: answers only from the risk API via tool calls, and code (not the prompt) enforces citations.
import Anthropic from '@anthropic-ai/sdk';
import { getModels, getModelRisk, getChain, simulateCutoff } from './risk.js';

export const REFUSAL = 'No mapped data to answer that.';
const MAX_TURNS = 10;

const obj = (properties = {}) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: 'string' };

const TOOLS = [
  { name: 'get_models', description: 'List the drone models in the graph.', input_schema: obj() },
  { name: 'get_model_risk', description: 'Risk summary for one model: counts, flagged components (with reasons, countries, link_ids) and chokepoint suppliers.', input_schema: obj({ model: str }) },
  { name: 'get_chain', description: 'Supplier chain for one component of one model, ordered by tier, with each link id, country, source URL and confidence.', input_schema: obj({ model: str, component: str }) },
  { name: 'simulate_cutoff', description: 'Components and models affected if a country (ISO code, e.g. CN) is cut off.', input_schema: obj({ country: str }) },
].map(t => ({ ...t, strict: true }));

const RUN = {
  get_models: (links) => getModels(links),
  get_model_risk: (links, i) => getModelRisk(links, i.model),
  get_chain: (links, i) => getChain(links, i.model, i.component),
  simulate_cutoff: (links, i) => simulateCutoff(links, i.country),
};

const ANSWER_FORMAT = {
  type: 'json_schema',
  schema: obj({ answer: str, cited_link_ids: { type: 'array', items: { type: 'integer' } } }),
};

const SYSTEM = `You answer procurement questions about drone supply-chain dependencies.
Use only what the tools return; never use outside knowledge. If the tools return nothing relevant, say you have no mapped data.
Cite every link id (from "id" or "link_ids" in tool results) that supports your answer in cited_link_ids.
Unknown or unmapped components are never safe: say they are unmapped, and cite their unmapped record ids. Mention when evidence is low confidence or conflicting.
A component flagged "unknown" that also has mapped tiers is only partly known: give the known tiers, and say the deeper tier is unmapped.
Components are what the drone maker buys at tier 1. Sub-parts are deeper tiers of a component:
- magnets = tier 2 of "motors"
- cell materials = tier 2 of "battery cells"
So for a question about magnets, read the motors chain at tier 2.`;

// Every link id a tool result exposes, so citations can be checked against what the agent actually saw.
function linkIdsIn(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach(v => linkIdsIn(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'id' && Number.isInteger(v)) out.add(v);
      else if (k === 'link_ids' && Array.isArray(v)) v.forEach(id => out.add(id));
      else linkIdsIn(v, out);
    }
  }
  return out;
}

export async function ask(question, { links, client = new Anthropic() }) {
  const seen = new Set();
  const messages = [{ role: 'user', content: question }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.messages.create({
      model: 'claude-haiku-5-5', // enabled on our OpenCode workspace; Haiku has no server-side refusal fallback
      max_tokens: 16000,
      output_config: { effort: 'low', format: ANSWER_FORMAT },
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
    messages.push({ role: 'assistant', content: res.content });

    if (res.stop_reason === 'tool_use') {
      const results = res.content.filter(b => b.type === 'tool_use').map(b => {
        const run = RUN[b.name];
        const out = run ? run(links, b.input ?? {}) : null;
        linkIdsIn(out, seen);
        return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out ?? { error: 'not found' }), is_error: out == null };
      });
      messages.push({ role: 'user', content: results });
      continue;
    }
    if (res.stop_reason === 'pause_turn') continue;
    if (res.stop_reason !== 'end_turn') break; // refusal, max_tokens: fall through to the fixed refusal

    let parsed;
    try {
      parsed = JSON.parse(res.content.filter(b => b.type === 'text').map(b => b.text).join(''));
    } catch { break; }
    const ids = [...new Set(parsed.cited_link_ids ?? [])].filter(id => seen.has(id));
    if (!ids.length || typeof parsed.answer !== 'string') break;
    return { answer: parsed.answer, links: ids.map(id => links[id]) };
  }
  return { answer: REFUSAL, links: [] };
}
