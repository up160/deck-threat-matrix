# Deck Threat Matrix — V1 specification

Status: Approved

## Purpose
A local-first Commander deck analysis app that explains observed threats, relevant answers and the smallest useful matchup improvements. Scores are transparent heuristics, not win probabilities or proof of deck power.

## Approved product choices
- FastAPI, SQLite, React with TypeScript and Vite. No authentication or cloud deployment. Bind to localhost.
- One macOS startup command; dependency installation on first run. Database and card cache in an ignored project-local data directory.
- Paste or upload text lists on opponent and personal deck panels. Separate commander field; recognise COMMANDER sections, quantities and common export noise. Report unresolved names and excluded sideboard/maybeboard entries.
- Full and partial lists supported. Report observed scores and uncertainty ranges, with confirmed threats distinguished from unknown answer coverage. Never extrapolate missing cards as fact.
- B2 and B3 are the user's philosophy profiles. Official Commander bracket concerns appear separately and are advisory. V1 uses cached Scryfall Game Changer metadata and conservative extra-turn/mass-land-denial candidates, with missing data reported; it does not bundle a maintained official restriction snapshot or certify brackets.
- Optional editable Opponent profile only increases weights for threats evidenced in the supplied list.
- Curated recommendation catalogue with editable rules. Up to five suggested changes, including zero. Exact candidate cuts have reasons and uncertainty. Partial-list recommendations are provisional; never cut the commander, basic mana infrastructure or an identified core engine simply for low tag count.
- Small verified combo catalogue; all other detected patterns explicitly labelled synergy or engine. Distinguish combo from deterministic win and describe prerequisites and limitations.
- Save decks with name, commander, bracket, owner, list, notes, updated date and explicit inclusion in personal bulk comparisons. Support editing and deletion.
- Export reports as copied Markdown and downloadable JSON.
- Calibration uses synthetic test decks and real user lists when available. No simulated multiplayer results are claimed.

## Card data and parsing
Scryfall resolves exact names first, followed by explicitly reported fuzzy matches. Store canonical name, oracle text, mana cost/value, colours, colour identity, types, keywords, legalities, prices and all faces. Cache successful results and short-lived misses; distinguish service failures from unknown cards. Pace requests conservatively, identify the application, honour rate limiting and retry instructions. Cached analysis works offline; uncached omissions lower confidence. User data remains local; card names are sent to Scryfall on cache misses.

Commander supplied separately is counted once when also present in the main list. Recognised partner/background configurations are represented without silently inventing legality. Commander inference requires a labelled section. Colour identity and Commander legality issues are warnings. Full list confidence also depends on resolution and validity, not merely line count.

## Analysis contract
Provide all 25 requested categories, including independent Stank Score. Each score exposes contributing cards, tags, rule identifiers and contribution weights. Density and role strength influence scores; raw quantity must not make ordinary basic lands look like engines. Multi-face tagging retains face provenance and does not assume both faces are simultaneously available.

Modular components: parser, scryfall_client, card_cache, tagger, tag_overrides, deck_analyser, synergy_detector, threat_scorer, matchup_analyser, recommendation_engine, opponent_profiles, deck_profiles and report_generator. Data-driven JSON files hold overrides, engine patterns, verified combos, profiles and recommendation candidates.

The report includes game plan, commander role, engines, likely finishers, interaction, weaknesses, resilience, confidence and recommendations. Claims reference observed cards. Unknown features and heuristic blind spots are explicit.

## Initial scoring methodology
Version all formulae and expose coefficients in configuration. Category score = min(5, sum of weighted observed card contributions / category saturation threshold * 5). Define role-specific weights and thresholds; avoid counting the same physical card repeatedly within one category. Stank uses swing effects and corroborated engine patterns, independently of total power.

