# Risk API

The Node server in `src/server.js` serves the API and the built interface on one port (3001 by default, `PORT` overrides it). Responses are JSON. The examples below are real responses from the current `data/links.json`, shortened where marked.

| Endpoint | Function | Returns |
|---|---|---|
| `GET /api/models` | `get_models()` | Every model name, in file order |
| `GET /api/models/:model/risk` | `get_model_risk(model)` | Counts, every component, the flagged ones and chokepoint suppliers |
| `GET /api/models/:model/chain/:component` | `get_chain(model, component)` | The component's tiers, each with its links and sources |
| `GET /api/cutoff/:country` | `simulate_cutoff(country)` | What a cut-off of that country hits, across all models |
| `POST /api/ask` | `ask(question)` | A cited answer from the query agent |

Names in paths are URL-encoded (`Skydio%20X10`). Model and component names match exactly; country codes ignore case.

## Errors

| Status | When | Body |
|---|---|---|
| 400 | `/api/ask` body is not JSON, or `question` is empty or over 500 characters | `{"error": "question must be a non-empty string up to 500 characters"}` |
| 404 | Unknown model, component or route | `{"error": "not found"}` |
| 405 | Any method other than GET, except `POST /api/ask` | `{"error": "method not allowed"}` |
| 500 | `data/links.json` fails validation | `{"error": "links.json rejected: record N (...): reason; ..."}` |
| 502 | The query agent's AI call failed | `{"error": "query agent failed"}` |
| 503 | No Claude credentials, or the key cannot use the model | `{"error": "query agent not configured"}` |

## `GET /api/models`

```bash
curl -s localhost:3001/api/models
```

```json
["Skydio X10", "Parrot Anafi USA", "Teal 2", "DJI Mavic 3 Enterprise"]
```

## `GET /api/models/:model/risk`

```bash
curl -s "localhost:3001/api/models/Skydio%20X10/risk"
```

Shortened to the first 2 of 5 flagged components:

```json
{
  "model": "Skydio X10",
  "counts": { "single_country": 4, "single_source": 4, "unknown": 5, "low_confidence": 5, "conflicts": 1 },
  "components": ["battery cells", "camera sensor", "flight controller chip", "motors", "radio"],
  "flagged": [
    { "component": "battery cells", "reasons": ["single_country", "single_source", "unknown"],
      "countries": ["CN"], "low_confidence": true, "link_ids": [0, 1, 2] },
    { "component": "camera sensor", "reasons": ["conflict", "unknown"],
      "countries": ["KR", "JP", "US"], "low_confidence": true, "link_ids": [3, 4, 5, 6] }
  ],
  "chokepoints": [{ "supplier": "Teledyne FLIR", "models": ["Skydio X10", "Teal 2"] }]
}
```

- `components` lists every component of the model, flagged or not, so the interface can show the ones nothing flags. Role 3 added it; the interface refuses to render a model whose response lacks it, rather than silently showing only flagged ones.
- `reasons` can hold `single_country`, `single_source`, `conflict` and `unknown`. A component with mapped tiers and `unknown` is partly known.
- `link_ids` are the records behind the verdict, including `unmapped` ones, so a gap can be cited.
- The rules are in [risk-model.md](risk-model.md).

## `GET /api/models/:model/chain/:component`

```bash
curl -s "localhost:3001/api/models/Skydio%20X10/chain/motors"
```

```json
{
  "model": "Skydio X10",
  "component": "motors",
  "status": "mapped",
  "tiers": [
    { "tier": 1, "links": [
      { "id": 11, "supplier": "Nidec Corporation", "supplier_country": "JP",
        "source_url": "https://en.sekorm.com/news/527741347.html", "confidence": "low", "conflict": false },
      { "id": 12, "supplier": "Nidec Corporation", "supplier_country": "JP",
        "source_url": "https://www.nidec.com/v=1777635136/files/topics/33851_ext_3_en_0.pdf", "confidence": "low", "conflict": false } ] },
    { "tier": 2, "links": [
      { "id": 13, "supplier": "", "supplier_country": "", "source_url": "", "confidence": "unmapped", "conflict": false, "part": "Magnets" } ] },
    { "tier": 3, "links": [
      { "id": 14, "supplier": "", "supplier_country": "", "source_url": "", "confidence": "unmapped", "conflict": false, "part": "Rare-earth material" } ] }
  ]
}
```

- `status` is `unknown` when nothing in the chain is mapped. Its `tiers` then hold the `unmapped` records, so the gap has a citable record.
- `unmapped` records appear only where they decide the verdict: the whole chain when nothing is mapped, otherwise the tiers below the deepest mapped one.
- `part` appears only when Role 1 labelled a sub-tier record.

## `GET /api/cutoff/:country`

```bash
curl -s localhost:3001/api/cutoff/CN
```

Shortened to the first 2 of 18 unknown components:

```json
{
  "country": "CN",
  "affected": [
    { "model": "Skydio X10", "component": "battery cells", "link_ids": [0] },
    { "model": "DJI Mavic 3 Enterprise", "component": "radio", "link_ids": [53, 54, 55] }
  ],
  "fully_blocked": [
    { "model": "Skydio X10", "component": "battery cells" },
    { "model": "DJI Mavic 3 Enterprise", "component": "radio" }
  ],
  "unknown": [
    { "model": "Skydio X10", "component": "camera sensor", "link_ids": [3, 4, 5, 6] },
    { "model": "Skydio X10", "component": "flight controller chip", "link_ids": [7, 8, 9, 10] }
  ],
  "models_affected": ["Skydio X10", "DJI Mavic 3 Enterprise"]
}
```

`unknown` components are not counted in `models_affected`, but they are never reported as safe: show them separately.

## `POST /api/ask`

```bash
curl -s -X POST localhost:3001/api/ask -H 'content-type: application/json' \
  -d '{"question":"Which models would be hit if China were cut off?"}'
```

Returns `{ "answer": "...", "links": [ full records, each with its id ] }`. The real answer to that question, with `links` shortened:

> If China (CN) were cut off, two models would be directly hit with a confirmed block: Skydio X10 (battery cells fully blocked, link 0) and DJI Mavic 3 Enterprise (radio fully blocked, links 53-55). Several other component dependencies have unmapped China exposure, so they cannot be confirmed safe: […] Those unknown items should be treated as at risk until their supply chains are mapped.

```json
{
  "answer": "If China (CN) were cut off, two models would be directly hit ...",
  "links": [
    { "id": 0, "model": "Skydio X10", "component": "battery cells", "supplier": "Dongguan Poweramp Technology Ltd.",
      "supplier_country": "CN", "tier": 1, "source_url": "https://crucibeljournal.com/the-battery-wars/", "confidence": "low", "conflict": false }
  ]
}
```

- Takes about 3 to 10 seconds: the agent calls the risk functions as tools before answering.
- Every link in `links` was returned by one of those tool calls. Citations the agent did not see are dropped by code.
- If nothing valid is left to cite, the answer is exactly `"No mapped data to answer that."` with `links: []`. Treat it as a normal answer, not an error.
- How the agent works: [architecture.md](architecture.md#the-query-agent).
