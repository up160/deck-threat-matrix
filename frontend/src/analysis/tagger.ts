import patterns from "./tagRules.json";
import overridesJSON from "../../../backend/app/config/tag_overrides.json";
import type { CardData } from "./model";
const rules = Object.entries(patterns).map(
  ([tag, pattern]) => [tag, new RegExp(pattern, "s")] as const,
);
const overrides = overridesJSON as Record<
  string,
  { add?: string[]; remove?: string[] }
>;
export function tagCard(card: CardData): Record<string, string[]> {
  const evidence: Record<string, string[]> = {};
  for (const face of card.card_faces?.length ? card.card_faces : [card]) {
    const text = (
      (face.oracle_text || "") +
      " " +
      card.keywords.join(" ")
    ).toLowerCase();
    for (const [tag, rule] of rules)
      if (rule.test(text))
        (evidence[tag] ??= []).push(`oracle:${face.name || card.name}:${tag}`);
  }
  for (const keyword of card.keywords) {
    if (["Cascade", "Discover"].includes(keyword)) {
      evidence[keyword.toLowerCase()] = ["keyword:" + keyword];
      (evidence["cast payoff"] ??= []).push("keyword:" + keyword);
    }
    if (["Prowess", "Ninjutsu", "Landfall"].includes(keyword))
      evidence[keyword.toLowerCase()] = ["keyword:" + keyword];
  }
  if (card.type_line.includes("Land")) delete evidence.ramp;
  if (card.type_line.includes("Creature") && evidence.ramp)
    evidence["mana dork"] = ["type:creature + ramp"];
  if (evidence.ramp && card.cmc <= 1)
    evidence["fast mana"] = ["mana value <= 1 + ramp"];
  const override = overrides[card.name] || {};
  for (const tag of override.remove || []) delete evidence[tag];
  for (const tag of override.add || [])
    evidence[tag] = ["manual:tag_overrides.json"];
  return evidence;
}
