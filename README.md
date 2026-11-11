# Drone dependency map

Shows a procurement officer where a drone model depends on a single country. Full brief: [docs/brief.md](docs/brief.md).

## Layout

| Path | What lives there |
|---|---|
| `docs/` | Brief and other product docs |
| `research/` | Riskiest-bet test and research notes |
| `data/models/` | One JSON file per drone model, the map's only data source |
| `web/` | Static viewer: no build step, no dependencies |

## Run

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/web/. It has to be served, because the page fetches the JSON.

## Data shape (`data/models/*.json`)

- A component with an empty `chain` is **Unmapped** and shows grey, never as safe.
- `chain` runs from tier 1 down. Each tier lists one or more `sources`. Several sources in the same tier are shown side by side, including when they disagree.
- `confidence` is `"high"` or `"low"`.
- A component counts as **single-country** when every source in its deepest tier names the same country.
