# Drone dependency map

Shows a procurement officer where a drone model depends on a single country. Full brief: [docs/brief.md](docs/brief.md).

## Layout

| Path | What lives there |
|---|---|
| `docs/` | Brief and other product docs |
| `research/` | Riskiest-bet test and research notes |
| `data/links.json` | Supplier links, one flat record each (Role 1 owns). Currently fake data. |
| `src/risk.js` | Graph and risk rules (Role 2) |
| `src/agent.js` | Query agent behind `ask()` (Role 2) |
| `src/server.js` | Risk API plus the static viewer, on one port |
| `web/` | Viewer (Role 3) |

## Run

```bash
npm install
npm start
```

Then open http://localhost:3001. `npm test` runs the tests against `test/fixtures/links.json` (fake data) and also checks that the real `data/links.json` passes validation; no live API calls. `ask()` needs Claude credentials. Copy `.env.example` to `.env` and fill in `OPENCODE_API_KEY` (shared with the research pipeline; `ANTHROPIC_API_KEY` overrides it); `npm start` loads it. Without credentials, `/api/ask` returns 503 and everything else still works.

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
| `GET /api/models/:model/risk` | `{ model, counts: { single_country, single_source, unknown, low_confidence, conflicts }, flagged: [{ component, reasons, countries, low_confidence, link_ids }], chokepoints: [{ supplier, models }] }` |
| `GET /api/models/:model/chain/:component` | `{ model, component, status: "mapped"\|"unknown", tiers: [{ tier, links: [{ id, supplier, supplier_country, source_url, confidence, conflict, part? }] }] }` |
| `GET /api/cutoff/:country` | `{ country, affected: [{ model, component, link_ids }], fully_blocked: [{ model, component }], unknown: [{ model, component, link_ids }], models_affected }` |
| `POST /api/ask` `{ question }` | `{ answer, links: [full records] }`, or the fixed refusal "No mapped data to answer that." with `links: []` |

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
