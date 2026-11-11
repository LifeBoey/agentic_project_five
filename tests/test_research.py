from pipeline.config import RESEARCH_CATEGORIES
from pipeline.research import clean_candidates

MAGNETS = next(c for c in RESEARCH_CATEGORIES if c["key"] == "magnets")
MOTORS = next(c for c in RESEARCH_CATEGORIES if c["key"] == "motors")


def c(**kw):
    base = {"part": "Magnets", "tier": 2, "supplier": "Mag Co", "supplier_country": "cn",
            "country_basis": "made", "source_url": "https://m", "quote": "q"}
    base.update(kw)
    return base


def test_keeps_allowed_pair_and_normalises_part_name():
    out = clean_candidates([c(part="magnets")], MAGNETS, [])
    assert out[0]["part"] == "Magnets" and out[0]["component"] == "Motors" and out[0]["supplier_country"] == "CN"


def test_drops_bad_pairs_urls_and_excluded():
    raw = [c(tier=1), c(source_url="ftp://x"), c(supplier=""), c(source_url="https://bad"), c(part="Copper")]
    assert clean_candidates(raw, MAGNETS, ["https://bad"]) == []


def test_component_itself_accepts_null_part():
    out = clean_candidates([c(part=None, tier=1), c(part="null", tier=1, source_url="https://n")], MOTORS, [])
    assert [o["part"] for o in out] == [None, None]


def test_caps_sources_per_pair():
    raw = [c(source_url=f"https://{i}") for i in range(5)]
    assert len(clean_candidates(raw, MAGNETS, [])) == 3


def test_unknown_basis_becomes_hq():
    assert clean_candidates([c(country_basis="guess")], MAGNETS, [])[0]["country_basis"] == "hq"


def test_country_names_mapped_not_truncated():
    from pipeline.research import country_code
    assert country_code("China") == "CN" and country_code("Japan") == "JP" and country_code("tw") == "TW"
    assert country_code("") is None and country_code("XX") is None and country_code("Atlantis") is None


def test_candidate_without_valid_country_dropped():
    assert clean_candidates([c(supplier_country="")], MAGNETS, []) == []
    assert clean_candidates([c(supplier_country="China")], MAGNETS, [])[0]["supplier_country"] == "CN"
