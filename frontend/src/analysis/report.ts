import { oracle } from "./matchup";
import type { DeckAnalysis, Report } from "./model";
export function bracketAdvisory(
  deck: DeckAnalysis,
): Report["bracket_advisory"] {
  return {
    status: "Manual official bracket review required",
    note: "B2/B3 here describe your personal philosophy. Official Commander brackets and Game Changers change; this V1 does not certify them. Check the current official rules and Game Changers list, plus the verified combo findings.",
    game_changers: deck.cards
      .filter((c) => c.game_changer === true)
      .map((c) => c.name),
    game_changer_metadata_missing: deck.cards
      .filter((c) => typeof c.game_changer !== "boolean")
      .map((c) => c.name),
    extra_turn_candidates: deck.cards
      .filter((c) => oracle(c).includes("extra turn"))
      .map((c) => c.name),
    mass_land_denial_candidates: deck.cards
      .filter((c) =>
        [
          "destroy all lands",
          "exile all lands",
          "lands don't untap",
          "lands don’t untap",
        ].some((p) => oracle(c).includes(p)),
      )
      .map((c) => c.name),
    snapshot:
      "Scryfall metadata captured at card lookup; cache may be stale. No maintained official restriction snapshot is bundled.",
    observed_tutors: deck.cards
      .filter((c) => "tutor" in c.tags)
      .map((c) => c.name),
    observed_combos: deck.engines
      .filter((e) => e.kind === "combo")
      .map((e) => e.name),
    source: "https://magic.wizards.com/en/formats/commander",
  };
}
export function blast(
  report: Omit<Report, "blast" | "markdown" | "summary">,
): Report["blast"] {
  const scores = report.opponent.scores,
    top = Object.keys(scores).sort((a, b) => scores[b].score - scores[a].score);
  return {
    title: "OPPONENT THREAT REPORT",
    stank: scores["Stank Score"].score,
    speed: scores.Speed.score,
    resilience: scores["Resilience / Protection"].score,
    main: report.opponent.overview.plan.length
      ? report.opponent.overview.plan
      : top.slice(0, 5).filter((k) => scores[k].score > 0),
    problems: report.matchup.rows
      .filter((r) => ["Critical", "Weak"].includes(r.status))
      .slice(0, 3)
      .map((r) => r.axis),
    changes_needed: report.recommendations.changes.length,
    note: "Suggested changes, not a proven minimum; limited by the curated catalogue.",
  };
}
const md = (text: string) =>
  text.replace(/[\\`*_{}[\]<>|]/g, "\\$&").replace(/[\r\n]+/g, " ");
export function markdown(report: Omit<Report, "markdown">): string {
  const { opponent, mine, matchup } = report;
  const lines = [
    `# Deck Threat Matrix: ${md(opponent.name)} vs ${md(mine.name)}`,
    `Environment: ${report.environment}. Scoring version: ${matchup.version}.`,
    `Observed readiness: ${matchup.readiness === null ? "Unavailable" : matchup.readiness + "%"} (not win probability).`,
    matchup.note,
    `Overreaction risk: ${matchup.overreaction.risk}`,
    "",
  ];
  const summary = report.summary;
  lines.push(
    "## Matchup overview",
    summary.verdict,
    summary.explanation,
    summary.confidence,
    "### Is their deck overpowered compared with mine?",
    summary.power.title,
    summary.power.explanation,
    ...summary.power.evidence.map((s) => "- " + md(s)),
    "### Is their deck too powerful for the environment?",
    summary.environment.title,
    summary.environment.explanation,
    ...summary.environment.evidence.map((s) => "- " + md(s)),
  );
  for (const threat of summary.threats)
    lines.push(
      `### ${threat.axis}: ${threat.status}`,
      threat.why,
      "Opponent cards: " + threat.cards.map(md).join(", "),
      ...threat.answers.map((s) => "- Your answer: " + md(s)),
      threat.pointer,
    );
  lines.push("### Changes actually needed", summary.changes);
  for (const [label, deck] of [
    ["Opponent", opponent],
    ["My deck", mine],
  ] as const) {
    lines.push(
      `## ${label}: ${md(deck.name)}`,
      `Commander: ${deck.commander.map(md).join(", ") || "Unknown"}`,
      `Confidence: ${deck.confidence.level}; ${deck.resolved}/${deck.supplied} cards resolved.`,
      "Likely plan: " +
        (deck.overview.plan.join(", ") || "Insufficient evidence."),
      "Commander role: " + deck.overview.commander_role,
      "Likely finishers: " +
        (deck.overview.finishers.join(", ") || "None confidently identified."),
      "Important interaction: " +
        (deck.overview.interaction.join(", ") || "None observed."),
      "Weaknesses: " +
        (deck.overview.weaknesses.join("; ") || "None confidently inferred."),
      "Resilience: " + deck.scores["Resilience / Protection"].score + "/5",
      "",
    );
    for (const warning of deck.warnings)
      lines.push("- Warning: " + md(warning));
    for (const unknown of deck.unmatched)
      lines.push(`- Unresolved: ${md(unknown.input)} (${unknown.reason})`);
    for (const [name, score] of Object.entries(deck.scores)) {
      const evidence =
        score.contributors
          .map((c) => `${c.card} [${c.tags.join(", ")}; weight ${c.weight}]`)
          .join(", ") || "No observed contributors";
      lines.push(
        `- ${name}: ${score.score}/5; range [${score.range.join(", ")}]. ${evidence}`,
      );
    }
    lines.push("### Engines and synergies");
    for (const engine of deck.engines)
      lines.push(
        `- ${engine.name} (${engine.kind}): ${engine.explanation} Cards: ${engine.cards.join(", ")}`,
      );
  }
  lines.push(
    "",
    "## Matchup matrix",
    "| Threat | Opponent | Coverage | Status |",
    "|---|---:|---:|---|",
  );
  for (const row of matchup.rows)
    lines.push(
      `| ${row.axis} | ${row.threat}/5 | ${row.coverage}/5 | ${row.status} |`,
    );
  lines.push("", "## Recommendations", report.recommendations.message);
  for (const c of report.recommendations.changes)
    lines.push(
      `- ADD ${c.add}: ${c.reason}`,
      `  CUT candidate: ${c.cut || "Manual review"}. ${c.cut_reason}`,
    );
  lines.push(
    ...matchup.overreaction.advice.map((s) => "- " + s),
    "",
    "## Formula",
    matchup.formula,
    "Pressure = min(1, (Speed + Combat Scaling + Burst Potential) / 15).",
    "Answer coverage = min(5, sum(base × speed × repeatability × resilience × breadth × quantity) / 4 × 5).",
    "Official bracket status: " + report.bracket_advisory.note,
  );
  const a = report.bracket_advisory;
  lines.push(
    "Game Changers flagged by cached data: " +
      (a.game_changers.join(", ") || "None flagged"),
    "Extra-turn candidates: " +
      (a.extra_turn_candidates.join(", ") || "None detected"),
    "Mass land denial candidates: " +
      (a.mass_land_denial_candidates.join(", ") || "None detected"),
    a.snapshot,
  );
  return lines.join("\n");
}
