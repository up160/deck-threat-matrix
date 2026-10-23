"""Personal philosophy stays separate from official bracket rules."""

from typing import Any

from .matchup_analyser import oracle
from .opponent_profiles import load_profiles


def philosophy(environment: str) -> dict:
    return load_profiles()["environments"][environment]


def bracket_advisory(deck: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": "Manual official bracket review required",
        "note": "B2/B3 here describe your personal philosophy. Official Commander brackets and Game Changers change; this V1 does not certify them. Check the current official rules and Game Changers list, plus the verified combo findings.",
        "game_changers": [c["name"] for c in deck["cards"] if c.get("game_changer") is True],
        "game_changer_metadata_missing": [
            c["name"] for c in deck["cards"] if not isinstance(c.get("game_changer"), bool)
        ],
        "extra_turn_candidates": [c["name"] for c in deck["cards"] if "extra turn" in oracle(c)],
        "mass_land_denial_candidates": [
            c["name"]
            for c in deck["cards"]
            if any(
                phrase in oracle(c)
                for phrase in ("destroy all lands", "exile all lands", "lands don't untap", "lands don’t untap")
            )
        ],
        "snapshot": "Scryfall metadata captured at card lookup; cache may be stale. No maintained official restriction snapshot is bundled.",
        "observed_tutors": [c["name"] for c in deck["cards"] if "tutor" in c["tags"]],
        "observed_combos": [e["name"] for e in deck["engines"] if e["kind"] == "combo"],
        "source": "https://magic.wizards.com/en/formats/commander",
    }
