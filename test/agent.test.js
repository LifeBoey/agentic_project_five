import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ask, REFUSAL } from '../src/agent.js';
import { loadLinks } from '../src/risk.js';

const links = await loadLinks();

// Fake client that replays scripted responses and records each request.
function fakeClient(responses) {
  const requests = [];
  return {
    requests,
    messages: { create: async (req) => { requests.push(structuredClone(req)); return responses.shift(); } },
  };
}
const toolUse = (name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t_${name}`, name, input }] });
const final = (answer, cited_link_ids) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ answer, cited_link_ids }) }] });

test('answers from tool results and keeps only citations it saw', async () => {
  const client = fakeClient([
    toolUse('get_chain', { model: 'Falcon X', component: 'motors' }),
    final('Falcon X motors depend on CN magnets.', [1, 7]), // 7 was never returned by a tool
  ]);
  const r = await ask('Where do Falcon X motor magnets come from?', { links, client });
  assert.equal(r.answer, 'Falcon X motors depend on CN magnets.');
  assert.deepEqual(r.links.map(l => l.id), [1]);
  // The tool result went back to the model.
  const sent = client.requests[1].messages.at(-1).content[0];
  assert.equal(sent.type, 'tool_result');
  assert.match(sent.content, /NdMag Ltd/);
});

test('link_ids in risk summaries count as seen', async () => {
  const client = fakeClient([
    toolUse('get_model_risk', { model: 'Hawk 2' }),
    final('Hawk 2 motors depend only on CN.', [6]),
  ]);
  const r = await ask('Hawk 2 single-country?', { links, client });
  assert.deepEqual(r.links.map(l => l.id), [6]);
});

test('can answer about unmapped components by citing the unmapped record', async () => {
  const client = fakeClient([
    toolUse('get_model_risk', { model: 'Falcon X' }),
    final('The Falcon X camera sensor is unmapped.', [4]),
  ]);
  const r = await ask('Which Falcon X components are unmapped?', { links, client });
  assert.equal(r.answer, 'The Falcon X camera sensor is unmapped.');
  assert.equal(r.links[0].confidence, 'unmapped');
});

test('refuses when the answer cites nothing it saw', async () => {
  const client = fakeClient([final('From general knowledge, China.', [])]);
  assert.deepEqual(await ask('Where are magnets made?', { links, client }), { answer: REFUSAL, links: [] });
});

test('refuses when tools found no data', async () => {
  const client = fakeClient([
    toolUse('get_model_risk', { model: 'Nope' }),
    final('Nope is safe.', [0]),
  ]);
  const r = await ask('Is Nope safe?', { links, client });
  assert.equal(r.answer, REFUSAL);
  assert.equal(client.requests[1].messages.at(-1).content[0].is_error, true);
});

test('refuses on a model refusal or unparseable output', async () => {
  for (const res of [
    { stop_reason: 'refusal', content: [] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] },
  ]) {
    assert.equal((await ask('q', { links, client: fakeClient([res]) })).answer, REFUSAL);
  }
});
