"""Composable text rules, type rules and explicit card overrides, with provenance."""

import json
import re
from pathlib import Path
from typing import Any

CONFIG = Path(__file__).parent / "config"
# Rules are intentionally conservative. Special wording is handled by overrides.
RULES = {
    "ramp": r"add (?:\{[^}]+\})|search your library for (?:up to \w+ )?(?:a |an )?(?:basic )?land.*battlefield",
    "mana dork": r"NEVER_MATCH",
    "cost reduction": r"(?:spells? you cast|cost to cast).*cost.*less|spells? .*cost.*less to cast",
    "draw": r"\bdraw (?:a|two|three|four|x|that many|\d+) cards?\b|whenever .*draw a card",
    "impulse draw": r"exile .*top.*library.*(?:play|cast)|(?:play|cast).*exiled.*(?:this turn|next turn)",
    "tutor": r"search your library for (?!.*(?:basic land|land card))",
    "graveyard hate": r"exile (?:all cards? from |target cards? from |(?:up to .*? )?target .*? from |.*?cards? (?:from|in) )(?:.*?graveyard)|exile target player.s graveyard|cards in graveyards can.t|if .*would.*graveyard.*exile",
    "self mill": r"\bmill\b|put the top .*your library into your graveyard",
    "recursion": r"return .*?(?:from |in )your graveyard.*?(?:hand|battlefield)|(?:cast|play) .*?(?:from|in) your graveyard",
    "reanimation": r"return .*?(?:from |in )(?:a |your |any )?graveyard.*?battlefield|put .*?creature.*?graveyard.*?battlefield",
    "sacrifice outlet": r"(?:sacrifice (?:a|another|an|x|one|two|three|any number of) (?:artifact|creature|permanent|token)[^.:\n]*:)",
    "death payoff": r"(?:whenever|when) [^,\n.]*?(?:dies|die\b|you sacrifice)",
    "removal": r"(?:destroy|exile|return) (?:another |up to .*? )?target (?:nonland |nonbasic |attacking |blocking |tapped |nontoken |nonblack |artifact |enchantment |creature |permanent|spell|planeswalker)|target .*?gets -\d+/-\d+",
    "counterspell": r"counter target (?:\w+ )?spell",
    "board wipe": r"(?:destroy|exile|return) all (?:\w+ )?(?:creatures|permanents|artifacts|enchantments)|each creature gets -|damage to each creature",
    "protection": r"you control (?:gain|have).*?(?:hexproof|indestructible|protection)|phase out|phases out|protection from",
    "hexproof": r"\bhexproof\b",
    "indestructible": r"\bindestructible\b",
    "evasion": r"\bflying\b|\btrample\b|\bmenace\b|can.t be blocked|\bfear\b|\bshadow\b|\bhorsemanship\b",
    "unblockable": r"can.t be blocked",
    "flying": r"\bflying\b",
    "trample": r"\btrample\b",
    "menace": r"\bmenace\b",
    "double strike": r"\bdouble strike\b",
    "extra combat": r"additional combat phase|additional combat phases",
    "token generation": r"create .*?tokens?\b",
    "counters": r"(?:put|enters with|enters .*with|double the number of).*?(?:\+1/\+1|charge|loyalty|oil|experience|poison) counters?",
    "proliferate": r"\bproliferate\b",
    "life gain": r"\blifelink\b|you gain .*?life",
    "life drain": r"(?:each opponent|target opponent|that player|each player).*?loses? .*?life",
    "damage amplifier": r"(?:double|triple).*damage|damage.*(?:twice|three times)",
    "ETB payoff": r"whenever .*?(?:enters|enter) .*?(?:battlefield|under your control)",
    "cast payoff": r"whenever you cast|whenever a player casts",
    "artifact synergy": r"whenever [^,\n.]*?artifact|for each artifact|artifacts you control|artifact spells|sacrifice an artifact",
    "enchantment synergy": r"whenever [^,\n.]*?enchantment|for each enchantment|enchantments you control|enchantment spells",
    "graveyard synergy": r"for each .*?graveyard|cards? in (?:your|all|opponents.?) graveyards?|from (?:an opponent.s|opponents.) graveyards?",
    "opponent resources": r"(?:from|in) (?:an opponent.s|opponents.|another player.s) graveyard|gain control of target",
    "anthem": r"(?:creatures|tokens) you control get \+|other .*?you control get \+",
    "blink": r"exile .*?(?:you control|target creature).*?return .*?battlefield",
    "bounce": r"return .*?you control to (?:its|their|your|owners.) hand",
    "life resource": r"pay .*?life|rather than pay.*mana cost|life total becomes",
    "commander damage enabler": r"commander.*?(?:\+|double strike|can.t be blocked)|equipped creature gets \+|enchanted creature gets \+",
}


def tag_card(card: dict[str, Any]) -> dict[str, list[str]]:
    evidence: dict[str, list[str]] = {}
    faces = card.get("card_faces") or [card]
    for face in faces:
        text = (face.get("oracle_text", "") + " " + " ".join(card.get("keywords", []))).lower()
        for tag, pattern in RULES.items():
            if re.search(pattern, text, re.DOTALL):
                evidence.setdefault(tag, []).append(f"oracle:{face.get('name', card['name'])}:{tag}")
    for keyword in card.get("keywords", []):
        if keyword in ("Cascade", "Discover"):
            evidence[keyword.lower()] = ["keyword:" + keyword]
            evidence.setdefault("cast payoff", []).append("keyword:" + keyword)
        if keyword in ("Prowess", "Ninjutsu", "Landfall"):
            evidence[keyword.lower()] = ["keyword:" + keyword]
    type_line = card.get("type_line", "")
    if "Land" in type_line:
        # Ordinary land mana is not acceleration.
        evidence.pop("ramp", None)
    if "Creature" in type_line and "ramp" in evidence:
        evidence["mana dork"] = ["type:creature + ramp"]
    if "ramp" in evidence and float(card.get("cmc") or 0) <= 1:
        evidence["fast mana"] = ["mana value <= 1 + ramp"]
    overrides = json.loads((CONFIG / "tag_overrides.json").read_text())
    override = overrides.get(card["name"], {})
    for tag in override.get("remove", []):
        evidence.pop(tag, None)
    for tag in override.get("add", []):
        evidence[tag] = ["manual:tag_overrides.json"]
    return evidence
