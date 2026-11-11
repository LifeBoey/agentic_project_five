from pipeline.merge import (build_links, canonical_names, clean_supplier, flag_conflicts, norm_supplier,
                            single_country_components)

CATS = [
    {"key": "motors", "component": "motors", "parts": [(None, 1)]},
    {"key": "magnets", "component": "motors", "parts": [("Magnets", 2)]},
    {"key": "radio", "component": "radio", "parts": [(None, 1), ("Radio chip", 2)]},
]


def cand(supplier, country, url, conf="high", part=None, tier=1):
    return {"part": part, "tier": tier, "supplier": supplier, "supplier_country": country,
            "source_url": url, "confidence": conf}


def job(category, *verified, model="A", error=None):
    j = {"model": model, "category": category, "verified": list(verified)}
    if error:
        j["error"] = error
    return j


def mapped(recs):
    return [r for r in recs if r["confidence"] != "unmapped"]


def unmapped(recs):
    return [(r["component"], r.get("part"), r["tier"]) for r in recs if r["confidence"] == "unmapped"]


def test_unmapped_record_for_every_tier_searched():
    recs, _ = build_links([job("motors"), job("magnets"), job("radio")], CATS)
    assert sorted(unmapped(recs), key=str) == sorted(
        [("motors", None, 1), ("motors", "Magnets", 2), ("radio", None, 1), ("radio", "Radio chip", 2)], key=str)
    assert all(r["supplier"] == "" and r["supplier_country"] == "" and not r["conflict"]
               for r in recs)


def test_component_comes_from_config_not_raw_and_unrun_categories_absent():
    raw = dict(cand("Motor Co", "us", "https://1"), component="Motors")  # old raw file spelling
    recs, _ = build_links([job("motors", raw)], CATS)
    assert recs == [{"model": "A", "component": "motors", "supplier": "Motor Co", "supplier_country": "US",
                     "tier": 1, "source_url": "https://1", "confidence": "high", "conflict": False}]


def test_errored_job_leaves_no_records():
    recs, _ = build_links([job("radio", error="boom")], CATS)
    assert recs == []


def test_rejected_candidate_becomes_unmapped_slot():
    recs, _ = build_links([job("motors", cand("X", "US", "https://a", conf="unmapped"))], CATS)
    assert unmapped(recs) == [("motors", None, 1)] and mapped(recs) == []


def test_part_field_and_dedupe_of_spelling_variants():
    c = cand("Mag Co", "cn", "https://m", part="Magnets", tier=2)
    recs, _ = build_links([job("magnets", c, dict(c, supplier="Mag Co Ltd. (sintered NdFeB)"))], CATS)
    assert len(recs) == 1 and recs[0]["part"] == "Magnets" and recs[0]["supplier"] == "Mag Co"


def test_conflict_when_separate_sources_name_different_suppliers():
    recs, _ = build_links([job("motors", cand("Cell A", "KR", "https://1"), cand("Cell B", "CN", "https://2"))], CATS)
    assert all(r["conflict"] for r in mapped(recs))


def test_no_conflict_when_one_source_lists_both_suppliers():
    recs, _ = build_links([job("motors", cand("Cell A", "KR", "https://1"), cand("Cell B", "CN", "https://1"))], CATS)
    assert not any(r["conflict"] for r in recs)


def test_no_false_conflict_from_agent_notes_in_names():
    recs, _ = build_links([job("motors", cand("NVIDIA", "US", "https://1"),
                               cand("NVIDIA (Jetson Orin GPU/SoC)", "US", "https://2"))], CATS)
    assert {r["supplier"] for r in recs} == {"NVIDIA"} and not any(r["conflict"] for r in recs)


def test_conflict_when_same_supplier_different_country():
    recs = [dict(cand("X", "US", "https://1"), model="A", component="motors", conflict=False),
            dict(cand("X", "CN", "https://2"), model="A", component="motors", conflict=False)]
    flag_conflicts(recs)
    assert all(r["conflict"] for r in recs)


def test_different_tiers_do_not_conflict():
    recs, _ = build_links([job("motors", cand("Motor Co", "US", "https://1")),
                           job("magnets", cand("Mag Co", "CN", "https://2", part="Magnets", tier=2))], CATS)
    assert not any(r["conflict"] for r in recs)


def test_single_country_uses_deepest_tier():
    recs, _ = build_links([job("motors", cand("Motor Co", "US", "https://1")),
                           job("magnets", cand("Mag Co", "CN", "https://2", part="Magnets", tier=2))], CATS)
    assert single_country_components(recs, "A") == {"motors": "CN"}


def test_existing_records_keep_position_and_new_ones_append():
    first, _ = build_links([job("motors", cand("Motor Co", "US", "https://1"))], CATS)
    second, dropped = build_links([job("motors", cand("Motor Co", "US", "https://1")),
                                   job("motors", cand("Motor Co", "US", "https://1"), model="B")],
                                  CATS, existing=first)
    assert second[0] == first[0] and second[1]["model"] == "B" and dropped == []


def test_removed_records_are_reported():
    old = [{"model": "Fake", "component": "motors", "supplier": "F", "supplier_country": "US", "tier": 1,
            "source_url": "https://f", "confidence": "high", "conflict": False}]
    recs, dropped = build_links([job("motors", cand("Motor Co", "US", "https://1"))], CATS, existing=old)
    assert dropped == old and recs[0]["supplier"] == "Motor Co"


def test_existing_spelling_wins():
    names = canonical_names(["Sony Semiconductor Solutions Corp", "Sony (imaging)"], preferred=["Sony Group"])
    assert set(names.values()) == {"Sony Group"}


def test_clean_supplier():
    assert clean_supplier("Sony (Sony Semiconductor Solutions) — IMX686 narrow") == "Sony"
    assert clean_supplier("Skydio, Inc.") == "Skydio, Inc."
    assert clean_supplier("Teledyne FLIR - Boson+") == "Teledyne FLIR"


def test_norm_supplier():
    assert norm_supplier("Sony Semiconductor Solutions Corp.") == "sony semiconductor solutions"


def test_hand_override_rejects_a_verified_link():
    from pipeline.merge import apply_overrides
    jobs = [job("motors", cand("Motor Co", "US", "https://1", conf="low"))]
    n = apply_overrides(jobs, [{"model": "A", "category": "motors", "source_url": "https://1",
                                "confidence": "unmapped", "reason": "hand check"}])
    recs, _ = build_links(jobs, CATS)
    assert n == 1 and mapped(recs) == [] and unmapped(recs) == [("motors", None, 1)]


def test_aliases_fold_spellings_with_a_different_first_word():
    recs, _ = build_links([job("motors", cand("SZ DJI Technology Co., Ltd.", "CN", "https://1"),
                               cand("DJI", "CN", "https://2"))], CATS, aliases={"SZ DJI Technology Co., Ltd.": "DJI"})
    assert {r["supplier"] for r in recs} == {"DJI"} and not any(r["conflict"] for r in recs)


def test_newly_mapped_tier_keeps_old_unmapped_record_in_place():
    first, _ = build_links([job("motors"), job("radio")], CATS)
    second, dropped = build_links([job("motors", cand("Motor Co", "US", "https://1")), job("radio")],
                                  CATS, existing=first)
    assert dropped == [] and second[:len(first)] == first
    assert second[len(first)]["supplier"] == "Motor Co"
