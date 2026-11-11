"""Verifier agent: opens each source URL and checks the page really supports the claim."""
from __future__ import annotations

import re

from . import config
from .llm import parse_json
from .tools import fetch_page

SYSTEM = """You are a strict fact-checker for a supply-chain map. You get a CLAIM and the TEXT of the \
web page cited for it. Decide only from the page text, never from your own knowledge.

Verdicts:
- "high": the page explicitly states this supplier provides this part/component for this drone model \
or for this drone maker.
- "low": the page supports the claim only indirectly (e.g. names the supplier for a related product, the \
maker's drones in general without the specific part, an old or secondary source like a forum teardown), \
or it supports the supplier but not the country.
- If the CLAIM names a parent product ("... for the NVIDIA Jetson Orin, which is used in ..."), judge only whether the page supports the supplier providing that part for that parent product; the page does not need to mention the drone. Such chained claims are at most "low".
- "unmapped": the page does not support the claim, is unrelated, is an error/paywall/login page, or the \
claim looks invented.

Return ONLY JSON:
{"verdict": "high|low|unmapped",
 "evidence_quote": "one sentence copied EXACTLY, character for character, from the page that best supports the claim and names the supplier (empty if unmapped)",
 "country_supported": true or false (does the page itself state the supplier's country or where the part is made?),
 "reason": "one short sentence"}"""


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def quote_on_page(quote: str, page: str) -> bool:
    """True if the quote (ignoring case, punctuation, markdown and whitespace) appears in the page."""
    q = _norm(quote)
    return len(q) >= 15 and q in _norm(page)


def quote_names_supplier(quote: str, supplier: str) -> bool:
    """True if the quote contains the supplier's distinctive first word (e.g. 'Qualcomm', 'TSMC')."""
    from .merge import norm_supplier

    words = [w for w in norm_supplier(supplier).split() if len(w) >= 2]
    return bool(words) and f" {words[0]} " in f" {_norm(quote)} "


def page_window(page: str, supplier: str, limit: int = config.PAGE_CHARS_FOR_VERIFIER) -> str:
    """Trim long pages to a window around the first mention of the supplier."""
    if len(page) <= limit:
        return page
    first_word = (supplier or "").split()[0] if supplier else ""
    i = page.lower().find(first_word.lower()) if first_word else -1
    start = max(0, i - limit // 3) if i >= 0 else 0
    return page[start:start + limit]


def claim_text(c: dict, model: dict) -> str:
    what = c.get("part") or c["component"]
    basis = "where it is made" if c.get("country_basis") == "made" else "headquarters"
    if c.get("parent") and int(c.get("tier", 1)) >= 2:
        return (f'"{c["supplier"]}" (country {c["supplier_country"]}, based on {basis}) supplies {what} '
                f'(tier {c["tier"]}) for the {c["parent"]}, which is used in the {c["component"]} of the '
                f'{model["name"]} drone made by {model["maker"]} (that link is sourced separately).')
    return (f'"{c["supplier"]}" (country {c["supplier_country"]}, based on {basis}) supplies '
            f'{what} (tier {c["tier"]}, part of the {c["component"]}) for the {model["name"]} drone '
            f'made by {model["maker"]}.')


def apply_rules(c: dict, raw: dict, page: str) -> dict:
    """Code-level checks on top of the LLM verdict. Returns {confidence, evidence_quote, reason}."""
    verdict = raw.get("verdict") if raw.get("verdict") in ("high", "low", "unmapped") else "unmapped"
    quote = raw.get("evidence_quote") or ""
    reason = raw.get("reason") or ""
    if verdict != "unmapped" and not quote_on_page(quote, page):
        return {"confidence": "unmapped", "evidence_quote": quote,
                "reason": f"evidence quote not found on page (verifier said {verdict}: {reason})"}
    if verdict != "unmapped" and not quote_names_supplier(quote, c.get("supplier", "")):
        return {"confidence": "unmapped", "evidence_quote": quote,
                "reason": f"evidence quote does not name the supplier (verifier said {verdict}: {reason})"}
    if verdict == "high" and (c.get("country_basis") != "made" or not raw.get("country_supported")):
        verdict, reason = "low", f"capped at low: country is HQ-based or not on page. {reason}"
    if verdict == "high" and c.get("parent"):
        verdict, reason = "low", f"capped at low: chained via {c['parent']}, page does not name the drone. {reason}"
    return {"confidence": verdict, "evidence_quote": quote, "reason": reason}


def verify(c: dict, model: dict, llm) -> dict:
    ok, page = fetch_page(c.get("source_url", ""))
    if not ok:
        return {"confidence": "unmapped", "evidence_quote": "", "reason": page, "verifier_model": None}
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": f"CLAIM: {claim_text(c, model)}\n\nURL: {c['source_url']}\n\n"
                                    f"PAGE TEXT:\n{page_window(page, c.get('supplier', ''))}"},
    ]
    msg, used = llm.chat(messages, temperature=0)
    try:
        raw = parse_json(msg.content)
        if not isinstance(raw, dict):
            raise ValueError("not an object")
    except ValueError as err:
        return {"confidence": "unmapped", "evidence_quote": "", "reason": f"verifier reply unreadable: {err}",
                "verifier_model": used}
    out = apply_rules(c, raw, page)
    out["verifier_model"] = used
    return out


ROUTE_SYSTEM = """You are a strict fact-checker for shipping routes. You get a CLAIM about which sea chokepoint (strait or canal) cargo passes through between two countries, and the TEXT of the cited page. Decide only from the page text, never from your own knowledge.

- "high": the page explicitly says shipping between these two countries (or their main ports) passes through this chokepoint.
- "low": the page names the chokepoint as a route for trade between the wider regions involved (e.g. East Asia to the US East Coast) without naming these exact countries.
- "unmapped": the page does not support the claim.

Return ONLY JSON:
{"verdict": "high|low|unmapped",
 "evidence_quote": "one sentence copied EXACTLY from the page that names the chokepoint (empty if unmapped)",
 "reason": "one short sentence"}"""


def verify_route_claim(claim: str, url: str, keyword: str, llm) -> dict:
    """Verify a transit claim. The evidence quote must be on the page and contain `keyword`."""
    ok, page = fetch_page(url)
    if not ok:
        return {"confidence": "unmapped", "evidence_quote": "", "reason": page, "verifier_model": None}
    msg, used = llm.chat([{"role": "system", "content": ROUTE_SYSTEM},
                          {"role": "user", "content": f"CLAIM: {claim}\n\nURL: {url}\n\nPAGE TEXT:\n"
                                                      f"{page_window(page, keyword)}"}], temperature=0)
    try:
        raw = parse_json(msg.content)
        if not isinstance(raw, dict):
            raise ValueError("not an object")
    except ValueError as err:
        return {"confidence": "unmapped", "evidence_quote": "", "reason": f"verifier reply unreadable: {err}",
                "verifier_model": used}
    verdict = raw.get("verdict") if raw.get("verdict") in ("high", "low", "unmapped") else "unmapped"
    quote, reason = raw.get("evidence_quote") or "", raw.get("reason") or ""
    if verdict != "unmapped" and not quote_on_page(quote, page):
        verdict, reason = "unmapped", f"evidence quote not found on page ({reason})"
    elif verdict != "unmapped" and keyword.lower() not in _norm(quote):
        verdict, reason = "unmapped", f"evidence quote does not name the chokepoint ({reason})"
    return {"confidence": verdict, "evidence_quote": quote, "reason": reason, "verifier_model": used}
