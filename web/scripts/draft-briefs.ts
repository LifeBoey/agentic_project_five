// Drafts one risk-brief paragraph per model from the Risk API output and writes it to
// public/briefs/<model>.md. Run at build or data-drop time; the key never reaches the browser.
//
//   npm start            (in the repo root: the Risk API on :3001)
//   npm run briefs       (here, in web/; API_URL overrides http://localhost:3001)
//
// Credentials come from the repo-root .env, the same file the Risk API uses.
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createApi } from '../src/api/client';
import { briefSlug } from '../src/lib/briefSlug';
import { buildFacts, checkBrief, type BriefFacts } from '../src/lib/briefCheck';

const HERE = dirname(fileURLToPath(import.meta.url));
// .env overrides the shell on purpose, as in src/server.js: some shells already set ANTHROPIC_BASE_URL.
try {
  Object.assign(process.env, parseEnv(readFileSync(join(HERE, '..', '..', '.env'), 'utf8')));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}

const MODEL = 'claude-haiku-5-5'; // the model enabled on our OpenCode workspace, as for the query agent
const OUT_DIR = join(HERE, '..', 'public', 'briefs');
const api = createApi(process.env.API_URL ?? 'http://localhost:3001');
const client = new Anthropic();

const SYSTEM = `You write a one-paragraph risk brief about a drone model for a procurement officer.

Rules:
- Use only the facts in the JSON. Never use general knowledge, never guess a supplier, country or cause.
- Write exactly one plain paragraph of at most 120 words. No headings, lists or markdown.
- Use plain words, never the status names from the JSON (write "not researched", not "not_researched").
- Write every number as digits, and use only numbers that appear in the JSON.
- Say how many components depend on a single country and name them with their country. A component's country is where its deepest mapped tier is, so say which tier when it is not tier 1. A tier's "part" says what it is (for example magnets): use it when you name a deeper tier.
- Name every component whose status is "unmapped", "partly_unmapped" or "not_researched". Say no reliable source was found (for partly unmapped, for the deeper tier), or for "not_researched" that no research record exists yet. Never describe these as safe or low risk.
- Mention low-confidence evidence and conflicting sources if the counts are above zero.
- Finish with what a cut-off of each country in "cutoffs" would affect, and say that "unknown" and "not_researched" components could not be assessed.`;

async function draft(facts: BriefFacts, feedback: string[]): Promise<string> {
  const retry = feedback.length ? `\n\nYour previous draft was rejected for: ${feedback.join('; ')}. Fix these.` : '';
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Facts:\n${JSON.stringify(facts, null, 2)}${retry}` }],
  });
  if (response.stop_reason === 'refusal') throw new Error(`refused: ${response.stop_details?.category ?? 'unknown'}`);
  if (response.stop_reason === 'max_tokens') throw new Error('output was cut off at max_tokens');
  return response.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('').trim();
}

async function briefFor(model: string): Promise<string> {
  const risk = await api.get_model_risk(model);
  const chains = await Promise.all(risk.components.map(c => api.get_chain(model, c)));
  // Cut-off for every country that is a single-country dependency, plus China.
  const countries = [...new Set([...risk.flagged.flatMap(f => (f.reasons.includes('single_country') ? f.countries : [])), 'CN'])];
  const facts = buildFacts(risk, chains, await Promise.all(countries.map(c => api.simulate_cutoff(c))));

  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await draft(facts, problems);
    problems = checkBrief(text, facts);
    if (problems.length === 0) return text;
    console.warn(`  attempt ${attempt + 1} rejected: ${problems.join('; ')}`);
  }
  throw new Error(`no valid brief after 2 attempts: ${problems.join('; ')}`);
}

await mkdir(OUT_DIR, { recursive: true });
let failed = 0;
for (const model of await api.get_models()) {
  console.log(`Drafting brief for ${model}`);
  try {
    await writeFile(join(OUT_DIR, `${briefSlug(model)}.md`), `${await briefFor(model)}\n`);
  } catch (e) {
    failed++;
    console.error(`  FAILED: ${e instanceof Error ? e.message : e}`);
  }
}
if (failed) {
  console.error(`${failed} brief(s) not written. Models without a brief show "No brief has been drafted".`);
  process.exit(1);
}
