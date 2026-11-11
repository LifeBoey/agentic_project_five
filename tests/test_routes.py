from pipeline import verify as V
from pipeline.routes import build_routes, clean_chokepoints, route_pairs

MODELS = [{"name": "A", "assembly": "US"}, {"name": "D", "assembly": "CN"}]


def link(model, comp, country, conf="low"):
    return {"model": model, "component": comp, "supplier": "S", "supplier_country": country, "tier": 1,
            "source_url": "https://x", "confidence": conf, "conflict": False}


def test_route_pairs_cross_border_mapped_only():
    links = [link("A", "motors", "JP"), link("A", "radio", "US"), link("A", "battery cells", "", "unmapped"),
             link("D", "camera sensor", "JP"), link("A", "camera sensor", "JP")]
    pairs = route_pairs(links, MODELS)
    assert set(pairs) == {("JP", "US"), ("JP", "CN")}
    assert pairs[("JP", "US")] == [{"model": "A", "component": "camera sensor", "link_ids": [4]},
                                   {"model": "A", "component": "motors", "link_ids": [0]}]


def test_clean_chokepoints_only_allowed_names():
    raw = [{"name": "strait of malacca", "source_url": "https://a", "quote": "q"},
           {"name": "Bering Strait", "source_url": "https://b"},
           {"name": "Panama Canal", "source_url": "ftp://c"}]
    assert clean_chokepoints(raw) == [{"name": "Strait of Malacca", "source_url": "https://a", "quote": "q"}]


def test_build_routes_transit_countries_and_status():
    pairs = {("CN", "US"): [{"model": "A", "component": "battery cells", "link_ids": [0]}],
             ("JP", "US"): [{"model": "A", "component": "motors", "link_ids": [1]}],
             ("KR", "US"): []}
    raws = {("CN", "US"): {"notes": "n", "verified": [
                {"name": "Panama Canal", "source_url": "https://p", "confidence": "low"},
                {"name": "Panama Canal", "source_url": "https://p2", "confidence": "high"},
                {"name": "Taiwan Strait", "source_url": "https://t", "confidence": "unmapped"}]},
            ("JP", "US"): {"notes": "open Pacific", "verified": []}}
    out = {(r["from_country"], r["to_country"]): r for r in build_routes(pairs, raws)}
    cn = out[("CN", "US")]
    assert cn["status"] == "mapped" and cn["transit_countries"] == ["PA"]
    assert cn["chokepoints"] == [{"name": "Panama Canal", "countries": ["PA"], "source_url": "https://p2",
                                  "confidence": "high"}]
    assert out[("JP", "US")]["status"] == "unmapped" and out[("KR", "US")]["status"] == "not researched"


def test_route_claim_quote_must_name_chokepoint(monkeypatch):
    from types import SimpleNamespace
    page = "Most Asia to US East Coast container services transit the Panama Canal. Other text. " * 4
    monkeypatch.setattr(V, "fetch_page", lambda url: (True, page))

    class Stub:
        def __init__(self, quote):
            self.quote = quote

        def chat(self, messages, **kw):
            return SimpleNamespace(content='{"verdict": "low", "evidence_quote": "%s", "reason": "r"}' % self.quote), "s"

    ok = V.verify_route_claim("c", "https://x", "panama", Stub("container services transit the Panama Canal"))
    bad = V.verify_route_claim("c", "https://x", "malacca", Stub("container services transit the Panama Canal"))
    assert ok["confidence"] == "low" and bad["confidence"] == "unmapped"


def test_chained_subtier_claim_capped_at_low():
    page = "The NVIDIA Jetson Orin SoC is manufactured by Samsung Foundry on its 8nm process in Korea. " * 3
    c = {"component": "flight controller chip", "part": "Chip fabrication", "tier": 2, "supplier": "Samsung",
         "supplier_country": "KR", "country_basis": "made", "source_url": "https://x", "parent": "NVIDIA Jetson Orin"}
    out = V.apply_rules(c, {"verdict": "high", "country_supported": True,
                            "evidence_quote": "manufactured by Samsung Foundry on its 8nm process in Korea"}, page)
    assert out["confidence"] == "low"
    assert "Jetson Orin" in V.claim_text(c, {"name": "X10", "maker": "Skydio"})


def test_parent_kept_only_for_subtiers():
    from pipeline.config import RESEARCH_CATEGORIES
    from pipeline.research import clean_candidates
    fc = next(c for c in RESEARCH_CATEGORIES if c["key"] == "flight_controller_chip")
    out = clean_candidates([
        {"part": None, "tier": 1, "supplier": "NVIDIA", "supplier_country": "US", "source_url": "https://1", "parent": "x"},
        {"part": "Chip fabrication", "tier": 2, "supplier": "Samsung", "supplier_country": "KR",
         "source_url": "https://2", "parent": "NVIDIA Jetson Orin"}], fc, [])
    assert [o["parent"] for o in out] == [None, "NVIDIA Jetson Orin"]
