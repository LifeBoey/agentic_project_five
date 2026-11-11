from pipeline.merge import build_links, flag_conflicts, norm_supplier, single_country_components


def cand(supplier, country, url, conf="high", component="Motors", part=None, tier=1):
    return {"component": component, "part": part, "tier": tier, "supplier": supplier,
            "supplier_country": country, "source_url": url, "confidence": conf}


def test_unmapped_filled_for_every_model_component():
    recs = build_links([], ["A", "B"], ["Motors", "Radio"])
    assert len(recs) == 4
    assert all(r["confidence"] == "unmapped" and r["supplier"] == "" and r["tier"] == 1 for r in recs)
    assert "part" not in recs[0]


def test_rejected_candidates_dropped_and_component_unmapped():
    jobs = [{"model": "A", "verified": [cand("X", "US", "https://a", conf="unmapped")]}]
    recs = build_links(jobs, ["A"], ["Motors"])
    assert recs == [{"model": "A", "component": "Motors", "supplier": "", "supplier_country": "",
                     "tier": 1, "source_url": "", "confidence": "unmapped", "conflict": False}]


def test_part_field_and_dedupe():
    c = cand("Mag Co", "cn", "https://m", component="Motors", part="Magnets", tier=2)
    recs = build_links([{"model": "A", "verified": [c, dict(c, supplier="Mag Co Ltd.")]}], ["A"], ["Motors"])
    assert len(recs) == 1
    assert recs[0]["part"] == "Magnets" and recs[0]["supplier_country"] == "CN"


def test_conflict_when_separate_sources_name_different_suppliers():
    jobs = [{"model": "A", "verified": [cand("Cell A", "KR", "https://1"), cand("Cell B", "CN", "https://2")]}]
    recs = build_links(jobs, ["A"], ["Motors"])
    assert all(r["conflict"] for r in recs)


def test_no_conflict_when_one_source_lists_both_suppliers():
    jobs = [{"model": "A", "verified": [cand("Cell A", "KR", "https://1"), cand("Cell B", "CN", "https://1")]}]
    recs = build_links(jobs, ["A"], ["Motors"])
    assert not any(r["conflict"] for r in recs)


def test_no_conflict_when_sources_agree():
    jobs = [{"model": "A", "verified": [cand("Cell A Inc", "KR", "https://1"), cand("cell a", "KR", "https://2")]}]
    assert not any(r["conflict"] for r in build_links(jobs, ["A"], ["Motors"]))


def test_conflict_when_same_supplier_different_country():
    recs = [dict(cand("X", "US", "https://1"), model="A"), dict(cand("X", "CN", "https://2"), model="A")]
    for r in recs:
        r["conflict"] = False
    flag_conflicts(recs)
    assert all(r["conflict"] for r in recs)


def test_different_tiers_do_not_conflict():
    jobs = [{"model": "A", "verified": [cand("Motor Co", "US", "https://1"),
                                        cand("Mag Co", "CN", "https://2", part="Magnets", tier=2)]}]
    assert not any(r["conflict"] for r in build_links(jobs, ["A"], ["Motors"]))


def test_single_country_uses_deepest_tier():
    jobs = [{"model": "A", "verified": [cand("Motor Co", "US", "https://1"),
                                        cand("Mag Co", "CN", "https://2", part="Magnets", tier=2)]}]
    recs = build_links(jobs, ["A"], ["Motors", "Radio"])
    assert single_country_components(recs, "A") == {"Motors": "CN"}


def test_norm_supplier():
    assert norm_supplier("Sony Semiconductor Solutions Corp.") == "sony semiconductor solutions"


def test_required_part_gets_own_unmapped_record():
    jobs = [{"model": "A", "verified": [cand("Motor Co", "US", "https://1")]}]
    recs = build_links(jobs, ["A"], ["Motors"], [("Motors", "Magnets", 2)])
    gap = [r for r in recs if r["confidence"] == "unmapped"]
    assert gap == [{"model": "A", "component": "Motors", "part": "Magnets", "supplier": "",
                    "supplier_country": "", "tier": 2, "source_url": "", "confidence": "unmapped",
                    "conflict": False}]
    assert single_country_components(recs, "A") == {"Motors": "US"}
