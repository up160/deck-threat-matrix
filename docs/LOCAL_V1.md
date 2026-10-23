# Deck Threat Matrix

A working local Commander deck analyser: deterministic card tags, 25 explainable category scores, relevant-answer matchup coverage, conservative upgrades and a SQLite deck library. No login, cloud deployment, telemetry, API key or LLM required.

## Start on macOS

Prerequisites: **Python 3.11+** and **Node.js 20.19+** (Node 22 works). Open Terminal in this directory and run:

```sh
./start.sh
```

Open **http://127.0.0.1:8765**. Keep Terminal running; press **Ctrl+C** to stop. First launch creates `.venv`, installs Python/npm dependencies and builds the frontend. Later launches retain decks and cache. Internet access is needed for initial dependencies and uncached Scryfall cards. No card lookup is required to open the interface.

If the port is occupied, stop the previous instance or run `.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8766` after building. Open the matching address. Do not bind an unauthenticated V1 to a public interface.

## Use

1. Paste or upload an opponent list on the left and your list on the right. Export noise, set codes, foil markers and quantities are tolerated. Use **COMMANDER** followed by a blank line or **DECK**, or enter the commander separately. Multiple commanders use semicolons. A commander already in the list is counted once.
2. Select **High-end B2** or **B3** and optionally Simon. These are your philosophy profiles, not an official bracket certification.
3. Choose **Analyse Matchup**. Inspect normalised and unresolved names in the import notices. Sideboard/maybeboard entries are excluded and reported. Unknown or ambiguous names remain explicit; service errors are distinguished from unknown cards.
4. Read **Blast It Out** or inspect the Threat Matrix, Engines, Matchup, Recommendations, Raw Tags and Forensic Report. Expand categories for card/tag/rule contributions, and matchup rows for individual answer weights.
5. Save decks locally. Open **Library details** to set owner, bracket, notes and **Include in my library comparisons**. Save/update that flag before choosing **Analyse against all my decks**. The target environment applies to the whole comparison; saved bracket metadata does not silently filter decks.
6. Copy Markdown or download Markdown/JSON. Candidate adds/cuts are suggestions and never modify saved decks automatically.

`examples/` contains three deliberately partial synthetic lists. Compare `graveyard-threat.txt` with `covered-answers.txt` to exercise overreaction detection. `enchantment-threat.txt` exercises a different axis. These are test scenarios, not legal complete decks. The implementation was also checked against the supplied 100-card Maelstrom Wanderer reference without modifying it.

## Storage and privacy

- `data/matrix.sqlite3`: deck library and card cache; created automatically and ignored by Git.
- Backend serves built React assets from `frontend/dist/` on localhost; no external fonts or scripts.
- Scryfall receives card names on cache misses, never your deck name, owner, notes or opponent profile.
- Exact names are fetched in batches of up to 75 identifiers, with paced exact/fuzzy fallback for unresolved names. Successful results are cached, including both faces, legalities and available prices. Unknown names are cached for one hour. Network failures are never cached as nonexistent cards.
- Requests include application and JSON headers, pause at least 200 ms between requests and respect rate-limit cooldowns. A 429 stops new lookups for the cooldown, while cached cards continue to work. Retry analysis later to fill remaining gaps.
- Successful cache entries remain available indefinitely for offline use. **Prices, Oracle wording, legality and Game Changer metadata can therefore become stale.** To refresh only card data, stop the app, back up the database and delete its `cards` rows with SQLite. Do not delete the database unless you also intend to remove saved decks.
- Back up the SQLite file while the app is stopped. `DTM_DB=/absolute/path/file.sqlite3` overrides the default for development/testing.
- Deck deletion has a confirmation and is permanent within the app. Markdown/JSON reports contain deck details: keep exported files wherever you normally store your decklists.

## Project structure

```text
backend/app/
  parser.py                 text import and commander sections
  scryfall_client.py        paced batch/name lookup and normalisation
  card_cache.py             SQLite card cache and deck persistence
  tagger.py                 composable Oracle/type/keyword rules
  deck_analyser.py          resolution, confidence, validation and overview
  synergy_detector.py       declarative synergies and verified combo patterns
  threat_scorer.py          all 25 category scores with evidence
  matchup_analyser.py       relevant answers and readiness formula
  recommendation_engine.py curated candidates and conservative cuts
  opponent_profiles.py      editable profile loading
  deck_profiles.py          philosophy and separate bracket advisory
  report_generator.py       Markdown forensic report and Blast It Out
  main.py                   FastAPI endpoints and frontend serving
  config/
    tag_overrides.json      per-card add/remove overrides
    scoring.json            version, role weights and saturation thresholds
    patterns.json           extensible synergy/engine patterns
    combos.json             small verified catalogue with prerequisites
    profiles.json           Simon and B2/B3 philosophy
    recommendations.json   candidate identity, applicability and trade-offs
backend/tests/              synthetic fixtures and unit/API tests
frontend/src/               React/TypeScript interface and styles
examples/                   importable partial test scenarios
start.sh                    one-command startup
requirements.txt            Python dependency inputs
requirements.lock           tested Python versions
frontend/package-lock.json  reproducible frontend dependency tree
docs/SPEC.md                approved V1 specification
docs/adr/                   accepted architecture decisions
```

