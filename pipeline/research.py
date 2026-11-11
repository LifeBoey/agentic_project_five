"""Research agent: one per drone model x component category. Searches the web, returns candidate links."""
from __future__ import annotations

import json
import re

from . import config
from .llm import message_to_dict, parse_json
from .merge import clean_supplier
from .tools import fetch_page, web_search

TOOLS = [
    {"type": "function", "function": {
        "name": "web_search",
        "description": "Search the web. Returns titles, URLs and snippets.",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "fetch_page",
        "description": "Read a web page as text (PDFs usually work too). Optionally centre the excerpt on a keyword.",
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string"},
            "focus": {"type": "string", "description": "optional keyword to centre the excerpt on"}},
            "required": ["url"]}}},
]

SYSTEM = """You are a supply-chain research agent. You map who supplies a specific component of a \
specific drone model, using ONLY what you find on public web pages (teardowns, FCC filings, company \
press releases, trade data, news, government reports).

Rules:
- Never guess or use background knowledge as a source. Every claim needs a source_url you actually \
opened with fetch_page in this session and that states the claim.
- Prefer sources specific to this drone model, then to this drone maker.
- Up to {max_sources} sources per (part, tier). Fewer is fine. An empty list is the honest answer when \
nothing is found.
- supplier_country: ISO 3166 alpha-2 code. Use where the part is MADE if a source says so \
(country_basis "made"); otherwise the supplier's headquarters (country_basis "hq").
- supplier: the plain company name only (e.g. "Sony", "Nidec Corporation"), no notes or brackets.
- quote: a sentence copied exactly from the page that supports the claim.
- Be efficient: a handful of searches, open the most promising pages, then answer.

When done, reply with ONLY this JSON (no tool call):
{{"candidates": [{{"part": <one of the allowed part names, or null for the component itself>, \
"tier": <int>, "supplier": "...", "supplier_country": "XX", "country_basis": "made|hq", \
"source_url": "https://...", "quote": "..."}}],
 "notes": "one or two sentences: what you found, what you could not find"}}"""


def task_prompt(model: dict, cat: dict, exclude_urls: list[str]) -> str:
    allowed = "; ".join(f"part={json.dumps(p)} tier={t}" for p, t in cat["parts"])
    s = (f"Drone model: {model['name']} (maker: {model['maker']})\n"
         f"Component: {cat['component']}\n"
         f"What to find: {cat['guidance']}\n"
         f"Allowed (part, tier) pairs: {allowed}\n")
    if exclude_urls:
        s += ("\nA previous attempt used these URLs and the verifier rejected them, do NOT use them again:\n"
              + "\n".join(f"- {u}" for u in exclude_urls) + "\n")
    return s


