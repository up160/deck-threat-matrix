import type { Report } from "./types";
export function MatchupOverview({ report }: { report: Report }) {
  const summary = report.summary;
  return (
    <div className="matchup-overview">
      <div className="overview-verdict">
        <span className="eyebrow">YOUR MATCHUP IN A MINUTE</span>
        <h2>{summary.verdict}</h2>
        <p>{summary.explanation}</p>
        <small>{summary.confidence}</small>
      </div>
      {report.opponent.overview.plan.length > 0 && (
        <p>
          <b>Their likely plan:</b> {report.opponent.overview.plan.join("; ")}.
          See Engines for the card connections.
        </p>
      )}
      <div className="overview-checks">
        {[
          ["Is their deck overpowered compared with mine?", summary.power],
          [
            `Is their deck too powerful for ${report.environment}?`,
            summary.environment,
          ],
        ].map(([question, check]) => {
          const item = check as typeof summary.power;
          return (
            <section key={question as string}>
              <h3>{question as string}</h3>
              <strong>{item.title}</strong>
              <p>{item.explanation}</p>
              {item.evidence.length > 0 && (
                <details>
                  <summary>
                    Why we say this ({item.evidence.length} signals)
                  </summary>
                  <ul>
                    {item.evidence.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          );
        })}
      </div>
      <h3>Their biggest threats — and what you can do</h3>
      {!summary.threats.length && (
        <p>
          No threat categories could be evidenced yet. This does not mean their
          deck is harmless.
        </p>
      )}
      <div className="overview-threats">
        {summary.threats.map((t, i) => (
          <section key={t.axis}>
            <span className="eyebrow">
              THREAT {i + 1} · {t.threat}/5
            </span>
            <h3>{t.axis}</h3>
            <p>{t.why}</p>
            <p>
              <b>Watch:</b>{" "}
              {t.cards.join(", ") || "Inspect the Threat Matrix for evidence."}
            </p>
            <p>
              <span className={"badge " + t.status.toLowerCase()}>
                {t.status} coverage · {t.coverage}/5
              </span>
            </p>
            {t.answers.length ? (
              <div>
                <p>
                  <b>Your answers:</b> {t.answer_cards.join(", ")}
                </p>
                <details>
                  <summary>Timing and restrictions</summary>
                  <ul>
                    {t.answers.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </details>
              </div>
            ) : (
              <p>
                <b>Your gap:</b> No applicable answer observed.
              </p>
            )}
            <p>
              <b>Play pointer:</b> {t.pointer}
            </p>
          </section>
        ))}
      </div>
      <section className="overview-actions">
        <h3>Changes actually needed?</h3>
        <p>{summary.changes}</p>
        {report.recommendations.changes.map((c) => (
          <p key={c.add}>
            <b>
              Consider {c.add}
              {c.targeted_hate ? " · targeted hate" : ""}
              {c.filthy ? " · filthy option" : ""}
            </b>
            <br />
            {c.reason}
            <br />
            <small>
              Cut candidate: {c.cut || "manual review"}. {c.cut_reason}{" "}
              {c.provisional ? "Provisional — review before cutting." : ""}
            </small>
          </p>
        ))}
        <p>
          <b>Overreaction risk: {report.matchup.overreaction.risk}</b>
        </p>
        {report.matchup.overreaction.advice.map((s) => (
          <p key={s}>{s}</p>
        ))}
      </section>
      <p className="overview-footnote">
        Observed readiness:{" "}
        {report.matchup.readiness === null
          ? "unavailable"
          : report.matchup.readiness + "%"}{" "}
        · answers and pressure, not win probability.{" "}
        {report.matchup.partial
          ? "Incomplete lists: possible readiness range 0–100."
          : ""}{" "}
        Opponent Stank: {report.blast.stank}/5 · sudden swing potential, not
        overall power. Full evidence remains in the detailed tabs.
      </p>
    </div>
  );
}