## Transparent scoring (version 1.0)

These are tuneable heuristics. A score is neither a win probability nor an official power/bracket rating.

### Category scores

For each category:

```text
card contribution = quantity × strongest matching tag weight
category = min(5, 5 × sum(card contributions) / category saturation threshold)
```

`backend/app/config/scoring.json` contains every weight and threshold. Multiple synonymous roles on the same card use the strongest, not their sum. Examples: Acceleration saturates at 10 weighted contributions, wipes at 4, recursion at 7. Ordinary land production is excluded from acceleration. MDFC face provenance stays visible; face choice is not simulated.

Stank uses curated swing cards, damage amplification, extra combats, opponents' resources and corroborated verified combo patterns. It is independent of overall deck power. Commander dependency and permanent reliance are **observed support/density proxies**, not proven dependency.

For incomplete lists the lower category bound is the observed score; the upper bound allows each missing slot the category's maximum configured contribution. This intentionally conservative range often reaches 5. It is not a statistical confidence interval.

### Matchup coverage

Each opponent threat axis maps to relevant answer roles. Threat `T` is the maximum relevant opponent category, avoiding double-counting correlated categories. Axes below 0.5 are not included; “not evidenced” never means “safe”.

```text
answer = base relevance × speed × repeatability × resilience × breadth × quantity
coverage C = min(5, 5 × sum(answer) / 4)
```

Base values are explicit in `matchup_analyser.answer_base`: direct graveyard hate 1.2; relevant spot removal 1; token-board sweeps 1.4; other matching wipes 0.85; counterspells only 0.4 against many permanent axes because they cannot remove a resolved threat. Narrow creature/noncreature counterspell restrictions are checked. One-target removal gets only 0.3 against a wide token board. Recovery contributes 0.55 against attrition.

Speed: 1.15 for an instant costing at most two mana; 1 for other instants or cheap spells; 0.8 for costs 3–4; 0.6 for more expensive cards. Bojuka Bog has a 0.65 timing adjustment. Explicit repeatable/persistent overrides multiply by 1.2. Hexproof/indestructible on the answer multiplies by 1.1. Broad removal multiplies by 1.1; targeted hate by 0.9. Activated costs and MDFC access still require review: low casting cost is a proxy, not proof of immediate availability. Soul-Guide Lantern is correctly treated as **one-shot**, not reusable by itself.

| Status | Rule |
|---|---|
| Strong | C ≥ T and C ≥ 1.5 |
| Adequate | Otherwise C ≥ 0.75 × T |
| Weak | Otherwise C ≥ 0.4 × T |
| Critical | Otherwise |

### Readiness, 0–100

```text
axis weight = T² × opponent-profile multiplier
coverage ratio = Σ(weight × min(1, C / max(T, 1))) / Σ(weight)
pressure = min(1, (my Speed + my Combat Scaling + my Burst Potential) / 15)
readiness = round(100 × (0.85 × coverage ratio + 0.15 × pressure))
```

Simon multipliers cannot exceed 1.15 and only apply to an observed axis. If no threats are evidenced, readiness is unavailable. Partial lists display **observed readiness** alongside 0–100 possible bounds: missing cards could introduce both unobserved threats and unobserved answers. A precise-looking observed index is not certainty about the unseen deck.

### Confidence

- **High:** exactly 100 supplied/resolved cards, identified commander and no validation warnings.
- **Medium:** at least 25 resolved cards, ≥80% resolution and identified commander, unless High applies.
- **Low:** otherwise.

The supporting index is completeness × resolution fraction × commander factor (1 if known, otherwise 0.75), scaled to 100. Confidence describes input evidence, not the correctness of every text rule. Singleton, colour identity and selected legality issues are warnings; this is not a full rules engine.

### Recommendations and overreaction

Only Weak/Critical axes with threat ≥1.5 generate candidate upgrades. Candidates must fit resolved commander colour identity, be absent from the list, be Commander-legal and improve the answer matrix. Reserved List and known prices above 250 USD/EUR are excluded conservatively; unknown prices are labelled. There is no GBP conversion or claim that this is an exact £500 rule. The curated catalogue itself avoids ultra-premium cards.

