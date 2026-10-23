import asyncio

from conftest import card

from backend.app.deck_analyser import analyse_deck
from backend.app.matchup_analyser import answer_base, compare, removal_targets
from backend.app.opponent_profiles import load_profiles
from backend.app.recommendation_engine import recommend
from backend.app.synergy_detector import detect
from backend.app.tagger import tag_card
from backend.app.threat_scorer import score_categories


def analyse(text, client):
    return asyncio.run(analyse_deck({"text": text, "commander": "Test Commander"}, client))


def test_tagger_ramp_not_basic_land():
    assert "ramp" in tag_card(card("Sol Ring", "{T}: Add {C}{C}.", mv=1))
    assert "ramp" not in tag_card(card("Forest", "{T}: Add {G}.", "Basic Land — Forest", 0))


def test_overrides_and_provenance():
    tags = tag_card(card("Reanimate"))
    assert "reanimation" in tags
    assert tags["recursion"] == ["manual:tag_overrides.json"]


def test_partial_confidence_and_uncertainty(client):
    deck = analyse("Sol Ring\nBlood Artist", client)
    assert deck["confidence"]["level"] == "Low"
    assert deck["resolved"] == 3
    assert deck["scores"]["Acceleration"]["range"][1] > deck["scores"]["Acceleration"]["score"]
    assert len(deck["scores"]) == 25


def test_complete_list_confidence(client):
    deck = analyse("99 Forest", client)
    assert deck["supplied"] == 100
    assert deck["confidence"]["level"] == "High"
    assert deck["scores"]["Acceleration"]["score"] == 0


def test_unknown_lower_confidence(client):
    client.store.cache("Imaginary Card", None)
    deck = analyse("Imaginary Card\nSol Ring", client)
    assert deck["unmatched"][0]["input"] == "Imaginary Card"
    assert deck["resolved"] == 2


def test_synergy_not_claimed_infinite(client):
    deck = analyse("Viscera Seer\nBlood Artist", client)
    findings = deck["engines"]
    assert any(e["name"] == "Sacrifice value" and e["kind"] == "engine" for e in findings)
    assert not any(e["kind"] == "combo" for e in findings)


def test_coverage_is_relevant(client):
    opponent = analyse("6 Mystic Engine", client)
    mine = analyse("Swords to Plowshares", client)
    result = compare(opponent, mine, "", load_profiles())
    row = next(r for r in result["rows"] if r["axis"] == "Enchantment engines")
    assert row["coverage"] == 0
    assert row["status"] == "Critical"
    mine = analyse("Beast Within", client)
    row = next(r for r in compare(opponent, mine, "", load_profiles())["rows"] if r["axis"] == "Enchantment engines")
    assert row["coverage"] > 0


def test_overreaction_sufficient_graveyard_coverage(client):
    opponent = analyse("Reanimate\nAnimate Dead\nEternal Witness\nStitcher's Supplier", client)
    mine = analyse("Soul-Guide Lantern\nBojuka Bog\nScavenger Grounds\nScavenging Ooze", client)
    matchup = compare(opponent, mine, "Simon", load_profiles())
    row = next(r for r in matchup["rows"] if r["axis"] == "Graveyard recursion")
    assert row["status"] == "Strong"
    assert matchup["overreaction"]["risk"] == "High"
    assert matchup["overreaction"]["advice"]
    recs = asyncio.run(recommend(mine, matchup, "B2", client))
    assert not any("Graveyard recursion" in c["axes"] for c in recs["changes"])


def test_profile_does_not_invent_threats(client):
    opponent = analyse("Forest", client)
    mine = analyse("Sol Ring", client)
    result = compare(opponent, mine, "Simon", load_profiles())
    assert not any(r["axis"] == "Graveyard recursion" for r in result["rows"])


def test_scoring_counts_strongest_role_once():
    scores = score_categories([{"name": "Mana", "quantity": 1, "tags": {"ramp": ["a"], "fast mana": ["b"]}}], 1)
    assert scores["Acceleration"]["contributors"][0]["weight"] == 1.5
    assert all(0 <= s["score"] <= 5 for s in scores.values())


