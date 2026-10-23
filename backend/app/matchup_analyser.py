"""Relevant-answer scoring, never just total-score comparison."""

import json
import re
from typing import Any

from .tagger import CONFIG

AXES = {
    "Graveyard recursion": ["Graveyard Power", "Recursion", "Graveyard Reliance"],
    "Enchantment engines": ["Enchantment Reliance"],
    "Artifact engines": ["Artifact Reliance"],
    "Creature pressure": ["Creature Reliance", "Combat Scaling"],
    "Evasive commander damage": ["Commander Dependency", "Evasion"],
    "Wide token boards": ["Token Production"],
    "Explosive engines": ["Combo / Engine Density", "Sacrifice Value", "Table Inevitability"],
    "Single-card swings": ["Single-Card Bombs", "Burst Potential"],
    "Counter scaling": ["Counter / Proliferate Scaling"],
    "Tutors / consistency": ["Tutors / Consistency"],
    "Board wipes / attrition": ["Board Wipes"],
    "Life drain / resources": ["Life Gain / Life Resource Abuse"],
}


def oracle(card: dict[str, Any]) -> str:
    return (
        card.get("oracle_text", "") or " ".join(f.get("oracle_text", "") for f in card.get("card_faces", []))
    ).lower()


def removal_targets(card: dict[str, Any]) -> set[str]:
    text = oracle(card)
    types: set[str] = set()
    # Inspect the target clause, so unrelated mentions of a creature do not imply creature removal.
    for match in re.finditer(r"(?:destroy|exile|return) (?:up to [^.]*? )?target ([^.;]+)", text):
        clause = match[1].split(" to ")[0]
        if "you control" in clause:
            continue
        if "permanent" in clause:
            types.update(("creature", "artifact", "enchantment", "planeswalker"))
        for kind in ("creature", "artifact", "enchantment", "planeswalker"):
            if kind in clause:
                types.add(kind)
    if "exile" in text and "return" in text and "battlefield" in text and "blink" in card.get("tags", {}):
        types.clear()
    if "gets -" in text and "target creature" in text:
        types.add("creature")
    # Conditional and alternative-mode staples with wording beyond the basic parser.
    overrides = {
        "Cyclonic Rift": ["creature", "artifact", "enchantment", "planeswalker"],
        "Chaos Warp": ["creature", "artifact", "enchantment", "planeswalker"],
        "Feed the Swarm": ["creature", "enchantment"],
    }
    types.update(overrides.get(card["name"], []))
    return types


def counter_can_target(card: dict[str, Any], kind: str) -> bool:
    text = oracle(card)
    match = re.search(r"counter target ([^.;]*?)spell", text)
    if not match:
        return False
    restriction = match[1]
    if not restriction.strip():
        return True
    if "noncreature" in restriction:
        return kind != "creature"
    listed = [
        t for t in ("creature", "artifact", "enchantment", "instant", "sorcery", "planeswalker") if t in restriction
    ]
    return not listed or kind in listed


def answer_base(card: dict[str, Any], axis: str) -> tuple[float, str]:
    tags = card["tags"]
    targets = removal_targets(card)
    counter = "counterspell" in tags
    text = oracle(card)
    if axis == "Graveyard recursion":
        if "graveyard hate" in tags:
            return 1.2, "Direct graveyard disruption; inspect target and timing restrictions."
        return (
            (0.15, "Can counter some recursion spells before resolution; cannot clear a graveyard.")
            if counter
            else (0, "")
        )
    if axis == "Board wipes / attrition":
        if "protection" in tags:
            return 1.0, "Protection can preserve the board; exile/sacrifice and timing can bypass it."
        if "recursion" in tags:
            return 0.55, "Recovery after losses, rather than prevention."
        return (0.65, "Can counter an eligible wipe before resolution.") if counter else (0, "")
    if axis == "Tutors / consistency":
        return (0.6, "Countermagic can stop eligible search spells; not activated abilities.") if counter else (0, "")
    required = {
        "Enchantment engines": "enchantment",
        "Artifact engines": "artifact",
        "Creature pressure": "creature",
        "Evasive commander damage": "creature",
        "Wide token boards": "creature",
        "Counter scaling": "creature",
    }
    if axis in required:
        kind = required[axis]
        counter = counter and counter_can_target(card, kind)
        if "board wipe" in tags and (kind in text or card["name"] == "Cyclonic Rift"):
            return (1.4 if axis == "Wide token boards" else 0.85), "Mass interaction, subject to its exclusions."
        if kind in targets and "removal" in tags:
            value = 0.3 if axis == "Wide token boards" else 1.0
            return value, "Can interact with a resolved " + kind + "; restrictions still apply."
        return (
            (0.4, "Can counter eligible threats before resolution, not remove a resolved engine.")
            if counter
            else (0, "")
        )
    if counter:
        return 0.85, "Can counter an eligible spell before resolution; cannot stop every activated/triggered ability."
    if "removal" in tags and targets:
        return 0.6, "Can disrupt some permanent-based engines; nonpermanent and triggered effects may evade it."
    if "board wipe" in tags:
        return 0.4, "Can reset some board-based engines; cannot answer all burst effects."
    return 0, ""