Rank broadly useful candidates against the largest gaps, penalise targeted hate, recalculate marginal coverage after each add, stop at the environment target or five changes (B2 aims at 75% of threat; B3 aims at 100% for the existing Weak/Critical axes). Rest in Peace is withheld when your observed graveyard plan would conflict. This is a bounded greedy heuristic, not proof of the mathematically smallest possible upgrade set. The catalogue currently favours interaction; B3 targets stronger coverage and penalises targeted hate less (0.8 versus B2’s 0.6 ranking multiplier). It does not automatically add tutors or combo packages.

Cuts are explicitly **candidates**. Commanders, lands, detected engine members, ramp, draw, key interaction, protection and finishers are protected. Other cards are ranked by detected role contribution with a conservative preference to keep creatures. Tribal meaning, hidden synergies and personal favourites are not fully understood; review cuts. Partial-list cuts are provisional. If no safe cut is inferred, the report requests manual review rather than damaging the engine.

Strong coverage with at least three observed applicable answer cards sets High overreaction risk and suppresses additional dedicated fixes for that axis. Other Adequate/Strong coverage gives Medium; otherwise Low. This measures risk of **adding redundant hate**, not the chance of losing. General-purpose counter/removal coverage must still be inspected for timing and applicability.

## Extend and tune

Restart after editing backend configuration. Overrides use canonical Scryfall names:

```json
{"My Card": {"add": ["engine", "stank"], "remove": ["tutor"]}}
```

Patterns specify required tags and whether they are a synergy or engine. Verified catalogue combos include prerequisites and source links; card presence never produces a “guaranteed win” claim. Add a separate checked record if a future deterministic-win pattern has fully specified conditions.

Keep imported card data, structured report evidence and narrative rendering separate. Future import providers can produce the existing `DeckInput`; Spellbook can extend the combo provider; an LLM can consume the report without replacing scores; simulation and version comparison can be added as separate services. Profiles and card recommendations are JSON rather than hidden prompt instructions.

API documentation: **http://127.0.0.1:8765/docs**. Main endpoints: `/api/decks` (GET/POST), `/api/decks/{id}` (PUT/DELETE), `/api/analyse`, `/api/analyse-all`, `/api/config`, `/api/health`.

## Tests and development

```sh
.venv/bin/python -m pytest -q
.venv/bin/ruff check backend
.venv/bin/mypy backend/app
cd frontend
npm run typecheck
npm run lint
npm run build
```

Tests mock Scryfall; no network is needed. They cover import noise/sections/counts, cached exact/fuzzy normalisation, rate limits/outages, batch lookup and MDFCs, tags/overrides, missing cards/confidence, capped scoring, relevant/narrow interaction, overreaction, combo prerequisites, SQLite CRUD and bulk/API analysis. Synthetic fixtures intentionally isolate categories rather than imitate multiplayer games.

For separate frontend development, run the FastAPI command above, then `npm run dev` in `frontend/`. Vite proxies `/api` to port 8765.

## Known limits and next iteration

- Oracle rules are heuristics, not a full Magic rules parser. Inspect evidence; improve overrides before trusting unusual wording. Ordinary combat damage/fight removal, many activated costs and conditional alternatives are not exhaustively understood.
- The verified combo and recommendation catalogues are deliberately small. No exhaustive combo claim, goldfish simulation, mulligan model, actual speed-to-win estimate or multiplayer win probability.
- Theme preservation is conservative, not a complete tribal/deckbuilding model. A partial list cannot reveal every identity-defining card or a safe exact cut.
- Official Commander bracket review is advisory and separate from personal B2/B3. Cached Scryfall Game Changer flags, extra-turn and obvious mass-land-denial candidates are shown; missing metadata is explicit. No official restriction snapshot or automatic certification is bundled; cached legality/metadata may be stale.
- Scryfall outages or rate limits leave unresolved slots explicitly unknown. Successful data remains cached until manually refreshed.
- No automatic deck URL imports, dynamic recommendation search, shared accounts, cloud syncing or deployment. Docker is optional and not included; native macOS startup is the V1 path.

Recommended next iteration: calibrate thresholds and answer applicability using your actual decks and recorded matchups; expand Oracle-role overrides and the verified catalogue from those reviews; then add optional Commander Spellbook data and automatic cache refresh. This will improve analytical usefulness more than an LLM writing more confident prose.

Sources: [Scryfall API](https://scryfall.com/docs/api), [collection endpoint](https://scryfall.com/docs/api/cards/collection), [official Commander information](https://magic.wizards.com/en/formats/commander). Card text and prices are sourced from Scryfall and remain attributable to their respective owners.
