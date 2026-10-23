import math
from typing import Any

from .parser import parse_deck
from .scryfall_client import CardServiceError, ScryfallClient
from .synergy_detector import detect
from .tagger import tag_card
from .threat_scorer import score_categories


async def analyse_deck(data: dict[str, Any], client: ScryfallClient) -> dict[str, Any]:
    parsed = parse_deck(data.get("text", ""), data.get("commander", ""))
    cards: list[dict[str, Any]] = []
    unresolved = []
    normalisations = []
    errors = []
    canonical: dict[str, dict[str, Any]] = {}
    commander_names: list[str] = []
    service_down = False
    if any(not client.store.cached(name)[0] for name in parsed.cards):
        try:
            await client.prefetch(list(parsed.cards))
        except CardServiceError as exc:
            service_down = True
            errors.append(str(exc))
    for name, quantity in parsed.cards.items():
        is_commander = name.casefold() in [c.casefold() for c in parsed.commanders]
        try:
            # After an outage, keep processing cached entries without serial network timeouts.
            if service_down and not client.store.cached(name)[0]:
                unresolved.append({"input": name, "quantity": quantity, "reason": "service unavailable"})
                continue
            card, mode = await client.resolve(name)
        except CardServiceError as exc:
            service_down = True
            if str(exc) not in errors:
                errors.append(str(exc))
            unresolved.append({"input": name, "quantity": quantity, "reason": "service unavailable"})
            continue
        if not card:
            unresolved.append({"input": name, "quantity": quantity, "reason": mode})
            continue
        if name.casefold() != card["name"].casefold():
            normalisations.append({"input": name, "matched": card["name"], "method": mode})
        if is_commander:
            commander_names.append(card["name"])
        if card["name"] in canonical:
            canonical[card["name"]]["quantity"] += quantity
            canonical[card["name"]]["is_commander"] |= is_commander
            continue
        tags = tag_card(card)
        types = card.get("type_line", "")
        for type_name in ("Creature", "Artifact", "Enchantment"):
            if type_name in types:
                tags[f"{type_name.lower()} body"] = ["type:" + type_name]
        oracle = " ".join(f.get("oracle_text", "") for f in card.get("card_faces", [])) or card.get("oracle_text", "")
        if "Creature" in types and float(card.get("cmc") or 0) >= 6:
            tags["expensive creature"] = ["mana value >= 6 + creature"]
        if "Creature" in types and (
            "enters" in oracle.lower() or "when " + card["name"].split(",")[0].lower() in oracle.lower()
        ):
            tags["ETB ability"] = ["text:creature enters ability candidate"]
        if "commander" in oracle.lower():
            tags["commander linked"] = ["oracle:commander reference"]
        if "engine" in tags and float(card.get("cmc") or 0) <= 3:
            tags["cheap engine"] = ["engine mana value <= 3"]
        canonical[card["name"]] = {**card, "quantity": quantity, "tags": tags, "is_commander": is_commander}
    cards = list(canonical.values())
    supplied = sum(parsed.cards.values())
    resolved = sum(c["quantity"] for c in cards)
    warnings = list(parsed.warnings)
    warnings.extend(errors)
    if not parsed.commanders:
        warnings.append(
            "Commander not identified. Enter it separately or use a COMMANDER section; colour-sensitive recommendations are withheld."
        )
    elif len(commander_names) != len(parsed.commanders):
        warnings.append("One or more commanders could not be resolved; colour identity is uncertain.")
    if supplied != 100:
        warnings.append(
            f"{supplied} cards supplied including commander(s); this is {'a partial' if supplied < 100 else 'an oversized'} list."
        )
    commanders = [c for c in cards if c["is_commander"]]
    identity = sorted({colour for c in commanders for colour in c.get("color_identity", [])})
    identity_known = bool(commanders) and len(commander_names) == len(parsed.commanders)
    for card in cards:
        if identity_known and not set(card.get("color_identity", [])) <= set(identity):
            warnings.append(f"{card['name']} is outside the supplied commander colour identity.")
        if card.get("legalities", {}).get("commander") not in ("legal", None):
            warnings.append(f"{card['name']}: Commander legality is {card['legalities']['commander']}.")
        if card["quantity"] > 1 and "Basic" not in card.get("type_line", ""):
            oracle = card.get("oracle_text", "")
            if "any number" not in oracle and "up to" not in oracle:
                warnings.append(f"{card['name']} appears {card['quantity']} times; check singleton legality.")
    if len(commanders) > 1:
        warnings.append("Multiple commanders supplied. Partner/background compatibility requires manual verification.")
    if commanders and any(
        "Legendary" not in c.get("type_line", "")
        or (
            "Creature" not in c.get("type_line", "") and "can be your commander" not in c.get("oracle_text", "").lower()
        )
        for c in commanders
    ):
        warnings.append("Commander eligibility requires manual verification for this selection.")
    completeness = min(1, resolved / 100)
    resolution = resolved / max(1, supplied)
    confidence_number = round(100 * completeness * resolution * (1 if identity_known else 0.75))
    confidence = (
        "High"
        if supplied == 100 and resolution == 1 and identity_known and not warnings
        else "Medium"
        if resolved >= 25 and resolution >= 0.8 and identity_known
        else "Low"
    )
    findings = detect(cards)
    for finding in findings:
        if finding["kind"] == "combo":
            for card in cards:
                if card["name"] in finding["cards"]:
                    card["tags"].setdefault("stank", []).append("verified pattern:" + finding["name"])
                    card["tags"].setdefault("combo piece", []).append("verified pattern:" + finding["name"])
    scores = score_categories(cards, completeness)
    # Engines are additional evidence for stank only when a curated swing card is present, avoiding synonym inflation.
    lands = sum(c["quantity"] for c in cards if "Land" in c.get("type_line", ""))
    nonlands = [c for c in cards if "Land" not in c.get("type_line", "")]
    average_mv = round(
        sum(float(c.get("cmc") or 0) * c["quantity"] for c in nonlands) / max(1, sum(c["quantity"] for c in nonlands)),
        2,
    )
    leaders = sorted(scores, key=lambda key: scores[key]["score"], reverse=True)
    plan = [f["name"] for f in findings if f["kind"] != "combo"][:3]
    keyword_plan = sorted(
        {tag for c in cards for tag in ("cascade", "discover", "prowess", "ninjutsu", "landfall") if tag in c["tags"]}
    )
    if keyword_plan:
        plan = ["Observed theme: " + ", ".join(keyword_plan)] + plan[:2]
    if not plan:
        plan = [name for name in leaders if scores[name]["score"] >= 1][:3]
    finishers = [c["name"] for c in cards if "finisher" in c["tags"] or "bomb" in c["tags"]]
    weaknesses = []
    for name in ("Spot Interaction", "Card Advantage", "Resilience / Protection"):
        if scores[name]["score"] < 2:
            weaknesses.append(
                f"Little observed {name.lower()}; missing cards may change this."
                if supplied < 100
                else f"Low observed {name.lower()}; inspect supporting cards."
            )
    if supplied == 100 and lands < 30:
        weaknesses.append(f"Only {lands} land cards observed. MDFCs and nonland mana need manual review.")
    return {
        "name": data.get("name") or "Untitled deck",
        "commander": commander_names,
        "identity": identity,
        "identity_known": identity_known,
        "supplied": supplied,
        "resolved": resolved,
        "missing": max(0, 100 - resolved),
        "confidence": {
            "level": confidence,
            "index": confidence_number,
            "completeness": round(completeness, 2),
            "note": "Ranges are conservative heuristic bounds, not statistical confidence intervals. Missing cards are unknown.",
        },
        "cards": cards,
        "scores": scores,
        "engines": findings,
        "unmatched": unresolved,
        "normalisations": normalisations,
        "warnings": warnings,
        "excluded": parsed.excluded,
        "overview": {
            "plan": plan,
            "lands": lands,
            "average_mana_value": average_mv,
            "finishers": finishers,
            "weaknesses": weaknesses,
            "commander_role": ", ".join(sorted({tag for c in commanders for tag in c["tags"] if "body" not in tag}))
            or "No clear role inferred.",
            "interaction": [
                c["name"]
                for c in cards
                if set(c["tags"]) & {"removal", "counterspell", "board wipe", "graveyard hate", "protection"}
            ],
        },
        "validity_warnings": len(warnings),
        "coverage_observation_fraction": min(1, resolved / 100),
        "range_note": f"Up to {math.ceil(max(0, 100 - resolved))} unknown slots can alter scores.",
    }
