import profilesJSON from "../../../backend/app/config/profiles.json";
import { scoring } from "./scorer";
import {
  round,
  sum,
  unique,
  type TaggedCard,
  type DeckAnalysis,
  type Matchup,
  type Answer,
} from "./model";
export const profiles = profilesJSON;
export const axes: Record<string, string[]> = {
  "Graveyard recursion": ["Graveyard Power", "Recursion", "Graveyard Reliance"],
  "Enchantment engines": ["Enchantment Reliance"],
  "Artifact engines": ["Artifact Reliance"],
  "Creature pressure": ["Creature Reliance", "Combat Scaling"],
  "Evasive commander damage": ["Commander Dependency", "Evasion"],
  "Wide token boards": ["Token Production"],
  "Explosive engines": [
    "Combo / Engine Density",
    "Sacrifice Value",
    "Table Inevitability",
  ],
  "Single-card swings": ["Single-Card Bombs", "Burst Potential"],
  "Counter scaling": ["Counter / Proliferate Scaling"],
  "Tutors / consistency": ["Tutors / Consistency"],
  "Board wipes / attrition": ["Board Wipes"],
  "Life drain / resources": ["Life Gain / Life Resource Abuse"],
};
export function oracle(card: TaggedCard): string {
  return (
    card.oracle_text ||
    card.card_faces.map((f) => f.oracle_text || "").join(" ")
  ).toLowerCase();
}
export function removalTargets(card: TaggedCard): Set<string> {
  const text = oracle(card),
    types = new Set<string>();
  for (const match of text.matchAll(
    /(?:destroy|exile|return) (?:up to [^.]*? )?target ([^.;]+)/g,
  )) {
    const clause = match[1].split(" to ")[0];
    if (clause.includes("you control")) continue;
    if (clause.includes("permanent"))
      for (const kind of [
        "creature",
        "artifact",
        "enchantment",
        "planeswalker",
      ])
        types.add(kind);
    for (const kind of ["creature", "artifact", "enchantment", "planeswalker"])
      if (clause.includes(kind)) types.add(kind);
  }
  if (
    text.includes("exile") &&
    text.includes("return") &&
    text.includes("battlefield") &&
    "blink" in card.tags
  )
    types.clear();
  if (text.includes("gets -") && text.includes("target creature"))
    types.add("creature");
  const overrides: Record<string, string[]> = {
    "Cyclonic Rift": ["creature", "artifact", "enchantment", "planeswalker"],
    "Chaos Warp": ["creature", "artifact", "enchantment", "planeswalker"],
    "Feed the Swarm": ["creature", "enchantment"],
  };
  for (const kind of overrides[card.name] || []) types.add(kind);
  return types;
}
export function counterCanTarget(card: TaggedCard, kind: string): boolean {
  const match = oracle(card).match(/counter target ([^.;]*?)spell/);
  if (!match) return false;
  const restriction = match[1];
  if (!restriction.trim()) return true;
  if (restriction.includes("noncreature")) return kind !== "creature";
  const listed = [
    "creature",
    "artifact",
    "enchantment",
    "instant",
    "sorcery",
    "planeswalker",
  ].filter((t) => restriction.includes(t));
  return !listed.length || listed.includes(kind);
}
export function answerBase(card: TaggedCard, axis: string): [number, string] {
  const tags = card.tags,
    targets = removalTargets(card),
    text = oracle(card);
  let counter = "counterspell" in tags;
  if (axis === "Graveyard recursion")
    return "graveyard hate" in tags
      ? [
          1.2,
          "Direct graveyard disruption; inspect target and timing restrictions.",
        ]
      : counter
        ? [
            0.15,
            "Can counter some recursion spells before resolution; cannot clear a graveyard.",
          ]
        : [0, ""];
  if (axis === "Board wipes / attrition") {
    if ("protection" in tags)
      return [
        1,
        "Protection can preserve the board; exile/sacrifice and timing can bypass it.",
      ];
    if ("recursion" in tags)
      return [0.55, "Recovery after losses, rather than prevention."];
    return counter
      ? [0.65, "Can counter an eligible wipe before resolution."]
      : [0, ""];
  }
  if (axis === "Tutors / consistency")
    return counter
      ? [
          0.6,
          "Countermagic can stop eligible search spells; not activated abilities.",
        ]
      : [0, ""];
  const required: Record<string, string> = {
    "Enchantment engines": "enchantment",
    "Artifact engines": "artifact",
    "Creature pressure": "creature",
    "Evasive commander damage": "creature",
    "Wide token boards": "creature",
    "Counter scaling": "creature",
  };
  if (axis in required) {
    const kind = required[axis];
    counter = counter && counterCanTarget(card, kind);
    if (
      "board wipe" in tags &&
      (text.includes(kind) || card.name === "Cyclonic Rift")
    )
      return [
        axis === "Wide token boards" ? 1.4 : 0.85,
        "Mass interaction, subject to its exclusions.",
      ];
    if (targets.has(kind) && "removal" in tags)
      return [
        axis === "Wide token boards" ? 0.3 : 1,
        "Can interact with a resolved " + kind + "; restrictions still apply.",
      ];
    return counter
      ? [
          0.4,
          "Can counter eligible threats before resolution, not remove a resolved engine.",
        ]
      : [0, ""];
  }
  if (counter)
    return [
      0.85,
      "Can counter an eligible spell before resolution; cannot stop every activated/triggered ability.",
    ];
  if ("removal" in tags && targets.size)
    return [
      0.6,
      "Can disrupt some permanent-based engines; nonpermanent and triggered effects may evade it.",
    ];
  if ("board wipe" in tags)
    return [
      0.4,
      "Can reset some board-based engines; cannot answer all burst effects.",
    ];
  return [0, ""];
}
export function answerEvidence(
  card: TaggedCard,
  axis: string,
): (Answer & { reusable: boolean; narrow: boolean }) | null {
  const [base, reason] = answerBase(card, axis);
  if (!base) return null;
  const mv = card.cmc,
    instant =
      card.type_line.includes("Instant") || card.keywords.includes("Flash");
  let speed =
    instant && mv <= 2 ? 1.15 : instant || mv <= 2 ? 1 : mv <= 4 ? 0.8 : 0.6;
  if (card.name === "Bojuka Bog") speed = 0.65;
  const reusable =
      "repeatable answer" in card.tags || "persistent answer" in card.tags,
    repeat = reusable ? 1.2 : 1,
    resilience = ["hexproof", "indestructible"].some((t) => t in card.tags)
      ? 1.1
      : 1,
    narrow = "targeted hate" in card.tags;
  const breadth =
    (removalTargets(card).size >= 3 ? 1.1 : 1) * (narrow ? 0.9 : 1);
  return {
    card: card.name,
    weight: round(
      base * speed * repeat * resilience * breadth * card.quantity,
      3,
    ),
    base,
    speed_factor: speed,
    repeat_factor: repeat,
    resilience_factor: resilience,
    breadth_factor: round(breadth, 2),
    reusable,
    narrow,
    reason,
    limitations:
      "Activation costs, board access, MDFC face choice and timing require manual review.",
  };
}
export function compare(
  opponent: DeckAnalysis,
  mine: DeckAnalysis,
  profile: string,
): Matchup {
  const config = scoring.matchup;
  const weights =
    (profiles.opponents as Record<string, { weights: Record<string, number> }>)[
      profile
    ]?.weights || {};
  const rows: Matchup["rows"] = [];
  for (const [axis, categories] of Object.entries(axes)) {
    const threat = Math.max(...categories.map((c) => opponent.scores[c].score));
    if (threat < 0.5) continue;
    const evidence = mine.cards.flatMap((c) => {
      const e = answerEvidence(c, axis);
      return e ? [e] : [];
    });
    const coverage = round(
      Math.min(
        5,
        (sum(evidence.map((e) => e.weight)) / config.answer_threshold) * 5,
      ),
      1,
    );
    const status =
      coverage >= Math.max(threat, 1.5)
        ? "Strong"
        : coverage >= 0.75 * threat
          ? "Adequate"
          : coverage >= 0.4 * threat
            ? "Weak"
            : "Critical";
    const multiplier = Math.min(config.profile_max, weights[axis] ?? 1);
    rows.push({
      axis,
      threat,
      coverage,
      status,
      weight: round(threat ** 2 * multiplier, 3),
      profile_multiplier: multiplier,
      answers: evidence,
      threat_cards: unique(
        categories.flatMap((c) =>
          opponent.scores[c].contributors.map((e) => e.card),
        ),
      ).sort(),
      coverage_range: [coverage, mine.missing ? 5 : coverage],
      threat_range: [threat, opponent.missing ? 5 : threat],
    });
  }
  const pressure = round(
    Math.min(
      1,
      (mine.scores.Speed.score +
        mine.scores["Combat Scaling"].score +
        mine.scores["Burst Potential"].score) /
        15,
    ),
    3,
  );
  const denominator = sum(rows.map((r) => r.weight));
  const ratio = denominator
    ? sum(
        rows.map(
          (r) => r.weight * Math.min(1, r.coverage / Math.max(r.threat, 1)),
        ),
      ) / denominator
    : null;
  const readiness =
    ratio !== null
      ? round(
          100 *
            (config.coverage_weight * ratio +
              config.pressure_weight * pressure),
        )
      : null;
  const partial = Boolean(opponent.missing || mine.missing),
    risks = rows.filter((r) => r.status === "Strong" && r.answers.length >= 3);
  const risk = risks.length
    ? "High"
    : rows.some((r) => ["Strong", "Adequate"].includes(r.status))
      ? "Medium"
      : "Low";
  const gap = (r: { weight: number; coverage: number; threat: number }) =>
    r.weight * (1 - Math.min(1, r.coverage / Math.max(1, r.threat)));
  return {
    rows: rows.sort((a, b) => gap(b) - gap(a)),
    readiness,
    readiness_range:
      partial && readiness !== null ? [0, 100] : [readiness, readiness],
    pressure,
    coverage_ratio: ratio !== null ? round(ratio, 3) : null,
    overreaction: {
      risk,
      advice: risks.map(
        (r) =>
          `${r.axis}: observed coverage is already strong. Do not add more dedicated hate unless the local meta changes.`,
      ),
    },
    partial,
    note: partial
      ? "Observed coverage index, not win probability. Partial lists cannot establish overall readiness; 0–100 bounds acknowledge unknown threats and answers."
      : "Coverage index, not win probability; activation costs, sequencing and multiplayer politics are not simulated.",
    formula:
      "100 × (0.85 × Σ(T² × profile × min(1,C/max(T,1))) / Σ(T² × profile) + 0.15 × pressure)",
    version: "1.0",
  };
}