def _excerpt(text: str, focus: str | None, limit: int = 6000) -> str:
    if len(text) <= limit:
        return text
    i = text.lower().find(focus.lower()) if focus else -1
    start = max(0, i - limit // 3) if i >= 0 else 0
    return f"[excerpt from char {start} of {len(text)}]\n" + text[start:start + limit]


def run_tool(name: str, args: dict) -> str:
    try:
        if name == "web_search":
            return json.dumps(web_search(args["query"]), ensure_ascii=False)
        if name == "fetch_page":
            ok, text = fetch_page(args["url"])
            return _excerpt(text, args.get("focus")) if ok else f"ERROR: {text}"
        return f"ERROR: unknown tool {name}"
    except Exception as err:  # noqa: BLE001 - tool failures go back to the agent
        return f"ERROR: {err}"


_COUNTRY_NAMES = {
    "china": "CN", "prc": "CN", "taiwan": "TW", "japan": "JP", "south korea": "KR", "korea": "KR",
    "united states": "US", "usa": "US", "us": "US", "germany": "DE", "france": "FR", "switzerland": "CH",
    "netherlands": "NL", "united kingdom": "GB", "uk": "GB", "israel": "IL", "india": "IN",
    "vietnam": "VN", "thailand": "TH", "malaysia": "MY", "philippines": "PH", "mexico": "MX",
    "canada": "CA", "australia": "AU", "chile": "CL", "argentina": "AR", "indonesia": "ID",
    "congo": "CD", "drc": "CD", "singapore": "SG", "italy": "IT", "sweden": "SE", "finland": "FI",
}


def country_code(value) -> str | None:
    """ISO alpha-2 code, or None if the value isn't a recognisable country (never truncate names)."""
    v = (value or "").strip()
    if re.fullmatch(r"[A-Za-z]{2}", v) and v.upper() != "XX":
        return v.upper()
    return _COUNTRY_NAMES.get(v.lower().replace(".", ""))


def clean_candidates(raw: list, cat: dict, exclude_urls: list[str]) -> list[dict]:
    """Keep only well-formed candidates for allowed (part, tier) pairs, max N per pair."""
    allowed = {((p or "").lower(), t): p for p, t in cat["parts"]}
    per_pair: dict = {}
    out = []
    for c in raw if isinstance(raw, list) else []:
        if not isinstance(c, dict):
            continue
        try:
            tier = int(c.get("tier"))
        except (TypeError, ValueError):
            continue
        part_in = (c.get("part") or "").strip().lower()
        if part_in in ("null", "none", cat["component"].lower()):
            part_in = ""
        key = (part_in, tier)
        url = (c.get("source_url") or "").strip()
        supplier = clean_supplier(c.get("supplier") or "")
        country = country_code(c.get("supplier_country"))
        if (key not in allowed or not supplier or not country
                or not re.match(r"^https?://", url) or url in exclude_urls):
            continue
        if per_pair.get(key, 0) >= config.MAX_SOURCES_PER_PART:
            continue
        per_pair[key] = per_pair.get(key, 0) + 1
        out.append({
            "component": cat["component"], "part": allowed[key], "tier": tier, "supplier": supplier,
            "supplier_country": country,
            "country_basis": "made" if c.get("country_basis") == "made" else "hq",
            "source_url": url, "quote": (c.get("quote") or "")[:500],
        })
    return out


def research_agent(model: dict, cat: dict, llm, exclude_urls: list[str] | None = None) -> dict:
    exclude_urls = exclude_urls or []
    messages = [
        {"role": "system", "content": SYSTEM.format(max_sources=config.MAX_SOURCES_PER_PART)},
        {"role": "user", "content": task_prompt(model, cat, exclude_urls)},
    ]
    used_models, tool_log = [], []
    for turn in range(config.RESEARCH_MAX_TURNS):
        last = turn == config.RESEARCH_MAX_TURNS - 1
        if last:
            messages.append({"role": "user", "content": "Stop searching now and reply with the final JSON only."})
        msg, used = llm.chat(messages, tools=None if last else TOOLS, temperature=0.2)
        used_models.append(used)
        if getattr(msg, "tool_calls", None) and not last:
            messages.append(message_to_dict(msg))
            for tc in msg.tool_calls:
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except ValueError:
                    args = {}
                tool_log.append({"tool": tc.function.name, "args": args})
                messages.append({"role": "tool", "tool_call_id": tc.id,
                                 "content": run_tool(tc.function.name, args)})
            continue
        try:
            parsed = parse_json(msg.content)
        except ValueError:
            if last:
                return {"candidates": [], "notes": "agent gave no readable JSON", "raw_reply": msg.content,
                        "models": used_models, "tool_log": tool_log}
            messages.append(message_to_dict(msg))
            messages.append({"role": "user", "content": "Reply with the final JSON only, in the required format."})
            continue
        if isinstance(parsed, list):
            parsed = {"candidates": parsed}
        return {"candidates": clean_candidates(parsed.get("candidates", []), cat, exclude_urls),
                "raw_candidates": parsed.get("candidates", []), "notes": parsed.get("notes", ""),
                "models": used_models, "tool_log": tool_log}
    return {"candidates": [], "notes": "ran out of turns", "models": used_models, "tool_log": tool_log}