Matchup axes map opponent threats to relevant answer tags and answer applicability. Answers receive adjustments for mana cost, instant-speed availability, repeatability, resilience and breadth. Card evidence explains each adjustment; repeated activations do not count as extra physical cards. Narrow answers contribute only to eligible threats. General counterspells cannot imply removal of resolved permanents.

For each evidenced threat axis, threat severity T is 0–5 and coverage C is 0–5. Initial status thresholds: Strong C >= T; Adequate C >= 0.75T; Weak C >= 0.4T; otherwise Critical. Coverage must meet an absolute floor to be Strong against very low threats. Zero observed threat is labelled not evidenced, not safe.

Readiness = round(100 * (0.85 * weighted mean(min(1,C/max(T,1))) + 0.15 * pressure)), bounded 0–100. Threat weight = T squared * profile multiplier (maximum 1.15). Pressure is a documented 0–1 function of observed speed, combat/burst potential and finishers. If no meaningful threats are evidenced, readiness is unavailable. Readiness is a coverage index, never a win probability. Partial-list uncertainty is shown separately rather than hidden in a fabricated precision adjustment.

Confidence combines list completeness, resolved fraction and commander identification. Uncertainty ranges are conservative heuristic bounds on unobserved contribution, not statistical confidence intervals. Observed scores remain visible even when confidence is low.

Overreaction evaluates existing relevant answer density and breadth. Strong coverage suppresses extra hate recommendations; medium/high risk explains which additional narrow slots would be redundant. Recommendations obey commander colour identity when known, avoid duplicates and ultra-premium cards, prefer useful broad answers, preserve theme and explicitly distinguish targeted hate and filthy options. Missing commander identity prevents colour-dependent recommendations.

## Interface
Responsive dark layout with subtle modern retro details, readable body text, colour-blind-friendly blue/orange/purple palette and non-colour status labels. Two deck panels with paste/upload/load/save, commander, environment and opponent profile. Analyse Matchup and Analyse Against All My Decks actions. Tabs: Blast It Out, Threat Matrix, Engines, Matchup, Recommendations, Raw Tags, plus Forensic Report access. Expandable evidence, clear loading/error states and accessible controls. No sound or decorative animation.

## Verification and acceptance
Unit tests cover parsing, normalisation with mocked Scryfall, tagging, incomplete lists, commander identification, scoring, relevant coverage and overreaction. Synthetic fixtures exercise graveyards, enchantments, sacrifice, commander damage and already-covered matchups. Include integration tests for persistence and API analysis. Run backend tests/lint/type checks and frontend type-check/lint/build, then browser-check paste/upload, analysis, evidence, saving/reloading, bulk comparison and exports. Report unverified paths honestly.

## Boundaries and extension points
No LLM requirement, automatic recommendation search, Moxfield/Archidekt import, full Spellbook integration, goldfish simulation or deck ownership tracking in V1. Define provider and pattern interfaces for future additions. Deterministic heuristics cannot prove absence of threats, exhaustive combo recognition, game outcomes or complete rules correctness. Price data is optional and currency-labelled; unavailable prices are not treated as free.

## Approved architecture amendment — 23 October 2026

ADR 0003 supersedes the original FastAPI/SQLite production architecture. The deployed V1 is a public GitHub Pages React/TypeScript application with deterministic analysis in a Web Worker, IndexedDB device-local storage and direct Scryfall requests. No hosted backend or personal computer/network exposure. All report modes, scoring and deck-library behaviours above remain; the HTTP API is replaced with local typed services.

Libraries are independent per device. Version 1 JSON library exports include saved deck metadata/lists/notes; report JSON is not a library backup. Imports validate and preview before explicitly replacing the local library atomically. Card cache is rebuildable and is not included. Persistence status and changes-since-export are shown; failed persistence or quota errors must never be presented as successful saves. Public assets contain no personal SQLite data, backups, local notes or synced source documents. Publication uses GitHub Actions; live iPhone/iPad Safari tests require actual device access and must not be claimed based solely on desktop testing.
