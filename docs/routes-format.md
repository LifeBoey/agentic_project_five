# `routes.json`: transit chokepoints (Role 1)

`links.json` says **who makes** a part and where. `data/routes.json` adds **where it travels**: the sea chokepoints (straits and canals) between a supplier's country and the country where the drone is assembled. A country can stop or delay shipments without making anything, for example through a blockade of the Taiwan Strait or by closing the Suez Canal. `links.json` and its frozen format are untouched.

Built by `python -m pipeline.routes`, from the mapped cross-border links in `data/links.json`.

```json
{
  "from_country": "CN",
  "to_country": "US",
  "to_basis": "assumed final assembly country",
  "status": "mapped",
  "chokepoints": [
    { "name": "Panama Canal", "countries": ["PA"], "source_url": "https://...", "confidence": "low" }
  ],
  "transit_countries": ["PA"],
  "notes": "what the route agent found, including any air or overland alternative",
  "used_by": [ { "model": "Skydio X10", "component": "battery cells", "link_ids": [0] } ]
}
```

| Field | Meaning |
|---|---|
| `from_country`, `to_country` | ISO alpha-2. `from` is a supplier country in `links.json`. `to` is the drone's assembly country from `pipeline/config.py`. That country is **assumed, not verified**, hence `to_basis`. |
| `status` | `mapped`: at least one chokepoint is backed by a source. `unmapped`: researched, and no chokepoint was verified. That usually means an open-ocean route, but it is **not proof of safety**. |
| `chokepoints` | Each one has a verified source. `confidence` follows the same rules as `links.json`: `high` means the page names these countries or their ports, `low` means it names the wider regions. |
| `countries` | The countries along that chokepoint: those that could block it. This is a fixed table in `pipeline/config.py` (`CHOKEPOINTS`), with a reference link per strait. |
| `transit_countries` | The union of all chokepoint countries, minus the origin and destination. |
| `used_by` | Which models and components ship on this route. `link_ids` are positions in `links.json`. |

Rules:
- Only chokepoints in the `CHOKEPOINTS` table can appear. The route agent cannot invent new ones.
- Each chokepoint's evidence quote must appear on the cited page and name the chokepoint, which code checks.
- A route lists **possible** chokepoints. A shipment uses one route, not all of them. Many electronics also travel by air, which these routes don't cover.
- Not covered: transshipment through third countries (for example components re-routed via Vietnam or Mexico) and land borders.

## For Role 2 (if you want transit in the cut-off)

A cut-off of country X affects a link by transit when its route lists X in `transit_countries`. To find it, join `routes.json` on `(supplier_country, assembly country)`, or use `used_by[].link_ids` directly. Report it separately from production dependencies ("could be delayed in transit", not "made there").
