import { describe, expect, it } from "vitest";
import fixture from "./parity.json";
import { overview, type OverviewInput } from "../src/analysis/overview";
import { markdown, blast, bracketAdvisory } from "../src/analysis/report";
import type { DeckAnalysis } from "../src/analysis/model";
function input(): OverviewInput {
  const scenario = structuredClone(fixture.cases[0].expected);
  const report = { ...scenario, environment: "B2" } as unknown as OverviewInput;
  report.recommendations.changes = [];
  report.matchup.partial = false;
  for (const deck of [report.opponent, report.mine]) {
    deck.name = "Test deck";
    deck.resolved = 100;
    deck.supplied = 100;
    deck.confidence.level = "High";
    deck.engines = [];
    deck.cards = [];
    for (const score of Object.values(deck.scores)) score.score = 0;
  }
  return report;
}
function row(status = "Critical", coverage = 0) {
  return {
    axis: "Enchantment engines",
    threat: 4,
    coverage,
    status,
    weight: 16,
    profile_multiplier: 1,
    answers: [],
    threat_cards: [],
    coverage_range: [coverage, coverage],
  };
}
describe("plain English matchup overview", () => {
  it("does not clear an unresolved or empty matchup", () => {
    const r = input();
    r.opponent.resolved = 0;
    r.matchup.rows = [];
    const s = overview(r);
    expect(s.verdict).toContain("Not enough evidence");
    expect(s.power.title).toBe("Too early to judge");
    expect(s.changes).toContain("Wait");
  });
  it("withholds relative power judgements for uneven and small samples", () => {
    const r = input();
    r.mine.resolved = 8;
    r.matchup.partial = true;
    r.opponent.engines = [
      {
        name: "Observed combo",
        kind: "combo",
        cards: ["A", "B"],
        explanation: "Prerequisites",
      },
    ];
    const s = overview(r);
    expect(s.power.title).toBe("Too early to judge");
    expect(s.confidence).toContain("Provisional");
    expect(s.environment.evidence.join()).toContain("Observed combo");
    r.mine.resolved = 80;
    r.opponent.resolved = 100;
    expect(overview(r).power.title).toBe("Too early to judge");
  });
  it("distinguishes relative strength from matchup coverage", () => {
    const r = input();
    r.matchup.rows = [row("Strong", 5)];
    for (const key of ["Speed", "Card Advantage", "Burst Potential"])
      r.opponent.scores[key].score = 3;
    const s = overview(r);
    expect(s.power.title).toContain("their deck shows broader strength");
    expect(s.verdict).toContain("cover their main");
    expect(s.threats[0].axis).toBe("Enchantment engines");
    expect(s.power.evidence).toHaveLength(3);
    [r.opponent, r.mine] = [r.mine, r.opponent];
    expect(overview(r).power.title).toContain(
      "Your deck shows broader strength",
    );
  });
  it("explains a gap with evidence and does not equate zero suggestions with zero problems", () => {
    const r = input();
    r.matchup.rows = [row()];
    r.opponent.scores["Enchantment Reliance"].contributors = [
      {
        card: "Engine A",
        weight: 2,
        quantity: 1,
        tags: ["enchantment synergy"],
        rules: {},
      },
    ];
    r.matchup.rows[0].answers = [
      {
        card: "Negate",
        base: 0.4,
        weight: 0.4,
        speed_factor: 1,
        repeat_factor: 1,
        resilience_factor: 1,
        breadth_factor: 1,
        reason: "Before resolution only.",
        limitations: "Cannot remove a resolved permanent.",
      },
    ];
    const s = overview(r);
    expect(s.threats[0].cards).toEqual(["Engine A"]);
    expect(s.threats[0].answers[0]).toContain(
      "Cannot remove a resolved permanent",
    );
    expect(s.threats[0].pointer).toContain("before resolution");
    expect(s.changes).toContain("Zero suggestions does not mean zero problems");
  });
  it("ignores stank and body density when comparing power", () => {
    const r = input();
    for (const key of [
      "Stank Score",
      "Creature Reliance",
      "Artifact Reliance",
      "Enchantment Reliance",
    ])
      r.opponent.scores[key].score = 5;
    expect(overview(r).power.title).toContain("No clear power mismatch");
  });
  it("uses a more permissive personal B3 screen and excludes mana dorks", () => {
    const r = input();
    r.opponent.cards = Array.from({ length: 4 }, (_, i) => ({
      name: "Tutor " + i,
      tags: { tutor: [] },
      type_line: "Sorcery",
    })) as typeof r.opponent.cards;
    r.opponent.cards.push(
      ...(Array.from({ length: 5 }, (_, i) => ({
        name: "Dork " + i,
        tags: { "fast mana": [] },
        type_line: "Creature",
      })) as typeof r.opponent.cards),
    );
    expect(overview(r).environment.evidence).toHaveLength(1);
    r.environment = "B3";
    expect(overview(r).environment.evidence).toHaveLength(0);
  });
  it("flags a combination of B2 pressure points without claiming certification", () => {
    const r = input();
    r.opponent.cards = Array.from({ length: 4 }, (_, i) => ({
      name: "Tutor " + i,
      tags: { tutor: [] },
      type_line: "Sorcery",
    })) as typeof r.opponent.cards;
    r.opponent.cards.push(
      ...(Array.from({ length: 3 }, (_, i) => ({
        name: "Rock " + i,
        tags: { "fast mana": [] },
        type_line: "Artifact",
      })) as typeof r.opponent.cards),
    );
    r.opponent.engines = [
      {
        name: "Combo",
        kind: "combo",
        cards: ["A", "B"],
        explanation: "Check prerequisites",
      },
    ];
    const s = overview(r);
    expect(s.environment.title).toContain("May be too much");
    expect(s.environment.evidence).toHaveLength(3);
    expect(s.environment.explanation).toContain(
      "not official bracket certification",
    );
    r.environment = "B3";
    expect(overview(r).environment.title).toContain("No obvious");
  });
  it("exports the same overview to the forensic Markdown", () => {
    const r = input();
    r.matchup.rows = [row()];
    const core = {
      ...r,
      profile: "",
      generated: "test",
      bracket_advisory: bracketAdvisory(r.mine as DeckAnalysis),
    };
    const text = markdown({
      ...core,
      summary: overview(r),
      blast: blast(core),
    });
    expect(text).toContain("Is their deck overpowered compared with mine?");
    expect(text).toContain("Is their deck too powerful for the environment?");
    expect(text).toContain("Zero suggestions does not mean zero problems");
  });
});
