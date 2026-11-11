from types import SimpleNamespace

from pipeline import verify as V

PAGE = ("Skydio X10 teardown. The **X10** uses a Qualcomm QRB5165 processor, "
        "manufactured in Taiwan by TSMC. Other text follows here to pad the page out. " * 3)
CAND = {"component": "Flight controller chip", "part": None, "tier": 1, "supplier": "Qualcomm",
        "supplier_country": "US", "country_basis": "hq", "source_url": "https://x"}
MODEL = {"name": "Skydio X10", "maker": "Skydio"}


def test_quote_on_page_ignores_markdown_and_case():
    assert V.quote_on_page("The X10 uses a Qualcomm QRB5165 processor", PAGE)
    assert not V.quote_on_page("The X10 uses an Nvidia Orin processor", PAGE)
    assert not V.quote_on_page("X10", PAGE)  # too short to count


def test_missing_quote_downgrades_to_unmapped():
    out = V.apply_rules(CAND, {"verdict": "high", "evidence_quote": "made up sentence about chips",
                               "country_supported": True}, PAGE)
    assert out["confidence"] == "unmapped"


def test_hq_basis_caps_high_at_low():
    out = V.apply_rules(CAND, {"verdict": "high", "evidence_quote": "The X10 uses a Qualcomm QRB5165 processor",
                               "country_supported": True}, PAGE)
    assert out["confidence"] == "low"


def test_made_basis_with_country_on_page_stays_high():
    c = dict(CAND, supplier="TSMC", supplier_country="TW", country_basis="made", part="Chip fabrication", tier=2)
    out = V.apply_rules(c, {"verdict": "high", "evidence_quote": "manufactured in Taiwan by TSMC",
                            "country_supported": True}, PAGE)
    assert out["confidence"] == "high"


def test_bad_verdict_is_unmapped():
    assert V.apply_rules(CAND, {"verdict": "maybe"}, PAGE)["confidence"] == "unmapped"


def test_verify_dead_link_is_unmapped(monkeypatch):
    monkeypatch.setattr(V, "fetch_page", lambda url: (False, "fetch failed: 404"))
    assert V.verify(CAND, MODEL, llm=None)["confidence"] == "unmapped"


def test_verify_end_to_end_with_stub_llm(monkeypatch):
    monkeypatch.setattr(V, "fetch_page", lambda url: (True, PAGE))

    class StubLLM:
        def chat(self, messages, **kw):
            reply = ('```json\n{"verdict": "high", "evidence_quote": "uses a Qualcomm QRB5165 processor", '
                     '"country_supported": false, "reason": "named"}\n```')
            return SimpleNamespace(content=reply), "stub"

    out = V.verify(CAND, MODEL, StubLLM())
    assert out["confidence"] == "low" and out["verifier_model"] == "stub"


def test_page_window_centres_on_supplier():
    page = "x" * 50000 + " Qualcomm chip " + "y" * 50000
    w = V.page_window(page, "Qualcomm chip", limit=1000)
    assert "Qualcomm" in w and len(w) == 1000


def test_quote_must_name_supplier():
    c = dict(CAND, supplier="Nvidia Corporation")
    out = V.apply_rules(c, {"verdict": "low", "evidence_quote": "The X10 uses a Qualcomm QRB5165 processor"}, PAGE)
    assert out["confidence"] == "unmapped"
    assert V.quote_names_supplier("manufactured in Taiwan by TSMC", "TSMC Ltd.")
