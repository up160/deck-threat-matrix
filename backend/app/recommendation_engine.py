"""Smallest useful curated additions; all candidate cards resolved by Scryfall."""

import json
from typing import Any

from .deck_profiles import philosophy
from .matchup_analyser import answer_evidence
from .scryfall_client import CardServiceError, ScryfallClient
from .tagger import CONFIG, tag_card


async def recommend(
    mine: dict[str, Any], matchup: dict[str, Any], environment: str, client: ScryfallClient
) -> dict[str, Any]:
    policy = philosophy(environment)
    target_ratio = policy["desired_coverage_ratio"]
    weak = [r for r in matchup["rows"] if r["status"] in ("Critical", "Weak") and r["threat"] >= 1.5]
    if not weak:
        return {
            "changes": [],
            "message": "No changes justified by observed coverage. Unknown cards may change this conclusion.",
            "withheld": [],
        }
    if not mine["identity_known"]:
        return {
            "changes": [],
            "message": "Resolve your commander before colour-sensitive recommendations can be made.",
            "withheld": [],
        }
    catalogue = json.loads((CONFIG / "recommendations.json").read_text())
    existing = {c["name"] for c in mine["cards"]}
    candidates = []
    withheld = []
    for candidate in catalogue:
        relevant = [r for r in weak if r["axis"] in candidate["axes"]]
        if not relevant or candidate["name"] in existing or not set(candidate["identity"]) <= set(mine["identity"]):
            continue
        if candidate.get("premium"):
            continue
        if candidate["name"] == "Rest in Peace" and mine["scores"]["Graveyard Reliance"]["score"] >= 1:
            withheld.append("Rest in Peace: conflicts with your observed graveyard plan.")
            continue
        value = sum(r["weight"] * (r["threat"] - r["coverage"]) for r in relevant)
        if candidate["targeted"]:
            value *= policy["targeted_hate_penalty"]
        candidates.append((value, candidate))
    candidates.sort(key=lambda item: item[0], reverse=True)
    changes: list[dict[str, Any]] = []
    used_cuts: set[str] = set()
    protected = {name for engine in mine["engines"] for name in engine["cards"]}
    # Rank cuts by redundancy/low observed contribution, keeping lands, commanders, core engines and scarce answers.
    cuttable = [
        c
        for c in mine["cards"]
        if not c["is_commander"]
        and "Land" not in c.get("type_line", "")
        and c["name"] not in protected
        and not set(c["tags"])
        & {"ramp", "draw", "protection", "counterspell", "graveyard hate", "removal", "board wipe", "finisher", "bomb"}
    ]

    def cut_weight(card: dict[str, Any]) -> float:
        return (
            len([t for t in card["tags"] if "body" not in t])
            + (2 if "Creature" in card.get("type_line", "") else 0)
            - float(card.get("cmc") or 0) * 0.05
        )

    cuttable.sort(key=cut_weight)
    coverage = {r["axis"]: r["coverage"] for r in weak}
    for _, candidate in candidates:
        if len(changes) >= 5:
            break
        relevant = [
            r for r in weak if r["axis"] in candidate["axes"] and coverage[r["axis"]] < target_ratio * r["threat"]
        ]
        if not relevant:
            continue
        try:
            card, _mode = await client.resolve(candidate["name"])
        except CardServiceError:
            withheld.append(f"{candidate['name']}: card data unavailable; recommendation not verified.")
            continue
        if (
            not card
            or card.get("legalities", {}).get("commander") != "legal"
            or not set(card["color_identity"]) <= set(mine["identity"])
        ):
            withheld.append(f"{candidate['name']}: could not verify Commander legality and colour identity.")
            continue
        # Disallow Reserved List and extreme known prices; absent price remains explicitly unknown.
        prices = card.get("prices", {})
        known_prices = [float(v) for k, v in prices.items() if k in ("usd", "eur") and v]
        if card.get("reserved") or (known_prices and max(known_prices) > 250):
            withheld.append(f"{candidate['name']}: excluded by conservative premium-card policy.")
            continue
        tagged = {**card, "tags": tag_card(card), "quantity": 1}
        improvements = []
        for row in relevant:
            answer = answer_evidence(tagged, row["axis"])
            if answer:
                gain = answer["weight"] / 4 * 5
                coverage[row["axis"]] = min(5, coverage[row["axis"]] + gain)
                improvements.append(row["axis"])
        if not improvements:
            continue
        cut = next((c for c in cuttable if c["name"] not in used_cuts), None)
        if cut:
            used_cuts.add(cut["name"])
        changes.append(
            {
                "add": candidate["name"],
                "reason": candidate["reason"],
                "axes": improvements,
                "targeted_hate": candidate["targeted"],
                "filthy": candidate["filthy"],
                "cut": cut["name"] if cut else None,
                "cut_reason": "Candidate with comparatively few detected roles, outside identified engines. Theme and hidden synergies need your review; this is not a claim that the card is bad."
                if cut
                else "No safe cut inferred. Review the full list rather than removing mana, interaction or an identified engine.",
                "provisional": bool(mine["missing"]),
                "prices": prices,
                "bracket_note": f"Compatible with {environment} philosophy; official bracket impact requires the separate advisory check.",
            }
        )
    return {
        "changes": changes,
        "message": "Smallest set within the curated catalogue that improves observed gaps; up to five. Additions are not applied automatically. Candidate cuts require review.",
        "withheld": withheld,
        "remaining_gaps": [r["axis"] for r in weak if coverage[r["axis"]] < target_ratio * r["threat"]],
    }
