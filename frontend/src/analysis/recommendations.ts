import catalogue from "../../../backend/app/config/recommendations.json";
import { profiles, answerEvidence } from "./matchup";
import { tagCard } from "./tagger";
import { CardServiceError } from "../services/scryfall";
import {
  subset,
  sum,
  type DeckAnalysis,
  type Matchup,
  type CardProvider,
  type Report,
  type TaggedCard,
  type Change,
} from "./model";
export async function recommend(
  mine: DeckAnalysis,
  matchup: Matchup,
  environment: "B2" | "B3",
  client: CardProvider,
): Promise<Report["recommendations"]> {
  const policy = profiles.environments[environment],
    target = policy.desired_coverage_ratio;
  const weak = matchup.rows.filter(
    (r) => ["Critical", "Weak"].includes(r.status) && r.threat >= 1.5,
  );
  if (!weak.length)
    return {
      changes: [],
      message:
        "No changes justified by observed coverage. Unknown cards may change this conclusion.",
      withheld: [],
    };
  if (!mine.identity_known)
    return {
      changes: [],
      message:
        "Resolve your commander before colour-sensitive recommendations can be made.",
      withheld: [],
    };
  const existing = new Set(mine.cards.map((c) => c.name)),
    withheld: string[] = [];
  const candidates = catalogue
    .flatMap((candidate) => {
      const relevant = weak.filter((r) => candidate.axes.includes(r.axis));
      if (
        !relevant.length ||
        existing.has(candidate.name) ||
        !subset(candidate.identity, mine.identity) ||
        candidate.premium
      )
        return [];
      if (
        candidate.name === "Rest in Peace" &&
        mine.scores["Graveyard Reliance"].score >= 1
      ) {
        withheld.push(
          "Rest in Peace: conflicts with your observed graveyard plan.",
        );
        return [];
      }
      const value =
        sum(relevant.map((r) => r.weight * (r.threat - r.coverage))) *
        (candidate.targeted ? policy.targeted_hate_penalty : 1);
      return [{ value, candidate }];
    })
    .sort((a, b) => b.value - a.value);
  const changes: Change[] = [],
    usedCuts = new Set<string>(),
    protectedNames = new Set(mine.engines.flatMap((e) => e.cards));
  const cutWeight = (c: TaggedCard) =>
    Object.keys(c.tags).filter((t) => !t.includes("body")).length +
    (c.type_line.includes("Creature") ? 2 : 0) -
    c.cmc * 0.05;
  const cuttable = mine.cards
    .filter(
      (c) =>
        !c.is_commander &&
        !c.type_line.includes("Land") &&
        !protectedNames.has(c.name) &&
        ![
          "ramp",
          "draw",
          "protection",
          "counterspell",
          "graveyard hate",
          "removal",
          "board wipe",
          "finisher",
          "bomb",
        ].some((t) => t in c.tags),
    )
    .sort((a, b) => cutWeight(a) - cutWeight(b));
  const coverage = Object.fromEntries(weak.map((r) => [r.axis, r.coverage]));
  for (const { candidate } of candidates) {
    if (changes.length >= 5) break;
    const relevant = weak.filter(
      (r) =>
        candidate.axes.includes(r.axis) && coverage[r.axis] < target * r.threat,
    );
    if (!relevant.length) continue;
    let card;
    try {
      [card] = await client.resolve(candidate.name);
    } catch (error) {
      if (!(error instanceof CardServiceError)) throw error;
      withheld.push(
        `${candidate.name}: card data unavailable; recommendation not verified.`,
      );
      continue;
    }
    if (
      !card ||
      card.legalities.commander !== "legal" ||
      !subset(card.color_identity, mine.identity)
    ) {
      withheld.push(
        `${candidate.name}: could not verify Commander legality and colour identity.`,
      );
      continue;
    }
    const prices = card.prices,
      knownPrices = Object.entries(prices)
        .filter(([k, v]) => ["usd", "eur"].includes(k) && v)
        .map(([, v]) => Number(v));
    if (
      card.reserved ||
      (knownPrices.length && Math.max(...knownPrices) > 250)
    ) {
      withheld.push(
        `${candidate.name}: excluded by conservative premium-card policy.`,
      );
      continue;
    }
    const tagged = {
        ...card,
        tags: tagCard(card),
        quantity: 1,
        is_commander: false,
      },
      improvements: string[] = [];
    for (const row of relevant) {
      const answer = answerEvidence(tagged, row.axis);
      if (answer) {
        coverage[row.axis] = Math.min(
          5,
          coverage[row.axis] + (answer.weight / 4) * 5,
        );
        improvements.push(row.axis);
      }
    }
    if (!improvements.length) continue;
    const cut = cuttable.find((c) => !usedCuts.has(c.name));
    if (cut) usedCuts.add(cut.name);
    changes.push({
      add: candidate.name,
      reason: candidate.reason,
      axes: improvements,
      targeted_hate: candidate.targeted,
      filthy: candidate.filthy,
      cut: cut?.name ?? null,
      cut_reason: cut
        ? "Candidate with comparatively few detected roles, outside identified engines. Theme and hidden synergies need your review; this is not a claim that the card is bad."
        : "No safe cut inferred. Review the full list rather than removing mana, interaction or an identified engine.",
      provisional: Boolean(mine.missing),
      prices,
      bracket_note: `Compatible with ${environment} philosophy; official bracket impact requires the separate advisory check.`,
    });
  }
  return {
    changes,
    message:
      "Smallest set within the curated catalogue that improves observed gaps; up to five. Additions are not applied automatically. Candidate cuts require review.",
    withheld,
    remaining_gaps: weak
      .filter((r) => coverage[r.axis] < target * r.threat)
      .map((r) => r.axis),
  };
}
