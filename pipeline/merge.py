"""Merge verified candidates into links.json records; flag conflicts; fill unmapped; coverage note."""
from __future__ import annotations

import re
from collections import defaultdict

_SUFFIXES = r"\b(inc|incorporated|co|company|corp|corporation|ltd|limited|llc|gmbh|ag|sa|plc|group|holdings?)\b"


def norm_supplier(s: str) -> str:
    s = re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower())
    s = re.sub(_SUFFIXES, " ", s)
    return " ".join(s.split())


def _record(model, component, part, tier, supplier, country, url, confidence):
    r = {"model": model, "component": component}
    if part:
        r["part"] = part
    r.update({"supplier": supplier, "supplier_country": country, "tier": tier,
              "source_url": url, "confidence": confidence, "conflict": False})
    return r


def unmapped_record(model, component, part=None, tier=1):
    return _record(model, component, part, tier, "", "", "", "unmapped")


def flag_conflicts(records: list[dict]) -> None:
    """Conflict = sources disagree for the same model/component/part/tier:
    - the same supplier is given different countries, or
    - different suppliers are named and no single source names all of them
      (one page listing two suppliers is second sourcing, not a disagreement)."""
    groups = defaultdict(list)
    for r in records:
        if r["confidence"] != "unmapped":
            groups[(r["model"], r["component"], r.get("part"), r["tier"])].append(r)
    for recs in groups.values():
        countries = defaultdict(set)
        by_url = defaultdict(set)
        for r in recs:
            s = norm_supplier(r["supplier"])
            countries[s].add(r["supplier_country"])
            by_url[r["source_url"]].add(s)
        suppliers = set(countries)
        country_clash = any(len(c) > 1 for c in countries.values())
        supplier_clash = len(suppliers) > 1 and not any(v >= suppliers for v in by_url.values())
        if country_clash or supplier_clash:
            for r in recs:
                r["conflict"] = True


def clean_supplier(s: str) -> str:
    """Strip agent notes from a supplier name: '(...)', '[...]' and anything after a dash separator."""
    s = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", s or "")
    s = re.split(r"\s[—–-]\s|—|–", s)[0]
    return " ".join(s.split()).strip(" ,;:")


def canonical_names(spellings: list[str], preferred: list[str] = ()) -> dict[str, str]:
    """Map every spelling to one canonical spelling per supplier.
    Same supplier = same normalised name, or one normalised name is a word-prefix of the other
    ('samsung' / 'samsung foundry'). `preferred` spellings (already in links.json) win, so ids'
    meaning never changes; otherwise the shortest cleaned spelling wins."""
    cleaned = {s: clean_supplier(s) for s in [*preferred, *spellings]}
    keys = sorted({norm_supplier(c) for c in cleaned.values() if norm_supplier(c)}, key=lambda k: (len(k.split()), k))
    root: dict[str, str] = {}
    for k in keys:
        toks = k.split()
        root[k] = next((r for r in root.values() if r.split() == toks[:len(r.split())]), k)
    best: dict[str, str] = {}
    for s in preferred:
        best.setdefault(root.get(norm_supplier(cleaned[s]), ""), cleaned[s])
    pinned = set(best)
    for s in spellings:
        r = root.get(norm_supplier(cleaned[s]), "")
        if r not in best or (r not in pinned and len(cleaned[s]) < len(best[r])):
            best[r] = cleaned[s]
    return {s: best.get(root.get(norm_supplier(c), ""), c) for s, c in cleaned.items()}


def record_key(r: dict) -> tuple:
    """Identity of a link: same key = same link, so it keeps its position (= its id for Role 2)."""
    who = "" if r["confidence"] == "unmapped" else norm_supplier(r["supplier"])
    return (r["model"], r["component"], r.get("part"), r["tier"], who, r["source_url"])


