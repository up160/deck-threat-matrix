"""Versioned category scoring with per-card contributions."""

import json
from typing import Any

from .tagger import CONFIG


def score_categories(cards: list[dict[str, Any]], completeness: float) -> dict[str, Any]:
    config = json.loads((CONFIG / "scoring.json").read_text())
    scores = {}
    for name, definition in config["categories"].items():
        contributors = []
        for card in cards:
            hits = {tag: weight for tag, weight in definition["tags"].items() if tag in card["tags"]}
            if not hits:
                continue
            # One physical card contributes its strongest matching role, never a sum of synonymous tags.
            weight = max(hits.values()) * card["quantity"]
            contributors.append(
                {
                    "card": card["name"],
                    "quantity": card["quantity"],
                    "tags": list(hits),
                    "weight": round(weight, 2),
                    "rules": {tag: card["tags"][tag] for tag in hits},
                }
            )
        total = sum(c["weight"] for c in contributors)
        value = round(min(5, total / definition["threshold"] * 5), 1)
        # Maximum extra contribution under the configured per-card weight; deliberately conservative.
        missing = max(0, 100 - round(completeness * 100))
        upper = round(min(5, value + missing * max(definition["tags"].values()) / definition["threshold"] * 5), 1)
        scores[name] = {
            "score": value,
            "range": [value, upper],
            "contributors": contributors,
            "threshold": definition["threshold"],
            "description": definition["description"],
        }
    return scores
