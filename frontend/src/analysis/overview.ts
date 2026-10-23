import type { Analysis, Report, Overview } from "../types";
import { axes } from "./matchup";
export type OverviewInput = Pick<
  Report,
  "opponent" | "mine" | "matchup" | "recommendations" | "environment"
>;
const dimensions = [
  "Speed",
  "Card Advantage",
  "Tutors / Consistency",
  "Resilience / Protection",
  "Spot Interaction",
  "Burst Potential",
  "Combat Scaling",
  "Combo / Engine Density",
];
const descriptions: Record<string, [string, string]> = {
  "Graveyard recursion": [
    "Their graveyard can become a second hand, bringing spent threats back.",
    "Save graveyard disruption for a meaningful recursion line. Check whether your answer is one-shot, sorcery-speed or usable in response.",
  ],
  "Enchantment engines": [
    "Their enchantment package may generate value that creature removal cannot stop.",
    "Identify the enchantment that makes the engine work. Counters help before resolution; afterwards you need applicable permanent removal.",
  ],
  "Artifact engines": [
    "Their artifact package can supply mana or repeated value.",
    "Prioritise the payoff or engine piece over incidental mana rocks; check what your removal can actually target.",
  ],
  "Creature pressure": [
    "Their creatures can build a threatening combat board.",
    "Keep an answer for the payoff rather than spending all your removal on setup creatures.",
  ],
  "Evasive commander damage": [
    "Commander support and evasion may make blocking unreliable.",
    "Keep applicable interaction available before a lethal attack. Commander dependency and evasion are signals, not a calculated lethal line.",
  ],
  "Wide token boards": [
    "Many small bodies can overwhelm single-target answers.",
    "Preserve a suitable wipe or stop the token payoff; spot removal alone may not contain the board.",
  ],
  "Explosive engines": [
    "Connected value pieces can turn ordinary setup into a large advantage.",
    "Break a key connection before the engine takes over. A detected synergy is not automatically an infinite combo.",
  ],
  "Single-card swings": [
    "A finisher or burst effect can change the board suddenly.",
    "Hold interaction for the swing turn; make them commit resources before using your answer where timing allows.",
  ],
  "Counter scaling": [
    "Counters or proliferate can make an established board grow rapidly.",
    "Interact with the scaling piece before repeated triggers build up.",
  ],
  "Tutors / consistency": [
    "Search effects can find their important pieces more reliably.",
    "Watch what they reveal or search for; preserve relevant interaction for the payoff.",
  ],
  "Board wipes / attrition": [
    "Their sweepers may repeatedly reset your board.",
    "Avoid committing every threat at once. Keep protection or a rebuilding plan available.",
  ],
  "Life drain / resources": [
    "Life totals may fuel their engine or fall without combat.",
    "Identify the actual drain or resource payoff; blocking alone may not stop it.",
  ],
};
function evidence(deck: Analysis, category: string): string {
  const score = deck.scores[category];
  const cards = [...score.contributors]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((c) => c.card);
  return `${category}: ${score.score}/5${cards.length ? " — " + cards.join(", ") : ""}`;
}
function enough(deck: Analysis) {
  return (
    deck.resolved >= 80 &&
    deck.supplied <= 100 &&
    deck.confidence.level.toLowerCase() !== "low"
  );
}
export function overview(input: OverviewInput): Overview {
  const { opponent, mine, matchup, recommendations, environment } = input;
  const observed =
    opponent.resolved > 0 && mine.resolved > 0 && matchup.rows.length > 0;
  const provisional = matchup.partial || !enough(opponent) || !enough(mine);
  const gaps = matchup.rows.filter((r) =>
    ["Critical", "Weak"].includes(r.status),
  );
  const leads = (a: Analysis, b: Analysis) =>
    dimensions.filter((k) => a.scores[k].score - b.scores[k].score >= 1.25);
  const theirs = leads(opponent, mine),
    yours = leads(mine, opponent);
  const closing = (items: string[]) =>
    items.some((k) =>
      ["Burst Potential", "Combat Scaling", "Combo / Engine Density"].includes(
        k,
      ),
    );
  const comparable =
    enough(opponent) &&
    enough(mine) &&
    Math.abs(opponent.resolved - mine.resolved) <= 15;
  let powerTitle = "Too early to judge";
  if (comparable)
    powerTitle =
      theirs.length >= 3 && yours.length <= 1 && closing(theirs)
        ? "Possibly — their deck shows broader strength"
        : yours.length >= 3 && theirs.length <= 1 && closing(yours)
          ? "Your deck shows broader strength"
          : "No clear power mismatch in the observed signals";
  const powerEvidence = [
    ...theirs.map((k) => "Opponent leads: " + evidence(opponent, k)),
    ...yours.map((k) => "You lead: " + evidence(mine, k)),
  ];
  const tutors = opponent.cards.filter((c) => "tutor" in c.tags);
  const fast = opponent.cards.filter(
    (c) => "fast mana" in c.tags && !/creature|land/i.test(c.type_line),
  );
  const combos = opponent.engines.filter((e) => e.kind === "combo");
  const flags: string[] = [];
  if (tutors.length >= (environment === "B2" ? 4 : 7))
    flags.push(`High tutor density: ${tutors.map((c) => c.name).join(", ")}`);
  if (fast.length >= (environment === "B2" ? 3 : 5))
    flags.push(`Fast noncreature mana: ${fast.map((c) => c.name).join(", ")}`);
  if (combos.length >= (environment === "B2" ? 1 : 2))
    flags.push(
      `Catalogue combo patterns (prerequisites still apply): ${combos.map((c) => c.name + " [" + c.cards.join(", ") + "]").join("; ")}`,
    );
  const fastBurst =
    opponent.scores.Speed.score >= (environment === "B2" ? 3.5 : 4.5) &&
    opponent.scores["Burst Potential"].score >= (environment === "B2" ? 3 : 4);
  if (fastBurst)
    flags.push(
      "Early mana/engine support plus burst: " +
        evidence(opponent, "Speed") +
        "; " +
        evidence(opponent, "Burst Potential"),
    );
  const threats = [...matchup.rows]
    .sort(
      (a, b) =>
        b.threat - a.threat || a.coverage / a.threat - b.coverage / b.threat,
    )
    .slice(0, 3)
    .map((row) => {
      const contributors = new Map<string, number>();
      for (const category of axes[row.axis] || [])
        for (const c of opponent.scores[category].contributors)
          contributors.set(
            c.card,
            Math.max(contributors.get(c.card) || 0, c.weight),
          );
      const [why, pointer] = descriptions[row.axis] || [
        "An observed package presents a relevant threat.",
        "Inspect the contributing cards and answer restrictions in the Matchup tab.",
      ];
      return {
        axis: row.axis,
        why,
        cards: [...contributors]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map((c) => c[0]),
        status: row.status,
        threat: row.threat,
        coverage: row.coverage,
        answer_cards: [...row.answers]
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 3)
          .map((a) => a.card),
        answers: [...row.answers]
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 3)
          .map(
            (a) =>
              `${a.card}: ${a.reason}${a.limitations ? " " + a.limitations : ""}`,
          ),
        pointer,
      };
    });
  return {
    verdict: !observed
      ? "Not enough evidence for a matchup verdict"
      : gaps.length
        ? "Important gaps need attention"
        : "Your observed answers cover their main threat categories",
    explanation: !observed
      ? "Resolve more cards in both lists before drawing conclusions."
      : gaps.length
        ? `Focus on ${gaps
            .slice(0, 3)
            .map((r) => r.axis.toLowerCase())
            .join(
              ", ",
            )}. These are coverage gaps, not a prediction that you lose.`
        : "No major coverage gap is currently evidenced. You still need to draw and use the right answers; this does not predict the winner.",
    confidence: `${provisional ? "Provisional comparison" : "Comparison based on substantial lists"}. Opponent: ${opponent.confidence.level} confidence (${opponent.resolved}/${opponent.supplied} resolved); yours: ${mine.confidence.level} (${mine.resolved}/${mine.supplied}). ${matchup.partial ? "Missing cards could materially change the conclusion." : "Tagging and matchup scoring remain heuristic."}`,
    power: {
      title: powerTitle,
      explanation: comparable
        ? "Compares eight capability signals, excluding Stank and permanent density. A broad lead suggests a possible mismatch, not a winning percentage or proof of being overpowered."
        : "Both decks need at least 80 resolved cards, no Low confidence, and comparable list sizes. Small or uneven samples cannot establish which deck is stronger.",
      evidence: powerEvidence,
    },
    environment: {
      title:
        flags.length >= 3
          ? `May be too much for your ${environment} target`
          : flags.length
            ? `Check these ${environment} pressure points`
            : !enough(opponent)
              ? "Too little evidence to clear the environment check"
              : `No obvious ${environment} pressure flags`,
      explanation: `Personal ${environment} philosophy screen of the opponent list: tutor density, fast noncreature mana, catalogue combos and supported burst. ${environment === "B3" ? "B3 allows more consistency and compact engines." : "B2 favours minimal tutors and explosive thematic play."} This is not official bracket certification, and no flags does not prove suitability.`,
      evidence: flags,
    },
    threats,
    changes: !observed
      ? "Wait for more card data before changing the deck."
      : recommendations.changes.length
        ? `Consider ${recommendations.changes.length} change${recommendations.changes.length === 1 ? "" : "s"}, then reassess. These are candidates, not a proven minimum.`
        : gaps.length
          ? "Gaps need review, but no safe addition was found in the curated catalogue. Zero suggestions does not mean zero problems."
          : provisional
            ? "No additions justified yet. Complete the lists before making cuts."
            : "Keep the list for now. More hate is not justified by the observed coverage.",
  };
}