def apply_overrides(jobs: list[dict], overrides: list[dict]) -> int:
    """Hand-check verdicts (research/overrides.json) win over the verifier agent's. Each override
    matches model + category + source_url (+ supplier if given). Returns how many candidates changed."""
    n = 0
    for o in overrides:
        for job in jobs:
            if job.get("model") != o["model"] or job.get("category") != o["category"]:
                continue
            for c in job.get("verified", []):
                if c.get("source_url") == o["source_url"] and o.get("supplier", c.get("supplier")) == c.get("supplier"):
                    c["confidence"], c["reason"] = o["confidence"], o["reason"]
                    n += 1
    return n


def build_links(jobs: list[dict], categories: list[dict], existing: list[dict] | None = None,
                model_order: list[str] = (), aliases: dict[str, str] | None = None) -> tuple[list[dict], list[dict]]:
    """jobs: raw job dicts (`model`, `category`, `verified`). categories: config.RESEARCH_CATEGORIES.
    existing: the current links.json; its records keep their positions, new records are appended.
    aliases: supplier spelling -> canonical spelling, for variants the automatic folding can't catch
    (e.g. "SZ DJI Technology Co., Ltd." -> "DJI").
    An existing unmapped record whose tier has since been mapped stays in place, so later ids don't
    shift; the risk engine ignores an unmapped record at or above the deepest mapped tier.
    Returns (records, dropped) where dropped are existing records no longer produced."""
    alias_by_key = {norm_supplier(clean_supplier(k)): v for k, v in (aliases or {}).items()}
    existing = [r for r in (existing or []) if isinstance(r, dict)]
    cat_by_key = {c["key"]: c for c in categories}
    searched, mapped = set(), []
    for job in jobs:
        cat = cat_by_key.get(job.get("category"))
        if job.get("error") or not cat:
            continue
        searched.update((job["model"], cat["component"], p, t) for p, t in cat["parts"])
        for c in job.get("verified", []):
            if c.get("confidence") in ("high", "low"):
                mapped.append(_record(job["model"], cat["component"], c.get("part"), int(c["tier"]),
                                      c["supplier"], (c.get("supplier_country") or "").strip().upper(),
                                      c["source_url"], c["confidence"]))
    for r in mapped:
        r["supplier"] = alias_by_key.get(norm_supplier(clean_supplier(r["supplier"])), r["supplier"])
    names = canonical_names([r["supplier"] for r in mapped],
                            [r["supplier"] for r in existing if r.get("supplier")])
    fresh, seen = [], set()
    for r in mapped:
        r["supplier"] = names[r["supplier"]]
        if record_key(r) not in seen:
            seen.add(record_key(r))
            fresh.append(r)
    flag_conflicts(fresh)
    have = {(r["model"], r["component"], r.get("part"), r["tier"]) for r in fresh}
    for model, comp, part, tier in sorted(searched, key=lambda s: (s[0], s[1], s[3], s[2] or "")):
        if (model, comp, part, tier) not in have:
            fresh.append(unmapped_record(model, comp, part, tier))

    order = {m: i for i, m in enumerate(model_order)}
    fresh.sort(key=lambda r: (order.get(r["model"], 99), r["model"], r["component"], r["tier"],
                              r.get("part") or "", r["supplier"].lower(), r["source_url"]))
    by_key = {record_key(r): r for r in fresh}
    records, dropped, kept = [], [], set()
    for r in existing:
        k = record_key(r)
        if k in by_key:
            records.append(by_key[k])
            kept.add(k)
        elif r.get("confidence") == "unmapped" and (r["model"], r["component"], r.get("part"), r["tier"]) in searched:
            records.append(r)  # superseded placeholder: kept so ids don't shift
        else:
            dropped.append(r)
    records += [r for r in fresh if record_key(r) not in kept]
    return records, dropped


