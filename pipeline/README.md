# Role 1 research pipeline

Builds `data/links.json` (format: [docs/links-format.md](../docs/links-format.md)) for the models listed in `config.py`.

For each drone model × category (motors, magnets, battery cells, flight controller chip, camera sensor, radio):
1. **Research agent**: searches the web and returns up to 3 sourced candidates per (part, tier).
2. **Verifier agent**: opens each `source_url` and rates the claim `high`, `low` or `unmapped`. Code then checks that the verifier's evidence quote really appears on the page, and caps claims based on HQ country at `low`.
3. **Retry**: if every source was rejected, the research runs once more with those URLs excluded.
4. **Merge**: drops rejected links, folds supplier spellings into one, flags `conflict`, and adds an `unmapped` record for every tier that was searched with no result. Records already in `data/links.json` keep their positions (ids), and new ones are appended. It also writes `research/coverage.md`, keeping its hand-written "Known gaps" section.

LLM calls go through the OpenCode gateway, using deepseek-v4.1-flash, falling back to glm-5.3-flash, then claude-sonnet-5-5. Search uses Tavily, falling back to the `ddgs` package (no key needed). Pages are fetched with Jina Reader, falling back to plain HTTP. A run stops at `--budget` dollars (default $5), and a later run resumes where it stopped.

**Deeper pass** (`--deepen`): a second, sub-tier-only search for jobs that already exist. It starts from the verified tier-1 products (e.g. "NVIDIA Jetson Orin") and may cite pages about that product instead of the drone. These chained links carry `parent` in the raw files and are capped at `low`. They are appended to the job, so existing link ids don't move.

**Transit routes** (`python -m pipeline.routes`): for every mapped cross-border link, a route agent finds which sea chokepoints lie between the supplier country and the assembly country. It writes `data/routes.json`; see [docs/routes-format.md](../docs/routes-format.md).

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in OPENCODE_API_KEY; TAVILY_API_KEY and JINA_API_KEY are optional
```

## Run

```bash
python -m pipeline.run --models "Skydio X10"            # one model
python -m pipeline.run --models all                      # every model in config.py
python -m pipeline.run --models "Teal 2" --categories radio --force   # redo one job
python -m pipeline.run --models all --deepen        # sub-tier pass chained from tier-1 products
python -m pipeline.routes                                # transit chokepoints -> data/routes.json
python -m pipeline.run --rebuild-only                    # regenerate outputs from research/raw/
python -m pytest tests                                   # unit tests, no network
```

Each job's full trail is saved to `research/raw/<model>/<category>.json` and committed as the audit trail: agent notes, tool calls, candidates and verifier verdicts with evidence quotes. Finished jobs are skipped on later runs unless `--force` is passed.
