import { BrowserStore } from "./storage";
import { ScryfallClient } from "./scryfall";
import { analyseDeck } from "../analysis/deckAnalyser";
import { compare, profiles } from "../analysis/matchup";
import { recommend } from "../analysis/recommendations";
import { blast, bracketAdvisory, markdown } from "../analysis/report";
import type { DeckAnalysis, DeckInput, Report } from "../analysis/model";
import { overview } from "../analysis/overview";
const store = new BrowserStore(),
  client = new ScryfallClient(store);
let busy = false;
type Input = {
  opponent: DeckInput;
  mine: DeckInput;
  environment: "B2" | "B3";
  profile: string;
};
async function build(
  opponent: DeckAnalysis,
  input: DeckInput,
  env: "B2" | "B3",
  profile: string,
): Promise<Report> {
  const mine = await analyseDeck(input, client),
    matchup = compare(opponent, mine, profile);
  const result = {
    opponent,
    mine,
    environment: env,
    profile,
    matchup,
    recommendations: await recommend(mine, matchup, env, client),
    bracket_advisory: bracketAdvisory(mine),
    generated: new Date().toISOString(),
  };
  const report = { ...result, blast: blast(result), summary: overview(result) };
  return { ...report, markdown: markdown(report) };
}
globalThis.onmessage = async (
  event: MessageEvent<{ id: number; all: boolean; input: Input }>,
) => {
  const { id, all, input } = event.data;
  if (busy) {
    globalThis.postMessage({
      id,
      error: "An analysis is already running; please wait.",
    });
    return;
  }
  busy = true;
  try {
    if (input.environment !== "B2" && input.environment !== "B3")
      throw new Error("Unknown environment.");
    if (input.profile && !(input.profile in profiles.opponents))
      throw new Error("Unknown opponent profile.");
    if (!input.opponent.text.trim() || input.opponent.text.length > 60000)
      throw new Error("Opponent list must contain text, up to 60 KB.");
    const decks = all
      ? (await store.decks()).filter((d) => d.include_in_comparisons)
      : [];
    if (all && !decks.length)
      throw new Error(
        "Save at least one deck with Include in my comparisons enabled.",
      );
    const opponent = await analyseDeck(input.opponent, client);
    if (all) {
      const results = [];
      for (const deck of decks) {
        const report = await build(
          opponent,
          deck,
          input.environment,
          input.profile,
        );
        results.push({
          id: deck.id!,
          name: deck.name,
          readiness: report.matchup.readiness,
          confidence: report.mine.confidence.level,
          weakness:
            report.matchup.rows.find((r) =>
              ["Weak", "Critical"].includes(r.status),
            )?.axis || "No major observed gap",
          report,
        });
      }
      results.sort((a, b) => (b.readiness ?? -1) - (a.readiness ?? -1));
      globalThis.postMessage({ id, result: { decks: results } });
    } else {
      if (!input.mine.text.trim() || input.mine.text.length > 60000)
        throw new Error("Your deck list must contain text, up to 60 KB.");
      globalThis.postMessage({
        id,
        result: await build(
          opponent,
          input.mine,
          input.environment,
          input.profile,
        ),
      });
    }
  } catch (error) {
    globalThis.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    busy = false;
  }
};
