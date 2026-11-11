// Runs the browser suite against the real Risk API on a data drop and writes docs/test-reports/<timestamp>.md.
// The report keeps two things apart: UI failures (Role 3 fixes) and data gaps (Role 1 fixes).
//
//   npm run data-drop      (from web/; starts the Risk API itself, on port 3101)
//
// The data gaps are read with Role 2's engine over data/links.json, the same code the API runs.
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getChain, getModelRisk, getModels, loadLinks } from '../../src/risk.js';
import type { Chain, ModelRisk } from '../src/api';
import { EXPECTED_COMPONENTS } from '../src/lib/expected';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_DIR = join(ROOT, '..', 'docs', 'test-reports');
// The interface shows these as grey "Not researched" when a model has no record for one (see src/lib/expected.ts).
const EXPECTED = EXPECTED_COMPONENTS;

interface Failure { title: string; message: string }
interface Spec { title: string; tests: { results: { status: string; error?: { message?: string } }[] }[] }
interface Suite { title: string; specs?: Spec[]; suites?: Suite[] }

function collect(suite: Suite, path: string[], out: { passed: number; failures: Failure[] }) {
  const here = suite.title ? [...path, suite.title] : path;
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      const last = t.results.at(-1);
      if (!last || last.status === 'skipped') continue;
      if (last.status === 'passed') out.passed++;
      else out.failures.push({ title: [...here, spec.title].join(' › '), message: (last.error?.message ?? last.status).replace(/\x1b\[[0-9;]*m/g, '').split('\n').slice(0, 6).join('\n') });
    }
  }
  for (const s of suite.suites ?? []) collect(s, here, out);
}

async function dataGaps(): Promise<{ rows: { model: string; component: string; gap: string }[]; components: number } | string> {
  let links;
  try { links = await loadLinks(); } catch (e) { return `data/links.json was rejected, so nothing can be shown: ${e instanceof Error ? e.message : e}`; }
  const rows: { model: string; component: string; gap: string }[] = [];
  let components = 0;
  for (const model of getModels(links) as string[]) {
    const risk = getModelRisk(links, model) as ModelRisk;
    for (const missing of EXPECTED.filter(e => !risk.components.includes(e))) {
      rows.push({ model, component: missing, gap: 'Not researched: no record at all (write an unmapped record if nothing was found)' });
    }
    for (const name of risk.components) {
      components++;
      const chain = getChain(links, model, name) as Chain;
      const flag = risk.flagged.find(f => f.component === name);
      const gapTiers = chain.tiers.filter(t => t.links.some(l => l.confidence === 'unmapped')).map(t => t.tier);
      if (chain.status === 'unknown') rows.push({ model, component: name, gap: 'Unmapped: no reliable source' });
      else if (gapTiers.length) rows.push({ model, component: name, gap: `Partly unmapped: tier ${gapTiers.join(', ')} has no source` });
      if (flag?.low_confidence) rows.push({ model, component: name, gap: 'Low confidence: deepest tier needs a better source' });
      if (flag?.reasons.includes('conflict')) rows.push({ model, component: name, gap: 'Conflict: sources name different suppliers' });
    }
  }
  return { rows, components };
}

const run = spawnSync('npx', ['playwright', 'test'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, E2E_API: 'real' } });

const tally = { passed: 0, failures: [] as Failure[] };
try {
  const report = JSON.parse(await readFile(join(ROOT, 'test-results', 'report.json'), 'utf8')) as { suites: Suite[] };
  for (const s of report.suites) collect(s, [], tally);
} catch {
  tally.failures.push({ title: 'Test run', message: 'No report.json was produced. The suite did not start (server or install problem).' });
}
const gaps = await dataGaps();

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const lines = [
  `# Data drop test report ${stamp}`,
  '',
  `Browser tests: ${tally.passed} passed, ${tally.failures.length} failed (real API, data/links.json)`,
  '',
  '## UI failures (Role 3 fixes)',
  '',
  ...(tally.failures.length === 0 ? ['None.'] : tally.failures.flatMap(f => [`### ${f.title}`, '', '```', f.message, '```', ''])),
  '',
  '## Data gaps (hand to Role 1)',
  '',
  ...(typeof gaps === 'string' ? [gaps] : [
    `${gaps.rows.length} gap(s) across ${gaps.components} components.`, '',
    ...(gaps.rows.length ? ['| Model | Component | Gap |', '|---|---|---|', ...gaps.rows.map(r => `| ${r.model} | ${r.component} | ${r.gap} |`)] : []),
  ]),
  '',
];
await mkdir(REPORT_DIR, { recursive: true });
const file = join(REPORT_DIR, `${stamp}.md`);
await writeFile(file, lines.join('\n'));
console.log(`\nReport written to ${file}`);
process.exit(run.status ?? 1);
