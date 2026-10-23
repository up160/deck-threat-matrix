import { parseDeck } from "./parser";
import { tagCard } from "./tagger";
import { detect, scoreCategories } from "./scorer";
import { CardServiceError } from "../services/scryfall";
import {
  round,
  sum,
  unique,
  subset,
  type CardProvider,
  type DeckInput,
  type TaggedCard,
  type DeckAnalysis,
} from "./model";
export async function analyseDeck(
  data: DeckInput,
  client: CardProvider,
): Promise<DeckAnalysis> {
  const parsed = parseDeck(data.text, data.commander || "");
  const unresolved: DeckAnalysis["unmatched"] = [],
    normalisations: DeckAnalysis["normalisations"] = [],
    errors: string[] = [];
  const canonical = new Map<string, TaggedCard>(),
    commanderNames: string[] = [];
  let serviceDown = false;
  let hasMiss = false;
  for (const name of parsed.cards.keys())
    if (!(await client.store.cached(name)).hit) hasMiss = true;
  if (hasMiss) {
    try {
      await client.prefetch([...parsed.cards.keys()]);
    } catch (error) {
      if (!(error instanceof CardServiceError)) throw error;
      serviceDown = true;
      errors.push(error.message);
    }
  }
  for (const [name, quantity] of parsed.cards) {
    const isCommander = parsed.commanders.some(
      (c) => c.toLowerCase() === name.toLowerCase(),
    );
    if (serviceDown && !(await client.store.cached(name)).hit) {
      unresolved.push({ input: name, quantity, reason: "service unavailable" });
      continue;
    }
    let card, mode;
    try {
      [card, mode] = await client.resolve(name);
    } catch (error) {
      if (!(error instanceof CardServiceError)) throw error;
      serviceDown = true;
      if (!errors.includes(error.message)) errors.push(error.message);
      unresolved.push({ input: name, quantity, reason: "service unavailable" });
      continue;
    }
    if (!card) {
      unresolved.push({ input: name, quantity, reason: mode });
      continue;
    }
    if (name.toLowerCase() !== card.name.toLowerCase())
      normalisations.push({ input: name, matched: card.name, method: mode });
    if (isCommander) commanderNames.push(card.name);
    const existing = canonical.get(card.name);
    if (existing) {
      existing.quantity += quantity;
      existing.is_commander ||= isCommander;
      continue;
    }
    const tags = tagCard(card),
      types = card.type_line;
    for (const type of ["Creature", "Artifact", "Enchantment"])
      if (types.includes(type))
        tags[type.toLowerCase() + " body"] = ["type:" + type];
    const oracle =
      card.card_faces.map((f) => f.oracle_text || "").join(" ") ||
      card.oracle_text;
    if (types.includes("Creature") && card.cmc >= 6)
      tags["expensive creature"] = ["mana value >= 6 + creature"];
    if (
      types.includes("Creature") &&
      (oracle.toLowerCase().includes("enters") ||
        oracle
          .toLowerCase()
          .includes("when " + card.name.split(",")[0].toLowerCase()))
    )
      tags["ETB ability"] = ["text:creature enters ability candidate"];
    if (oracle.toLowerCase().includes("commander"))
      tags["commander linked"] = ["oracle:commander reference"];
    if ("engine" in tags && card.cmc <= 3)
      tags["cheap engine"] = ["engine mana value <= 3"];
    canonical.set(card.name, {
      ...card,
      quantity,
      tags,
      is_commander: isCommander,
    });
  }
  const cards = [...canonical.values()],
    supplied = sum([...parsed.cards.values()]),
    resolved = sum(cards.map((c) => c.quantity));
  const warnings = [...parsed.warnings, ...errors];
  if (!parsed.commanders.length)
    warnings.push(
      "Commander not identified. Enter it separately or use a COMMANDER section; colour-sensitive recommendations are withheld.",
    );
  else if (commanderNames.length !== parsed.commanders.length)
    warnings.push(
      "One or more commanders could not be resolved; colour identity is uncertain.",
    );
  if (supplied !== 100)
    warnings.push(
      `${supplied} cards supplied including commander(s); this is ${supplied < 100 ? "a partial" : "an oversized"} list.`,
    );
  const commanders = cards.filter((c) => c.is_commander),
    identity = unique(commanders.flatMap((c) => c.color_identity)).sort();
  const identityKnown =
    commanders.length > 0 && commanderNames.length === parsed.commanders.length;
  for (const card of cards) {
    if (identityKnown && !subset(card.color_identity, identity))
      warnings.push(
        `${card.name} is outside the supplied commander colour identity.`,
      );
    if (card.legalities.commander && card.legalities.commander !== "legal")
      warnings.push(
        `${card.name}: Commander legality is ${card.legalities.commander}.`,
      );
    if (
      card.quantity > 1 &&
      !card.type_line.includes("Basic") &&
      !card.oracle_text.includes("any number") &&
      !card.oracle_text.includes("up to")
    )
      warnings.push(
        `${card.name} appears ${card.quantity} times; check singleton legality.`,
      );
  }
  if (commanders.length > 1)
    warnings.push(
      "Multiple commanders supplied. Partner/background compatibility requires manual verification.",
    );
  if (
    commanders.some(
      (c) =>
        !c.type_line.includes("Legendary") ||
        (!c.type_line.includes("Creature") &&
          !c.oracle_text.toLowerCase().includes("can be your commander")),
    )
  )
    warnings.push(
      "Commander eligibility requires manual verification for this selection.",
    );
  const completeness = Math.min(1, resolved / 100),
    resolution = resolved / Math.max(1, supplied);
  const confidenceNumber = round(
    100 * completeness * resolution * (identityKnown ? 1 : 0.75),
  );
  const confidence =
    supplied === 100 && resolution === 1 && identityKnown && !warnings.length
      ? "High"
      : resolved >= 25 && resolution >= 0.8 && identityKnown
        ? "Medium"
        : "Low";
  const findings = detect(cards);
  for (const finding of findings)
    if (finding.kind === "combo")
      for (const card of cards)
        if (finding.cards.includes(card.name)) {
          (card.tags.stank ??= []).push("verified pattern:" + finding.name);
          (card.tags["combo piece"] ??= []).push(
            "verified pattern:" + finding.name,
          );
        }
  const scores = scoreCategories(cards, completeness),
    lands = sum(
      cards.filter((c) => c.type_line.includes("Land")).map((c) => c.quantity),
    );
  const nonlands = cards.filter((c) => !c.type_line.includes("Land"));
  const averageMv = round(
    sum(nonlands.map((c) => c.cmc * c.quantity)) /
      Math.max(1, sum(nonlands.map((c) => c.quantity))),
    2,
  );
  const leaders = Object.keys(scores).sort(
    (a, b) => scores[b].score - scores[a].score,
  );
  let plan = findings
    .filter((f) => f.kind !== "combo")
    .slice(0, 3)
    .map((f) => f.name);
  const keywordPlan = unique(
    cards.flatMap((c) =>
      ["cascade", "discover", "prowess", "ninjutsu", "landfall"].filter(
        (t) => t in c.tags,
      ),
    ),
  ).sort();
  if (keywordPlan.length)
    plan = ["Observed theme: " + keywordPlan.join(", "), ...plan.slice(0, 2)];
  if (!plan.length)
    plan = leaders.filter((n) => scores[n].score >= 1).slice(0, 3);
  const weaknesses: string[] = [];
  for (const name of [
    "Spot Interaction",
    "Card Advantage",
    "Resilience / Protection",
  ])
    if (scores[name].score < 2)
      weaknesses.push(
        supplied < 100
          ? `Little observed ${name.toLowerCase()}; missing cards may change this.`
          : `Low observed ${name.toLowerCase()}; inspect supporting cards.`,
      );
  if (supplied === 100 && lands < 30)
    weaknesses.push(
      `Only ${lands} land cards observed. MDFCs and nonland mana need manual review.`,
    );
  return {
    name: data.name || "Untitled deck",
    commander: commanderNames,
    identity,
    identity_known: identityKnown,
    supplied,
    resolved,
    missing: Math.max(0, 100 - resolved),
    confidence: {
      level: confidence,
      index: confidenceNumber,
      completeness: round(completeness, 2),
      note: "Ranges are conservative heuristic bounds, not statistical confidence intervals. Missing cards are unknown.",
    },
    cards,
    scores,
    engines: findings,
    unmatched: unresolved,
    normalisations,
    warnings,
    excluded: parsed.excluded,
    overview: {
      plan,
      lands,
      average_mana_value: averageMv,
      finishers: cards
        .filter((c) => "finisher" in c.tags || "bomb" in c.tags)
        .map((c) => c.name),
      weaknesses,
      commander_role:
        unique(
          commanders.flatMap((c) =>
            Object.keys(c.tags).filter((t) => !t.includes("body")),
          ),
        )
          .sort()
          .join(", ") || "No clear role inferred.",
      interaction: cards
        .filter((c) =>
          [
            "removal",
            "counterspell",
            "board wipe",
            "graveyard hate",
            "protection",
          ].some((t) => t in c.tags),
        )
        .map((c) => c.name),
    },
    validity_warnings: warnings.length,
    coverage_observation_fraction: Math.min(1, resolved / 100),
    range_note: `Up to ${Math.ceil(Math.max(0, 100 - resolved))} unknown slots can alter scores.`,
  };
}
