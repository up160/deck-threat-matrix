import json
from typing import Any

from .tagger import CONFIG


def detect(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    findings = []
    for pattern in json.loads((CONFIG / "patterns.json").read_text()):
        groups = [[c["name"] for c in cards if tag in c["tags"]] for tag in pattern["requires"]]
        if all(groups) and len(groups[0]) >= pattern.get("minimum_first", 1):
            findings.append(
                {**pattern, "cards": list(dict.fromkeys(n for group in groups for n in group)), "conditional": True}
            )
    names = {c["name"] for c in cards}
    for combo in json.loads((CONFIG / "combos.json").read_text()):
        if set(combo["cards"]) <= names:
            findings.append({**combo, "conditional": True})
    return findings
