# ADR 0002: Explainable deterministic analysis

Status: Accepted

## Context
Deck review must be repeatable, inspectable and useful for partial lists, without depending on model judgement or pretending to simulate games.

## Decision
Use composable oracle/type tagging rules, manual JSON overrides, declarative synergy patterns and a small verified combo catalogue. Version category thresholds and matchup coefficients. Preserve evidence and rule provenance in report objects. Use a curated recommendation catalogue and conservative candidate cuts. Treat partial-list ranges as heuristic uncertainty, not statistical intervals. Keep personal B2/B3 philosophy separate from dated official bracket guidance.

## Consequences
Results are reproducible and tuneable but need ongoing card/rules maintenance. Text rules can misclassify unusual wording; evidence and overrides allow correction. No absence-of-combo or win-probability claims. Future LLM narratives consume the structured report rather than replace deterministic scoring.