def answer_evidence(card: dict[str, Any], axis: str) -> dict[str, Any] | None:
    base, reason = answer_base(card, axis)
    if base == 0:
        return None
    mv = float(card.get("cmc") or 0)
    instant = "Instant" in card.get("type_line", "") or ("Flash" in card.get("keywords", []))
    # Low casting cost is only a proxy: separate activation and ETB delays remain visible.
    speed = 1.15 if instant and mv <= 2 else 1.0 if instant or mv <= 2 else 0.8 if mv <= 4 else 0.6
    if card["name"] == "Bojuka Bog":
        speed = 0.65
    reusable = "repeatable answer" in card["tags"] or "persistent answer" in card["tags"]
    repeat = 1.2 if reusable else 1.0
    resilience = 1.1 if set(card["tags"]) & {"hexproof", "indestructible"} else 1.0
    breadth = 1.1 if len(removal_targets(card)) >= 3 else 1.0
    narrow = "targeted hate" in card["tags"]
    breadth *= 0.9 if narrow else 1
    weight = base * speed * repeat * resilience * breadth * card["quantity"]
    return {
        "card": card["name"],
        "weight": round(weight, 3),
        "base": base,
        "speed_factor": speed,
        "repeat_factor": repeat,
        "resilience_factor": resilience,
        "breadth_factor": round(breadth, 2),
        "reusable": reusable,
        "narrow": narrow,
        "reason": reason,
        "limitations": "Activation costs, board access, MDFC face choice and timing require manual review.",
    }


def compare(opponent: dict[str, Any], mine: dict[str, Any], profile: str, profiles: dict[str, Any]) -> dict[str, Any]:
    config = json.loads((CONFIG / "scoring.json").read_text())["matchup"]
    profile_weights = profiles["opponents"].get(profile, {}).get("weights", {})
    rows = []
    for axis, categories in AXES.items():
        threat = max(opponent["scores"][category]["score"] for category in categories)
        if threat < 0.5:
            continue
        evidence = [e for c in mine["cards"] if (e := answer_evidence(c, axis)) is not None]
        coverage = round(min(5, sum(e["weight"] for e in evidence) / config["answer_threshold"] * 5), 1)
        status = (
            "Strong"
            if coverage >= max(threat, 1.5)
            else "Adequate"
            if coverage >= 0.75 * threat
            else "Weak"
            if coverage >= 0.4 * threat
            else "Critical"
        )
        multiplier = min(config["profile_max"], profile_weights.get(axis, 1))
        rows.append(
            {
                "axis": axis,
                "threat": threat,
                "coverage": coverage,
                "status": status,
                "weight": round(threat**2 * multiplier, 3),
                "profile_multiplier": multiplier,
                "answers": evidence,
                "threat_cards": sorted(
                    {e["card"] for cat in categories for e in opponent["scores"][cat]["contributors"]}
                ),
                "coverage_range": [coverage, 5 if mine["missing"] else coverage],
                "threat_range": [threat, 5 if opponent["missing"] else threat],
            }
        )
    pressure = round(
        min(
            1,
            (
                mine["scores"]["Speed"]["score"]
                + mine["scores"]["Combat Scaling"]["score"]
                + mine["scores"]["Burst Potential"]["score"]
            )
            / 15,
        ),
        3,
    )
    denominator = sum(r["weight"] for r in rows)
    coverage_ratio = (
        sum(r["weight"] * min(1, r["coverage"] / max(r["threat"], 1)) for r in rows) / denominator
        if denominator
        else None
    )
    readiness = (
        round(100 * (config["coverage_weight"] * coverage_ratio + config["pressure_weight"] * pressure))
        if coverage_ratio is not None
        else None
    )
    # Deliberately wide bounds when missing cards could introduce entirely new threats/answers.
    partial = bool(opponent["missing"] or mine["missing"])
    risks = [r for r in rows if r["status"] == "Strong" and len(r["answers"]) >= 3]
    risk = "High" if risks else "Medium" if any(r["status"] in ("Strong", "Adequate") for r in rows) else "Low"
    advice = [
        f"{r['axis']}: observed coverage is already strong. Do not add more dedicated hate unless the local meta changes."
        for r in risks
    ]
    return {
        "rows": sorted(
            rows, key=lambda r: r["weight"] * (1 - min(1, r["coverage"] / max(1, r["threat"]))), reverse=True
        ),
        "readiness": readiness,
        "readiness_range": [0, 100] if partial and readiness is not None else [readiness, readiness],
        "pressure": pressure,
        "coverage_ratio": round(coverage_ratio, 3) if coverage_ratio is not None else None,
        "overreaction": {"risk": risk, "advice": advice},
        "partial": partial,
        "note": "Observed coverage index, not win probability. Partial lists cannot establish overall readiness; 0–100 bounds acknowledge unknown threats and answers."
        if partial
        else "Coverage index, not win probability; activation costs, sequencing and multiplayer politics are not simulated.",
        "formula": "100 × (0.85 × Σ(T² × profile × min(1,C/max(T,1))) / Σ(T² × profile) + 0.15 × pressure)",
        "version": "1.0",
    }
