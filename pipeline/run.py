"""CLI: research -> verify -> (retry) -> merge into data/links.json and research/coverage.md.

    python -m pipeline.run --models "Skydio X10" [--categories motors magnets] [--budget 5] [--force]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from dotenv import load_dotenv

from . import config
from .llm import LLM, AllModelsFailed, Budget, BudgetExceeded
from .merge import apply_overrides, build_links, coverage_markdown
from .research import research_agent
from .verify import verify

_print_lock = threading.Lock()


def log(*a):
    with _print_lock:
        print(*a, flush=True)


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def job_path(model_name: str, cat_key: str):
    return config.RAW_DIR / slug(model_name) / f"{cat_key}.json"


def run_job(model: dict, cat: dict, llm: LLM) -> dict:
    job = {"model": model["name"], "category": cat["key"], "component": cat["component"],
           "attempts": [], "verified": [], "retried": False}
    exclude: list[str] = []
    for attempt in range(2):
        res = research_agent(model, cat, llm, exclude_urls=exclude)
        verified = []
        for c in res["candidates"]:
            v = verify(c, model, llm)
            verified.append({**c, **v})
            log(f"  [{model['name']} / {cat['key']}] {c['supplier']} ({c['supplier_country']}) "
                f"T{c['tier']} -> {v['confidence']}")
        job["attempts"].append({**res, "verified": verified})
        job["verified"].extend(verified)
        job["notes"] = res.get("notes", "")
        # retry once if some (part, tier) had sources but every one of them was rejected
        pairs: dict = {}
        for v in verified:
            pairs.setdefault((v.get("part"), v["tier"]), []).append(v["confidence"] in ("high", "low"))
        failed = [p for p, oks in pairs.items() if not any(oks)]
        if not failed or attempt == 1:
            break
        job["retried"] = True
        exclude = [v["source_url"] for v in job["verified"]]
        log(f"  [{model['name']} / {cat['key']}] all sources rejected for {failed}, retrying once")
    return job


DEEPEN_HINT = """Known tier-1 suppliers for this component (from verified sources):
{known}

Only find the deeper tiers listed in "Allowed (part, tier) pairs". The first search found nothing on pages
about the drone, so search for the tier-1 PRODUCT instead (the chip, sensor, motor, radio or battery model
named above) and set "parent" to it. Useful sources: chip and sensor die-shot or teardown sites (TechInsights,
iFixit), FCC internal photos (component markings), foundry or magnet-maker announcements, the tier-1
supplier's own annual report or supplier list, customs and bill-of-lading summaries (ImportYeti, Panjiva)."""


def known_tier1(model_name: str, component: str, jobs: list[dict]) -> str:
    lines = []
    for j in jobs:
        if j.get("model") != model_name or j.get("component") != component:
            continue
        for v in j.get("verified", []):
            if v.get("confidence") in ("high", "low") and int(v.get("tier", 1)) == 1:
                lines.append(f'- {v["supplier"]}: "{(v.get("evidence_quote") or "")[:200]}"')
    return "\n".join(dict.fromkeys(lines)) or "- none found yet"


def deepen_job(model: dict, cat: dict, llm: LLM, job: dict, jobs: list[dict]) -> dict:
    """Second, sub-tier-only research pass chained from the tier-1 products; appended to the job."""
    sub = dict(cat, parts=[(p, t) for p, t in cat["parts"] if t >= 2])
    context = DEEPEN_HINT.format(known=known_tier1(model["name"], cat["component"], jobs))
    exclude = [v["source_url"] for v in job.get("verified", [])]
    res = research_agent(model, sub, llm, exclude_urls=exclude, context=context)
    verified = []
    for c in res["candidates"]:
        v = verify(c, model, llm)
        verified.append({**c, **v, "pass": "deepen"})
        log(f"  [{model['name']} / {cat['key']} deepen] {c['supplier']} ({c['supplier_country']}) "
            f"T{c['tier']} via {c.get('parent')} -> {v['confidence']}")
    job.setdefault("attempts", []).append({**res, "verified": verified, "pass": "deepen"})
    job["verified"].extend(verified)
    return job


def load_jobs() -> list[dict]:
    jobs = []
    for p in sorted(config.RAW_DIR.glob("*/*.json")):
        jobs.append(json.loads(p.read_text(encoding="utf-8")))
    return jobs


