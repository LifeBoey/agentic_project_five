# Drone dependency map

<img src="web/public/logo.svg" alt="Drone dependency map logo: a drone seen from above with one red rotor" width="72" align="right">

Shows a procurement officer where a drone model depends on a single country. Full brief: [docs/brief.md](docs/brief.md).

## Layout

| Path | What lives there |
|---|---|
| `docs/` | Brief and other product docs |
| `research/` | Riskiest-bet result, coverage note, and `raw/` audit trail of every research and verifier run (Role 1) |
| `data/links.json` | Supplier links, one flat record each (Role 1 owns). Real data: Skydio X10 so far, more models appended. Conventions: [docs/links-format.md](docs/links-format.md) |
| `pipeline/` | Research and verifier agents that build `data/links.json` (Role 1). See [pipeline/README.md](pipeline/README.md) |
| `src/risk.js` | Graph and risk rules (Role 2) |
| `src/agent.js` | Query agent behind `ask()` (Role 2) |
| `src/server.js` | Risk API plus the static viewer, on one port |
| `web/` | The interface (Role 3): Vite + React + TypeScript, built to `web/dist/` |
| `web/tests/` | Browser tests (Playwright) and the fixture data they use |
| `web/scripts/` | `draft-briefs.ts` (risk brief agent) and `data-drop.ts` (data-drop test run) |

## Run

```bash
npm install
(cd web && npm install && npm run build)   # the interface, once and after each change
npm start
```

Then open http://localhost:3001, which redirects to the built interface at `/web/dist/`.

While working on the interface, run `npm start` in the root and `npm run dev` in `web/`, then open http://localhost:5173. Vite proxies `/api` to port 3001 (`API_PROXY` overrides it).

`npm test` runs the tests against `test/fixtures/links.json` (fake data) and also checks that the real `data/links.json` passes validation; no live API calls. `ask()` needs Claude credentials. Copy `.env.example` to `.env` and fill in `OPENCODE_API_KEY` (shared with the research pipeline; `ANTHROPIC_API_KEY` overrides it); `npm start` loads it. Without credentials, `/api/ask` returns 503 and everything else still works.

## Data format (`data/links.json`, frozen)

```json
{ "model": "", "component": "", "supplier": "", "supplier_country": "",
  "tier": 1, "source_url": "", "confidence": "high|low|unmapped",
  "conflict": false }
```

A **component** is what the drone maker buys at tier 1 (motors, battery cells, flight controller chip, camera sensor, radio). Sub-parts are deeper tiers of it: magnets are tier 2 of `motors`, cell materials are tier 2 of `battery cells`. Write an `unmapped` record for every tier you searched and found nothing, so "searched, not found" differs from "not researched".

Every record is checked on load. If any record is malformed (wrong field type, `tier` below 1, unknown `confidence`, or a mapped link with no supplier or no http(s) `source_url`), the whole file is rejected: the API returns 500 naming each bad record, so nothing is silently skipped.

A link's `id` in API responses is its position in the array. The file is re-read on every request, so new batches show up without a restart.

## Risk API

| Endpoint | Returns |
|---|---|
| `GET /api/models` | `["Falcon X", ...]` |
| `GET /api/models/:model/risk` | `{ model, counts: { single_country, single_source, unknown, low_confidence, conflicts }, components: [name, ...], flagged: [{ component, reasons, countries, low_confidence, link_ids }], chokepoints: [{ supplier, models }] }` |
| `GET /api/models/:model/chain/:component` | `{ model, component, status: "mapped"\|"unknown", tiers: [{ tier, links: [{ id, supplier, supplier_country, source_url, confidence, conflict, part? }] }] }` |
| `GET /api/cutoff/:country` | `{ country, affected: [{ model, component, link_ids }], fully_blocked: [{ model, component }], unknown: [{ model, component, link_ids }], models_affected }` |
| `POST /api/ask` `{ question }` | `{ answer, links: [full records] }`, or the fixed refusal "No mapped data to answer that." with `links: []` |

