# `links.json`: how Role 1 writes it

The frozen format and the risk rules live in the README on Role 2's branch (`feat/risk-engine`, section "Data format"). This page only records the conventions Role 1's pipeline follows to fit them.

```json
{ "model": "Skydio X10", "component": "motors", "part": "Magnets",
  "supplier": "", "supplier_country": "", "tier": 2,
  "source_url": "", "confidence": "unmapped", "conflict": false }
```

- **Components** are lowercase and are what the drone maker buys at tier 1: `motors`, `battery cells`, `flight controller chip`, `camera sensor`, `radio`. Sub-parts are deeper tiers of the same component: magnets are tier 2 of `motors` (rare-earth material is tier 3), cell materials are tier 2 of `battery cells` (raw materials are tier 3), chip, sensor and radio-chip fabrication are tier 2 of their component.
- **`part`** is an optional extra label for sub-tier records, e.g. `"Magnets"`. Role 2's loader ignores it, so Role 3 can use it as a display hint.
- **Unmapped for every tier searched.** Each (component, tier) a research job searched without a verified result gets a record with empty `supplier`, `supplier_country` and `source_url`, and `confidence: "unmapped"`. A component or tier with no record at all was never researched (for example, the job errored).
- **Countries** are ISO 3166 alpha-2 codes and are never blank on a mapped link. The country is where the part is made if a source says so, otherwise HQ (those links are capped at `low`).
- **One spelling per supplier** across the whole file. Agent notes in brackets are stripped, and variants such as "Nidec Corporation (Nidec America)" or "Sony Semiconductor Solutions" are folded into one spelling. A spelling already in the file wins.
- **`conflict: true`** goes only on mapped records, on every side of a disagreement: separate sources naming different suppliers for the same model, component and tier, or the same supplier with different countries. One page listing several suppliers counts as second sourcing, not a conflict.
- **Append-only.** A link's id is its position. Records already in the file keep their positions and new batches are appended. If a re-run removes a record, the pipeline prints a warning so Role 2 can be told that ids shifted.
- **Nothing is guessed.** Every mapped link's page was opened by the verifier agent, and code checked that the quoted evidence sentence appears on the page and names the supplier.