def rebuild_outputs(runs: list[dict]):
    jobs = load_jobs()
    done_models = {j["model"] for j in jobs}
    model_names = [m["name"] for m in config.DRONE_MODELS if m["name"] in done_models]
    existing = []
    if config.LINKS_PATH.exists():
        try:
            existing = json.loads(config.LINKS_PATH.read_text(encoding="utf-8"))
        except ValueError:
            log("warning: existing links.json is not valid JSON; starting a fresh file")
    overrides_path = config.ROOT / "research" / "overrides.json"
    if overrides_path.exists():
        n = apply_overrides(jobs, json.loads(overrides_path.read_text(encoding="utf-8")))
        log(f"applied {n} hand-check override(s) from research/overrides.json")
    records, dropped = build_links(jobs, config.RESEARCH_CATEGORIES, existing,
                                   [m["name"] for m in config.DRONE_MODELS], config.SUPPLIER_ALIASES)
    if dropped:
        log(f"WARNING: {len(dropped)} record(s) already in links.json are no longer produced and were "
            f"removed, so later link ids shift. Tell Role 2. First removed: "
            f"{[(r.get('model'), r.get('component'), r.get('supplier')) for r in dropped[:3]]}")
    config.LINKS_PATH.write_text(json.dumps(records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    marker = "## Known gaps (hand-written)"
    old = config.COVERAGE_PATH.read_text(encoding="utf-8") if config.COVERAGE_PATH.exists() else ""
    known_gaps = old.split(marker, 1)[1] if marker in old else ""
    config.COVERAGE_PATH.write_text(
        coverage_markdown(records, jobs, model_names, config.COMPONENTS, runs, config.REQUIRED_PARTS,
                          known_gaps), encoding="utf-8")
    return records


def main(argv=None):
    # Windows consoles/redirects default to cp1252; supplier names can be CJK or accented.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    load_dotenv(config.ROOT / ".env")
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="*", default=[config.DRONE_MODELS[0]["name"]],
                    help='model names, or "all"')
    ap.add_argument("--categories", nargs="*", default=None, help="category keys (default: all)")
    ap.add_argument("--budget", type=float, default=config.DEFAULT_BUDGET_USD)
    ap.add_argument("--force", action="store_true", help="redo jobs that already have raw output")
    ap.add_argument("--rebuild-only", action="store_true", help="only rebuild links.json/coverage from raw")
    ap.add_argument("--deepen", action="store_true",
                    help="extra sub-tier pass chained from known tier-1 products, appended to existing jobs")
    args = ap.parse_args(argv)

    runs_path = config.RAW_DIR / "_runs.json"
    runs = json.loads(runs_path.read_text(encoding="utf-8")) if runs_path.exists() else []
    if args.rebuild_only:
        rebuild_outputs(runs)
        return 0

    if not os.environ.get("OPENCODE_API_KEY"):
        print("OPENCODE_API_KEY is not set (put it in .env). Stopping.")
        return 2
    for k in ("TAVILY_API_KEY", "JINA_API_KEY"):
        if not os.environ.get(k):
            print(f"note: {k} not set, using the free fallback")

    names = [m["name"] for m in config.DRONE_MODELS]
    wanted = names if args.models == ["all"] else args.models
    unknown = [m for m in wanted if m not in names]
    if unknown:
        print(f"unknown model(s): {unknown}; known: {names}")
        return 2
    models = [m for m in config.DRONE_MODELS if m["name"] in wanted]
    cats = [c for c in config.RESEARCH_CATEGORIES if not args.categories or c["key"] in args.categories]

    todo = []
    for m in models:
        for c in cats:
            p = job_path(m["name"], c["key"])
            existing = json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
            if args.deepen:
                if not existing or existing.get("error") or not any(t >= 2 for _, t in c["parts"]):
                    continue
                if not args.force and any(a.get("pass") == "deepen" for a in existing.get("attempts", [])):
                    log(f"skip {m['name']} / {c['key']} (already deepened; --force to redo)")
                    continue
            elif existing and not args.force and not existing.get("error"):
                log(f"skip {m['name']} / {c['key']} (done; --force to redo)")
                continue
            todo.append((m, c))

    budget = Budget(args.budget)
    llm = LLM(budget)
    stop = threading.Event()
    all_jobs = load_jobs()

    def work(m, c):
        if stop.is_set():
            return
        log(f"start {m['name']} / {c['key']}" + (" (deepen)" if args.deepen else ""))
        try:
            if args.deepen:
                old = json.loads(job_path(m["name"], c["key"]).read_text(encoding="utf-8"))
                try:
                    job = deepen_job(m, c, llm, old, all_jobs)
                except BudgetExceeded:
                    raise
                except Exception as err:  # noqa: BLE001 - keep the original job untouched
                    log(f"deepen failed for {m['name']} / {c['key']}: {err}")
                    return
            else:
                job = run_job(m, c, llm)
        except BudgetExceeded as err:
            stop.set()
            log(f"BUDGET STOP during {m['name']} / {c['key']}: {err} (job not saved; rerun resumes)")
            return
        except AllModelsFailed as err:
            job = {"model": m["name"], "category": c["key"], "component": c["component"],
                   "verified": [], "error": str(err)[:500]}
        except Exception as err:  # noqa: BLE001
            job = {"model": m["name"], "category": c["key"], "component": c["component"],
                   "verified": [], "error": f"{type(err).__name__}: {err}"[:500]}
        job["when"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        p = job_path(m["name"], c["key"])
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(job, indent=2, ensure_ascii=False), encoding="utf-8")
        kept = sum(v.get("confidence") in ("high", "low") for v in job["verified"])
        log(f"done {m['name']} / {c['key']}: {kept} kept"
            + (f" ERROR {job['error'][:120]}" if job.get("error") else "")
            + f" | spent so far ${budget.spent:.4f}")

    with ThreadPoolExecutor(max_workers=config.WORKERS) as pool:
        for f in as_completed([pool.submit(work, m, c) for m, c in todo]):
            f.result()

    if todo:
        runs.append({"when": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                     "models": [m["name"] for m in models], "spent": round(budget.spent, 6),
                     "calls": budget.calls})
        runs_path.parent.mkdir(parents=True, exist_ok=True)
        runs_path.write_text(json.dumps(runs, indent=2), encoding="utf-8")
    records = rebuild_outputs(runs)
    log(f"\nspent ${budget.spent:.4f} of ${budget.cap:.2f}; calls {budget.calls}")
    if llm.errors:
        log(f"model errors ({len(llm.errors)}), last: {llm.errors[-3:]}")
    log(f"wrote {config.LINKS_PATH.relative_to(config.ROOT)} ({len(records)} records) and "
        f"{config.COVERAGE_PATH.relative_to(config.ROOT)}")
    return 1 if stop.is_set() else 0


if __name__ == "__main__":
    sys.exit(main())
