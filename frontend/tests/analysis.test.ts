import { describe, it, expect } from "vitest";
import fixture from "./parity.json";
import { analyseDeck } from "../src/analysis/deckAnalyser";
import { compare, answerBase, removalTargets } from "../src/analysis/matchup";
import { recommend } from "../src/analysis/recommendations";
import { parseDeck } from "../src/analysis/parser";
import { tagCard } from "../src/analysis/tagger";
import {
  round,
  type CardData,
  type CardProvider,
  type DeckAnalysis,
  type TaggedCard,
} from "../src/analysis/model";
function provider(): CardProvider {
  const cache = new Map<string, CardData | null>();
  for (const card of fixture.cards)
    cache.set(card.name.toLowerCase(), card as CardData);
  for (const name of fixture.missing) cache.set(name.toLowerCase(), null);
  return {
    store: {
      cached: async (name) => ({
        hit: cache.has(name.toLowerCase()),
        card: cache.get(name.toLowerCase()) ?? null,
      }),
      cache: async (n, c) => {
        cache.set(n.toLowerCase(), c);
      },
    },
    prefetch: async () => {
      throw new Error("Unexpected network lookup in parity test");
    },
    resolve: async (name) => {
      if (!cache.has(name.toLowerCase()))
        throw new Error("Missing fixture: " + name);
      return [cache.get(name.toLowerCase()) ?? null, "cache"];
    },
  };
}
function project(deck: DeckAnalysis) {
  return Object.fromEntries(
    [
      "commander",
      "identity",
      "identity_known",
      "supplied",
      "resolved",
      "missing",
      "confidence",
      "scores",
      "warnings",
      "unmatched",
      "overview",
    ].map((k) => [k, deck[k as keyof DeckAnalysis]]),
  );
}
describe("Python reference parity", () => {
  for (const scenario of fixture.cases)
    it(scenario.name, async () => {
      const client = provider(),
        opponent = await analyseDeck(scenario.opponent, client),
        mine = await analyseDeck(scenario.mine, client);
      expect(project(opponent)).toEqual(scenario.expected.opponent);
      expect(project(mine)).toEqual(scenario.expected.mine);
      const matchup = compare(opponent, mine, scenario.profile);
      expect(matchup).toEqual(scenario.expected.matchup);
      expect(
        await recommend(
          mine,
          matchup,
          scenario.environment as "B2" | "B3",
          client,
        ),
      ).toEqual(scenario.expected.recommendations);
    });
});
it("preserves parser noise handling and commander counting", () => {
  const parsed = parseDeck(
    "// COMMANDER\n1 Commander (SET) 123 *F*\n\n2x Forest\nSol Ring\nSIDEBOARD\nCounterspell",
    "Commander",
  );
  expect(Object.fromEntries(parsed.cards)).toEqual({
    Commander: 1,
    Forest: 2,
    "Sol Ring": 1,
  });
  expect(parsed.excluded).toEqual(["Counterspell"]);
});
it("matches Python binary rounding including ties", () => {
  expect(round(1.25, 1)).toBe(1.2);
  expect(round(2.675, 2)).toBe(2.67);
  expect(round(1.15, 1)).toBe(1.1);
  expect(round(2.5)).toBe(2);
  expect(round(3.5)).toBe(4);
});
it("does not mistake narrow counters or own blink for universal removal", () => {
  const base = fixture.cards[0] as CardData;
  const card: TaggedCard = {
    ...base,
    name: "Negate",
    oracle_text: "Counter target noncreature spell.",
    type_line: "Instant",
    quantity: 1,
    is_commander: false,
    tags: { counterspell: [] },
  };
  expect(answerBase(card, "Creature pressure")[0]).toBe(0);
  card.oracle_text =
    "Exile target creature you control, then return it to the battlefield.";
  card.tags = { removal: [], blink: [] };
  expect(removalTargets(card).size).toBe(0);
});
it("does not turn token reminder text into a sacrifice engine", () => {
  const card = {
    ...fixture.cards[0],
    name: "Spawn Maker",
    oracle_text:
      "Whenever you cast a creature spell, create two Eldrazi Spawn creature tokens. They have “Sacrifice this creature: Add {C}.”",
    type_line: "Enchantment",
  } as CardData;
  expect(tagCard(card)).not.toHaveProperty("sacrifice outlet");
  expect(tagCard(card)).not.toHaveProperty("death payoff");
});

it('retains known evidence and reports uncached slots when the service is offline',async()=>{
 const {CardServiceError}=await import('../src/services/scryfall');const client=provider();
 client.prefetch=async()=>{throw new CardServiceError('offline');};
 const result=await analyseDeck({text:'Sol Ring\nUnavailable Card',commander:'Test Commander'},client);
 expect(result.resolved).toBe(2);expect(result.unmatched).toEqual([{input:'Unavailable Card',quantity:1,reason:'service unavailable'}]);expect(result.scores.Acceleration.score).toBeGreaterThan(0);expect(result.confidence.level).toBe('Low');
});