def test_removal_target_clause():
    assert removal_targets(card("Test", "Exile target creature. Create an enchantment token.")) == {"creature"}
    assert "enchantment" in removal_targets(card("Beast Within", "Destroy target permanent."))


def test_lantern_is_not_reusable(client):
    deck = analyse("Soul-Guide Lantern", client)
    assert "repeatable answer" not in next(c for c in deck["cards"] if c["name"] == "Soul-Guide Lantern")["tags"]


def test_mdfc_faces_have_provenance():
    tags = tag_card(
        card(
            "Front // Back",
            card_faces=[{"name": "Front", "oracle_text": "Draw two cards."}, {"name": "Back", "oracle_text": "Flying"}],
        )
    )
    assert "Front" in tags["draw"][0]
    assert "Back" in tags["flying"][0]


def test_verified_combo_has_prerequisites():
    result = detect([{"name": "Heliod, Sun-Crowned", "tags": {}}, {"name": "Walking Ballista", "tags": {}}])
    assert result[0]["kind"] == "combo"
    assert "two" in result[0]["explanation"]


def test_no_resolved_permanent_claim_for_counterspell():
    tagged = {**card("Counterspell", "Counter target spell.", "Instant"), "tags": {"counterspell": []}}
    base, explanation = answer_base(tagged, "Enchantment engines")
    assert base < 1
    assert "not remove" in explanation


def test_narrow_counterspells_are_not_universal():
    negate = {**card("Negate", "Counter target noncreature spell.", "Instant"), "tags": {"counterspell": []}}
    scatter = {**card("Essence Scatter", "Counter target creature spell.", "Instant"), "tags": {"counterspell": []}}
    assert answer_base(negate, "Creature pressure")[0] == 0
    assert answer_base(scatter, "Enchantment engines")[0] == 0


def test_own_creature_blink_is_not_enemy_removal():
    blink = {
        **card("Blink", "Exile target creature you control, then return it to the battlefield."),
        "tags": {"removal": [], "blink": []},
    }
    assert removal_targets(blink) == set()
    assert answer_base(blink, "Creature pressure")[0] == 0


def test_reminder_text_and_removal_are_not_false_engines():
    spawn = card(
        "Spawn Maker",
        "Whenever you cast a creature spell, create two Eldrazi Spawn creature tokens. They have “Sacrifice this creature: Add {C}.”",
        "Enchantment",
    )
    tags = tag_card(spawn)
    assert "sacrifice outlet" not in tags
    assert "death payoff" not in tags
    destroy = card("Artifact Hunter", "Whenever this creature attacks, destroy target artifact.", "Creature")
    assert "artifact synergy" not in tag_card(destroy)


def test_recommendation_targets_gap_and_protects_commander(client, tmp_path, monkeypatch):
    import json

    from backend.app import recommendation_engine
    from backend.app.tagger import CONFIG

    catalogue = json.loads((CONFIG / "recommendations.json").read_text())
    (tmp_path / "recommendations.json").write_text(
        json.dumps([c for c in catalogue if c["name"] in ("Beast Within", "Generous Gift")])
    )
    monkeypatch.setattr(recommendation_engine, "CONFIG", tmp_path)
    opponent = analyse("8 Mystic Engine", client)
    mine = analyse("Vanilla Giant\nForest", client)
    matchup = compare(opponent, mine, "", load_profiles())
    result = asyncio.run(recommendation_engine.recommend(mine, matchup, "B2", client))
    assert result["changes"]
    assert all("Enchantment engines" in c["axes"] for c in result["changes"])
    assert all(c["cut"] not in ("Test Commander", "Forest") for c in result["changes"])
    assert len(result["changes"]) <= 5
    assert all(c["provisional"] for c in result["changes"])


def test_recommendations_withheld_without_commander_identity(client):
    mine = analyse("Sol Ring", client)
    mine["identity_known"] = False
    matchup = {
        "rows": [{"axis": "Enchantment engines", "status": "Critical", "threat": 5, "coverage": 0, "weight": 25}]
    }
    result = asyncio.run(recommend(mine, matchup, "B2", client))
    assert not result["changes"]
    assert "commander" in result["message"]