def single_country_components(records: list[dict], model: str) -> dict[str, str]:
    """Component -> country, where every mapped record at the component's deepest tier names one country."""
    out = {}
    by_comp = defaultdict(list)
    for r in records:
        if r["model"] == model and r["confidence"] != "unmapped":
            by_comp[r["component"]].append(r)
    for comp, recs in by_comp.items():
        deepest = max(r["tier"] for r in recs)
        countries = {r["supplier_country"] for r in recs if r["tier"] == deepest}
        if len(countries) == 1:
            out[comp] = next(iter(countries))
    return out


def coverage_markdown(records, jobs, model_names, components, runs, required_parts=(), known_gaps="") -> str:
    """known_gaps: the hand-written section from the previous coverage.md, carried over unchanged."""
    columns = [(comp, comp, None) for comp in components]
    columns += [(f"{comp} › {part}", comp, part) for comp, part, _ in required_parts]
    lines = ["# Coverage and known gaps", "",
             "Generated by `python -m pipeline.run`; edit the notes at the bottom by hand.", "",
             "Cell legend: `H` high, `L` low confidence links; `unmapped` = no verified source; "
             "`⚠` = sources conflict.", "",
             "| Model | " + " | ".join(c[0] for c in columns) + " |",
             "|---|" + "---|" * len(columns)]
    for m in model_names:
        cells = []
        for _, comp, part in columns:
            recs = [r for r in records if r["model"] == m and r["component"] == comp
                    and (part is None or r.get("part") == part)]
            if not recs or all(r["confidence"] == "unmapped" for r in recs):
                cells.append("unmapped")
                continue
            h = sum(r["confidence"] == "high" for r in recs)
            lo = sum(r["confidence"] == "low" for r in recs)
            tiers = sorted({r["tier"] for r in recs})
            cell = f"{h}H {lo}L (T{','.join(map(str, tiers))})"
            if any(r["conflict"] for r in recs):
                cell += " ⚠"
            cells.append(cell)
        lines.append(f"| {m} | " + " | ".join(cells) + " |")

    lines += ["", "## Single-country dependencies (deepest mapped tier)", ""]
    for m in model_names:
        sc = single_country_components(records, m)
        unmapped = sum(1 for comp in components
                       if all(r["confidence"] == "unmapped" for r in records
                              if r["model"] == m and r["component"] == comp))
        found = ", ".join(f"{k} ({v})" for k, v in sorted(sc.items())) or "none found"
        lines.append(f"- **{m}**: {found}" + (f" — {unmapped} component(s) unmapped, so not known to be safe"
                                              if unmapped else ""))

    lines += ["", "## Rules used", "",
              "- `supplier_country` = where the part is made if a source says so, otherwise HQ; "
              "HQ-only claims are capped at low.",
              "- Every non-unmapped link was opened by the verifier agent, and its evidence quote was "
              "checked by code to appear on the page.",
              "- Nothing is guessed: no verified source means `unmapped`.", "",
              "## Research notes per job", ""]
    for job in sorted(jobs, key=lambda j: (j["model"], j["category"])):
        rejected = sum(c.get("confidence") == "unmapped" for c in job.get("verified", []))
        kept = sum(c.get("confidence") in ("high", "low") for c in job.get("verified", []))
        note = (job.get("notes") or "").replace("\n", " ")[:300]
        err = f" ERROR: {job['error']}" if job.get("error") else ""
        lines.append(f"- {job['model']} / {job['category']}: {kept} kept, {rejected} rejected"
                     f"{', retried' if job.get('retried') else ''}.{err} {note}")

    lines += ["", "## Runs", "", "| When | Models | Spend (USD) | Calls per model |", "|---|---|---|---|"]
    for r in runs:
        lines.append(f"| {r['when']} | {', '.join(r['models'])} | {r['spent']:.4f} | {r['calls']} |")
    lines += ["", "## Known gaps (hand-written)", "", known_gaps.strip() or "- _fill in after review_", ""]
    return "\n".join(lines)
