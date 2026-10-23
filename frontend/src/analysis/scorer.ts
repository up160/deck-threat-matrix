import scoring from "../../../backend/app/config/scoring.json";
import patterns from "../../../backend/app/config/patterns.json";
import combos from "../../../backend/app/config/combos.json";
import {
  round,
  sum,
  unique,
  type TaggedCard,
  type Score,
  type Engine,
} from "./model";
export { scoring };
export function scoreCategories(
  cards: TaggedCard[],
  completeness: number,
): Record<string, Score> {
  const scores: Record<string, Score> = {};
  for (const [name, definition] of Object.entries(scoring.categories)) {
    const contributors = cards.flatMap((card) => {
      const hits = Object.entries(definition.tags).filter(
        ([tag]) => tag in card.tags,
      );
      if (!hits.length) return [];
      return [
        {
          card: card.name,
          quantity: card.quantity,
          tags: hits.map(([t]) => t),
          weight: round(Math.max(...hits.map(([, w]) => w)) * card.quantity, 2),
          rules: Object.fromEntries(hits.map(([t]) => [t, card.tags[t]])),
        },
      ];
    });
    const value = round(
      Math.min(
        5,
        (sum(contributors.map((c) => c.weight)) / definition.threshold) * 5,
      ),
      1,
    );
    const missing = Math.max(0, 100 - round(completeness * 100));
    scores[name] = {
      score: value,
      range: [
        value,
        round(
          Math.min(
            5,
            value +
              ((missing * Math.max(...Object.values(definition.tags))) /
                definition.threshold) *
                5,
          ),
          1,
        ),
      ],
      contributors,
      threshold: definition.threshold,
      description: definition.description,
    };
  }
  return scores;
}
export function detect(cards: TaggedCard[]): Engine[] {
  const findings: Engine[] = [];
  for (const pattern of patterns) {
    const groups = pattern.requires.map((tag) =>
      cards.filter((c) => tag in c.tags).map((c) => c.name),
    );
    if (
      groups.every((g) => g.length) &&
      groups[0].length >= (pattern.minimum_first ?? 1)
    )
      findings.push({ ...pattern, cards: unique(groups.flat()) });
  }
  const names = new Set(cards.map((c) => c.name));
  for (const combo of combos)
    if (combo.cards.every((n) => names.has(n))) findings.push({ ...combo });
  return findings;
}
