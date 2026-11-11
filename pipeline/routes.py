"""Transit routes: which sea chokepoints sit between a supplier's country and the drone's assembly country.

Writes data/routes.json (separate from links.json, so the frozen format is untouched).

    python -m pipeline.routes [--budget 5] [--force]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from dotenv import load_dotenv

from . import config
from .llm import LLM, Budget, BudgetExceeded, message_to_dict, parse_json
from .research import TOOLS, run_tool
from .verify import verify_route_claim

_lock = threading.Lock()


def log(*a):
    with _lock:
        print(*a, flush=True)


SYSTEM = """You are a shipping-route research agent. For cargo shipped by sea from one country to another, \
find which of the listed sea chokepoints (straits and canals) the usual routes pass through, using ONLY \
public web pages you open with fetch_page (port and shipping-line route descriptions, maritime chokepoint \
reports, trade-route analyses).

Rules:
- Only name chokepoints from the ALLOWED list, spelled exactly as listed.
- Every chokepoint needs a source_url you opened that names it as on a route between these countries or \
their regions, and a quote copied exactly from that page that names the chokepoint.
- If the usual route crosses open ocean with none of the listed chokepoints (e.g. a trans-Pacific crossing), \
say so in notes and return an empty list. Never guess.
- Be efficient: a few searches, open the best pages, then answer.

