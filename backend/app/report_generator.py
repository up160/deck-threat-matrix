from typing import Any


def markdown(report: dict[str, Any]) -> str:
    opponent, mine, matchup = report["opponent"], report["mine"], report["matchup"]
    readiness = matchup["readiness"]
    lines = [
        f"# Deck Threat Matrix: {opponent['name']} vs {mine['name']}",
        f"Environment: {report['environment']}. Scoring version: {matchup['version']}.",
        f"Observed readiness: {readiness if readiness is not None else 'Unavailable'}{'%' if readiness is not None else ''} (not win probability).",
        matchup["note"],
        f"Overreaction risk: {matchup['overreaction']['risk']}",
        "",
    ]
    for label, deck in [("Opponent", opponent), ("My deck", mine)]:
        lines += [
            f"## {label}: {deck['name']}",
            f"Commander: {', '.join(deck['commander']) or 'Unknown'}",
            f"Confidence: {deck['confidence']['level']}; {deck['resolved']}/{deck['supplied']} cards resolved.",
            "Likely plan: " + (", ".join(deck["overview"]["plan"]) or "Insufficient evidence."),
            "Commander role: " + deck["overview"]["commander_role"],
            "Likely finishers: " + (", ".join(deck["overview"]["finishers"]) or "None confidently identified."),
            "Important interaction: " + (", ".join(deck["overview"]["interaction"]) or "None observed."),
            "Weaknesses: " + ("; ".join(deck["overview"]["weaknesses"]) or "None confidently inferred."),
            "Resilience: " + str(deck["scores"]["Resilience / Protection"]["score"]) + "/5",
            "",
        ]
        for warning in deck["warnings"]:
            lines.append("- Warning: " + warning)
        for unknown in deck["unmatched"]:
            lines.append(f"- Unresolved: {unknown['input']} ({unknown['reason']})")
        for name, score in deck["scores"].items():
            evidence = (
                ", ".join(f"{c['card']} [{', '.join(c['tags'])}; weight {c['weight']}]" for c in score["contributors"])
                or "No observed contributors"
            )
            lines.append(f"- {name}: {score['score']}/5; range {score['range']}. {evidence}")
        lines.append("### Engines and synergies")
        for engine in deck["engines"]:
            lines.append(
                f"- {engine['name']} ({engine['kind']}): {engine['explanation']} Cards: {', '.join(engine['cards'])}"
            )
    lines += ["", "## Matchup matrix", "| Threat | Opponent | Coverage | Status |", "|---|---:|---:|---|"]
    for row in matchup["rows"]:
        lines.append(f"| {row['axis']} | {row['threat']}/5 | {row['coverage']}/5 | {row['status']} |")
    lines += ["", "## Recommendations", report["recommendations"]["message"]]
    for change in report["recommendations"]["changes"]:
        lines += [
            f"- ADD {change['add']}: {change['reason']}",
            f"  CUT candidate: {change['cut'] or 'Manual review'}. {change['cut_reason']}",
        ]
    lines.extend("- " + line for line in matchup["overreaction"]["advice"])
    lines += [
        "",
        "## Formula",
        matchup["formula"],
        "Pressure = min(1, (Speed + Combat Scaling + Burst Potential) / 15).",
        "Answer coverage = min(5, sum(base × speed × repeatability × resilience × breadth × quantity) / 4 × 5).",
        "Official bracket status: " + report["bracket_advisory"]["note"],
    ]
    advisory = report["bracket_advisory"]
    lines += [
        "Game Changers flagged by cached data: " + (", ".join(advisory["game_changers"]) or "None flagged"),
        "Extra-turn candidates: " + (", ".join(advisory["extra_turn_candidates"]) or "None detected"),
        "Mass land denial candidates: " + (", ".join(advisory["mass_land_denial_candidates"]) or "None detected"),
        advisory["snapshot"],
    ]
    return "\n".join(lines)


def blast(report: dict[str, Any]) -> dict[str, Any]:
    opponent = report["opponent"]
    scores = opponent["scores"]
    top = sorted(scores, key=lambda name: scores[name]["score"], reverse=True)
    return {
        "title": "OPPONENT THREAT REPORT",
        "stank": scores["Stank Score"]["score"],
        "speed": scores["Speed"]["score"],
        "resilience": scores["Resilience / Protection"]["score"],
        "main": opponent["overview"]["plan"] or [k for k in top[:5] if scores[k]["score"] > 0],
        "problems": [r["axis"] for r in report["matchup"]["rows"] if r["status"] in ("Critical", "Weak")][:3],
        "changes_needed": len(report["recommendations"]["changes"]),
        "note": "Suggested changes, not a proven minimum; limited by the curated catalogue.",
    }
