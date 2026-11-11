"""Web search and page fetching, with on-disk caching. No LLM here."""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from html.parser import HTMLParser

import httpx

from . import config

UA = "Mozilla/5.0 (compatible; drone-dependency-research/0.1)"


def _cache_path(kind: str, key: str):
    h = hashlib.sha1(key.encode()).hexdigest()[:20]
    return config.CACHE_DIR / kind / f"{h}.json"


def _cache_get(kind, key):
    p = _cache_path(kind, key)
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):  # missing or half-written: treat as a miss
        return None


def _cache_put(kind, key, value):
    p = _cache_path(kind, key)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(f".{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, p)  # atomic, so readers never see half a file


# ---------- search ----------

def _tavily(query: str, n: int) -> list[dict]:
    key = os.environ.get("TAVILY_API_KEY")
    if not key:
        raise RuntimeError("no TAVILY_API_KEY")
    r = httpx.post(
        "https://api.tavily.com/search",
        headers={"Authorization": f"Bearer {key}"},
        json={"query": query, "max_results": n, "search_depth": "basic"},
        timeout=30,
    )
    r.raise_for_status()
    return [{"title": x.get("title", ""), "url": x.get("url", ""), "snippet": x.get("content", "")[:500]}
            for x in r.json().get("results", [])]


def _ddgs(query: str, n: int) -> list[dict]:
    from ddgs import DDGS

    for backend in ("auto", "bing", "duckduckgo"):
        try:
            hits = DDGS().text(query, max_results=n, backend=backend)
        except Exception:  # noqa: BLE001 - ddgs raises on "No results found"
            continue
        if hits:
            return [{"title": x.get("title", ""), "url": x.get("href", ""), "snippet": x.get("body", "")[:500]}
                    for x in hits]
    return []


def web_search(query: str, n: int = 6) -> list[dict]:
    cached = _cache_get("search", query)
    if cached is not None:
        return cached
    errors = []
    for fn in (_tavily, _ddgs):  # an error or an empty result both fall through to the next engine
        try:
            results = fn(query, n)
        except Exception as err:  # noqa: BLE001
            errors.append(f"{fn.__name__}: {err}")
            continue
        if results:
            _cache_put("search", query, results)
            return results
        errors.append(f"{fn.__name__}: no results")
    if all(e.endswith("no results") or "TAVILY_API_KEY" in e for e in errors):
        return []
    raise RuntimeError("search failed: " + "; ".join(errors))


# ---------- fetch ----------

class _RateLimiter:
    def __init__(self, min_interval: float):
        self.min_interval = min_interval
        self._next = 0.0
        self._lock = threading.Lock()

    def wait(self):
        with self._lock:
            now = time.monotonic()
            delay = self._next - now
            self._next = max(now, self._next) + self.min_interval
        if delay > 0:
            time.sleep(delay)


_jina_limiter: _RateLimiter | None = None
_jina_init_lock = threading.Lock()


def _jina(url: str) -> str:
    global _jina_limiter
    key = os.environ.get("JINA_API_KEY")
    with _jina_init_lock:
        if _jina_limiter is None:
            # keyless: 20 req/min; keyed: 500 req/min
            _jina_limiter = _RateLimiter(0.15 if key else 3.2)
    _jina_limiter.wait()
    headers = {"User-Agent": UA, "X-Return-Format": "text"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    r = httpx.get(f"https://r.jina.ai/{url}", headers=headers, timeout=60, follow_redirects=True)
    r.raise_for_status()
    return r.text


class _TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "head"}

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip and data.strip():
            self.parts.append(data.strip())


def html_to_text(html: str) -> str:
    p = _TextExtractor()
    p.feed(html)
    return "\n".join(p.parts)


def _plain(url: str) -> str:
    r = httpx.get(url, headers={"User-Agent": UA}, timeout=30, follow_redirects=True)
    r.raise_for_status()
    if "html" not in r.headers.get("content-type", "html"):
        raise RuntimeError(f"not HTML: {r.headers.get('content-type')}")
    return html_to_text(r.text)


def fetch_page(url: str) -> tuple[bool, str]:
    """Returns (ok, text). ok=False means the page could not be read; text is the error."""
    if not re.match(r"^https?://", url or "", re.I):
        return False, "not an http(s) URL"
    cached = _cache_get("page", url)
    if cached is not None:
        return cached["ok"], cached["text"]
    errors = []
    for fn in (_jina, _plain):
        try:
            text = fn(url)
            if len(text.strip()) < 200:
                raise RuntimeError("page text too short")
            _cache_put("page", url, {"ok": True, "text": text})
            return True, text
        except Exception as err:  # noqa: BLE001
            errors.append(f"{fn.__name__}: {str(err)[:200]}")
    # failures are not cached: they may be transient
    return False, "fetch failed: " + "; ".join(errors)