Reply with ONLY this JSON (no tool call) when done:
{"chokepoints": [{"name": "...", "source_url": "https://...", "quote": "..."}],
 "notes": "one or two sentences: the usual route(s), and any by-air or overland alternative you saw"}"""

COUNTRY_NAMES = {"CN": "China", "US": "the United States", "JP": "Japan", "KR": "South Korea", "TW": "Taiwan",
                 "SG": "Singapore", "CA": "Canada", "MY": "Malaysia", "VN": "Vietnam", "DE": "Germany",
                 "FR": "France", "TH": "Thailand", "PH": "the Philippines", "MX": "Mexico", "IN": "India"}


def cname(code: str) -> str:
    return COUNTRY_NAMES.get(code, code)


def route_pairs(links: list[dict], models: list[dict]) -> dict[tuple[str, str], list[dict]]:
    """(supplier_country, assembly_country) -> [{model, component, link_ids}] for mapped cross-border links."""
    assembly = {m["name"]: m.get("assembly") for m in models}
    pairs: dict[tuple[str, str], dict] = {}
    for i, r in enumerate(links):
        dest = assembly.get(r["model"])
        src = r.get("supplier_country")
        if r["confidence"] == "unmapped" or not dest or not src or src == dest:
            continue
        users = pairs.setdefault((src, dest), {})
        users.setdefault((r["model"], r["component"]), []).append(i)
    return {k: [{"model": m, "component": c, "link_ids": ids} for (m, c), ids in sorted(v.items())]
            for k, v in sorted(pairs.items())}


def clean_chokepoints(raw) -> list[dict]:
    names = {n.lower(): n for n in config.CHOKEPOINTS}
    out, seen = [], set()
    for c in raw if isinstance(raw, list) else []:
        if not isinstance(c, dict):
            continue
        name = names.get(str(c.get("name", "")).strip().lower())
        url = str(c.get("source_url", "")).strip()
        if not name or not url.lower().startswith(("http://", "https://")) or (name, url) in seen:
            continue
        seen.add((name, url))
        out.append({"name": name, "source_url": url, "quote": str(c.get("quote", ""))[:400]})
    return out[:8]


def route_agent(src: str, dest: str, llm) -> dict:
    allowed = ", ".join(config.CHOKEPOINTS)
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"Sea freight from {cname(src)} ({src}) to {cname(dest)} ({dest}).\n"
                                            f"ALLOWED chokepoints: {allowed}"}]
    tool_log = []
    for turn in range(config.RESEARCH_MAX_TURNS):
        last = turn == config.RESEARCH_MAX_TURNS - 1
        if last:
            messages.append({"role": "user", "content": "Stop searching now and reply with the final JSON only."})
        msg, _ = llm.chat(messages, tools=None if last else TOOLS, temperature=0.2)
        if getattr(msg, "tool_calls", None) and not last:
            messages.append(message_to_dict(msg))
            for tc in msg.tool_calls:
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except ValueError:
                    args = {}
                tool_log.append({"tool": tc.function.name, "args": args})
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": run_tool(tc.function.name, args)})
            continue
        try:
            parsed = parse_json(msg.content)
        except ValueError:
            if last:
                break
            messages.append(message_to_dict(msg))
            messages.append({"role": "user", "content": "Reply with the final JSON only, in the required format."})
            continue
        if isinstance(parsed, list):
            parsed = {"chokepoints": parsed}
        return {"candidates": clean_chokepoints(parsed.get("chokepoints")), "notes": parsed.get("notes", ""),
                "tool_log": tool_log}
    return {"candidates": [], "notes": "agent gave no readable answer", "tool_log": tool_log}


def run_pair(src: str, dest: str, llm) -> dict:
    res = route_agent(src, dest, llm)
    verified = []
    for c in res["candidates"]:
        claim = f"Sea freight from {cname(src)} to {cname(dest)} passes through the {c['name']}."
        v = verify_route_claim(claim, c["source_url"], config.CHOKEPOINTS[c["name"]]["keyword"], llm)
        verified.append({**c, **v})
        log(f"  [{src}->{dest}] {c['name']} -> {v['confidence']}")
    return {"from_country": src, "to_country": dest, "notes": res["notes"], "tool_log": res["tool_log"],
            "verified": verified, "when": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def build_routes(pairs: dict, raws: dict) -> list[dict]:
    """One record per (from, to) pair. A chokepoint is listed once, with its best-confidence source."""
    out = []
    for (src, dest), users in pairs.items():
        raw = raws.get((src, dest))
        best: dict[str, dict] = {}
        for v in (raw or {}).get("verified", []):
            if v.get("confidence") not in ("high", "low"):
                continue
            cur = best.get(v["name"])
            if not cur or (cur["confidence"] == "low" and v["confidence"] == "high"):
                best[v["name"]] = {"name": v["name"], "countries": config.CHOKEPOINTS[v["name"]]["countries"],
                                   "source_url": v["source_url"], "confidence": v["confidence"]}
        chokepoints = sorted(best.values(), key=lambda c: c["name"])
        out.append({
            "from_country": src, "to_country": dest, "to_basis": "assumed final assembly country",
            "status": "mapped" if chokepoints else ("unmapped" if raw else "not researched"),
            "chokepoints": chokepoints,
            "transit_countries": sorted({c for cp in chokepoints for c in cp["countries"]} - {src, dest}),
            "notes": (raw or {}).get("notes", ""),
            "used_by": users,
        })
    return out


def raw_path(src, dest):
    return config.ROUTES_RAW_DIR / f"{src}-{dest}.json"


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    load_dotenv(config.ROOT / ".env")
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=float, default=config.DEFAULT_BUDGET_USD)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--rebuild-only", action="store_true")
    args = ap.parse_args(argv)

    links = json.loads(config.LINKS_PATH.read_text(encoding="utf-8"))
    pairs = route_pairs(links, config.DRONE_MODELS)
    budget = Budget(args.budget)
    if not args.rebuild_only:
        if not os.environ.get("OPENCODE_API_KEY"):
            print("OPENCODE_API_KEY is not set (put it in .env). Stopping.")
            return 2
        llm = LLM(budget)
        todo = [k for k in pairs if args.force or not raw_path(*k).exists()]
        config.ROUTES_RAW_DIR.mkdir(parents=True, exist_ok=True)

        def work(src, dest):
            log(f"start {src}->{dest}")
            try:
                raw = run_pair(src, dest, llm)
            except BudgetExceeded as err:
                log(f"BUDGET STOP {src}->{dest}: {err}")
                return
            except Exception as err:  # noqa: BLE001
                log(f"failed {src}->{dest}: {err}")
                return
            raw_path(src, dest).write_text(json.dumps(raw, indent=2, ensure_ascii=False), encoding="utf-8")
            kept = sum(v["confidence"] in ("high", "low") for v in raw["verified"])
            log(f"done {src}->{dest}: {kept} chokepoint source(s) kept | spent ${budget.spent:.4f}")

        with ThreadPoolExecutor(max_workers=config.WORKERS) as pool:
            for f in as_completed([pool.submit(work, s, d) for s, d in todo]):
                f.result()
    raws = {k: json.loads(raw_path(*k).read_text(encoding="utf-8")) for k in pairs if raw_path(*k).exists()}
    routes = build_routes(pairs, raws)
    config.ROUTES_PATH.write_text(json.dumps(routes, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    log(f"wrote {config.ROUTES_PATH.relative_to(config.ROOT)} ({len(routes)} routes); spent ${budget.spent:.4f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
