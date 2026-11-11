# `links.json` format (proposal for kickoff)

Role 1 → Role 2 interface. Freezes at 0:30; any change needs all three roles to agree.

The file is a JSON **array of records**, one record per sourced supplier link. Example records: [`data/links.fake.json`](../data/links.fake.json).

```json
{ "model": "Skydio X10", "component": "Motors", "part": "Magnets",
  "supplier": "", "supplier_country": "CN", "tier": 2,
  "source_url": "https://...", "confidence": "high|low|unmapped",
  "conflict": false }
```

| Field | Meaning |
|---|---|
| `model` | Drone model name, as in the model list. |
| `component` | Top-level component: `Motors`, `Battery cells`, `Flight controller chip`, `Camera sensor`, `Radio`. |
| `part` | **Only proposed addition, optional.** For sub-tiers, what this supplier makes inside the component, e.g. `Magnets` under `Motors`, `Cathode material` under `Battery cells`. Missing at tier 1. Safe to ignore. |
| `supplier` | Company name. Empty when unmapped. |
| `supplier_country` | ISO 3166 alpha-2 code. Country where the part is **made** when a source says so, otherwise the supplier's HQ (those are capped at `low`). Empty when unmapped. |
| `tier` | 1 = supplies the component to the drone maker, 2 = supplies a part inside it, 3 = raw material (magnets and battery cells only). |
| `source_url` | The page that backs the claim. Empty when unmapped. |
| `confidence` | `high`: the page states this supplier provides this part for this model or maker. `low`: indirect, old, secondary, or HQ-only country. `unmapped`: no verifiable source found. |
| `conflict` | `true` on every record when sources disagree on supplier or country for the same model, component, part and tier. Several agreeing suppliers (second sourcing) are **not** a conflict. |

Rules:
- Every model × component appears at least once. If nothing was found, there is one record with empty `supplier`, `supplier_country` and `source_url`, `tier: 1` and `confidence: "unmapped"`. Show it grey, never as safe.
- Nothing is guessed. Every non-unmapped record has a `source_url` that a verifier agent opened and checked.
- Magnets are researched as their own category but recorded as `component: "Motors", part: "Magnets", tier: 2` (rare-earth material at tier 3). If no magnet supplier is verified, there is an extra unmapped record with `part: "Magnets", tier: 2`, so the gap is visible even when the motor maker is known.
- Differences from the old `data/models/example.json` / README shape: records are flat rather than nested chains, `confidence` can also be `unmapped`, and the component is called `Flight controller chip` rather than `Flight controller`.