`components` lists every component of the model in file order, flagged or not. The interface needs it to show components that nothing flags. It is an addition by Role 3: the interface refuses to render a model whose response lacks it, rather than silently showing only the flagged ones.

An unknown model or component returns 404. For an unknown component, `link_ids` and the chain's `tiers` hold its `unmapped` records, so the gap itself can be cited.

## Risk rules

Every rule reads a component's deepest tier and ignores `unmapped` records.

- **Single-country:** every link at the deepest tier names one country. A link with a blank country blocks the claim. Components whose only evidence is low confidence are still flagged, with `low_confidence: true`.
- **Single-source:** exactly one distinct supplier at the deepest tier. Supplier names and countries are matched ignoring case and surrounding spaces.
- **Unknown:** the component has only `unmapped` records, or has an `unmapped` record at a tier deeper than its deepest mapped tier (partly known: its mapped tiers still show). It is never treated as safe.
- **Conflict:** any of the component's mapped records has `conflict: true`.
- **Low confidence (count):** a flagged component whose deepest-tier evidence is all `low`.
- **Chokepoint:** a supplier that appears in 2 or more models, at any tier.
- **Cut-off:** `affected` means any mapped link is in that country. `fully_blocked` means the deepest tier is only that country. `unknown` lists fully unmapped components, plus partly known ones with no mapped link in that country.

## Query agent

`claude-haiku-5-5` at effort `low`, called through OpenCode (the model enabled on our workspace). Its only tools are the four risk functions. The code keeps only the cited link ids that appeared in a tool result. If none remain, `ask()` returns the fixed refusal.

## Interface

Everything on the page comes from the Risk API; the page computes no risk of its own.

- **Not researched**: an expected component (`web/src/lib/expected.ts`: motors, battery cells, flight controller chip, camera sensor, radio) that a model has no record for at all. It is shown grey, counted, never safe, and unknown in a cut-off, so it cannot silently disappear. **The expected list is provisional and still to be agreed.** `data-drop` reports the same gaps for the research role.
- **Unmapped** (`status: "unknown"`): a grey row, counted in the summary, no source, never shown as safe.
- **Partly unmapped** (`status: "mapped"` with an `unmapped` tier below the known ones): the known tiers and sources show, and the missing tier is a grey card.
- **Low confidence**: labelled on the row and on the weak source, with the source link visible.
- **Conflict**: the disagreeing suppliers sit side by side.
- **Cut-off**: `affected` and `fully_blocked` mark rows; `unknown` is listed separately as "not counted as unaffected".
- **Question box**: shows a loading state (3 to 10 seconds). "No mapped data to answer that." is shown as a normal answer. A 503 says the question box is not set up on the server.

## Checks

```bash
cd web
npm run typecheck
npm test                          # unit tests: view logic, brief checker, URL guard
npx playwright install chromium   # once
npm run test:e2e                  # browser tests on fixture data, answered by the real risk engine
E2E_API=real npm run test:e2e     # the data-agnostic tests against the real server and data/links.json
npm run data-drop                 # the real-API run plus a report in docs/test-reports/
```

`data-drop` writes two lists: UI failures, and data gaps (unmapped, partly unmapped, low confidence, conflicts, components not researched, or a `links.json` the API rejects) to hand to the research role. The real-API run makes one live `ask()` call.

## Risk briefs

With the API running and `.env` filled in, `cd web && npm run briefs` drafts one paragraph per model from the API output into `web/public/briefs/` (gitignored, so each machine generates its own). Each draft is checked: every number must come from the API output, every unmapped or partly unmapped component must be named and described as unmapped, and conflicts must be mentioned. A draft that fails twice is not written, and the interface says no brief has been drafted for that model.

The checker tests numbers and names, not meaning, so read the briefs before presenting them. **Regenerate them after every data drop**: a brief is a snapshot and does not update itself.
