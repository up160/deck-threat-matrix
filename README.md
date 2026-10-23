# Deck Threat Matrix

A personal Commander matchup analyser that runs **entirely in your browser**. GitHub Pages hosts the static app; your phone/iPad performs analysis and keeps its own deck library. No Python server, Mac connection, account, hosted deck database or incoming access to your home network is required.

**App:** https://up160.github.io/deck-threat-matrix/

## Use on your phone or iPad

1. Open the app in a normal Safari tab. You may add it to your Home Screen, but use the same browser/context consistently: separate contexts may have separate libraries.
2. Paste or upload both decklists, choose your B2/B3 philosophy and optional opponent profile, then analyse. Full/partial lists, commander sections, evidence, report tabs and bulk comparisons are retained.
3. Save decks **on this device**. Under Library details, enable and save “Include in my library comparisons” for bulk analysis.
4. Use **Export library** to save a JSON backup in Files/iCloud Drive. Open the app on your other device and use **Import library** to transfer it. Imports show a preview, then **replace** that device's saved library; they do not merge or automatically sync.
5. Keep exported backups. Clearing website data can remove decks. The app displays changes since export and offers a persistent-storage request, which the browser may decline. Check that your download was actually saved.

A report JSON is not a library backup. Backups contain names, commanders, lists, bracket, owner, notes and comparison flags. They exclude the rebuildable card cache. An import is validated before touching storage; replacement happens in one IndexedDB transaction. A failed transaction retains the previous library.

## Privacy and security

- The public app contains code, rules and synthetic examples. Your pasted lists and saved library are not published to GitHub.
- GitHub receives normal static-site requests. Scryfall receives uncached card-name lookups, including names of potential recommendations. Requests omit credentials and referrers. No owner names, notes or full deck records are sent.
- No analytics, advertising, remote application scripts, secrets, login, proxy, Docker, tunnels or router changes. Static assets include a restrictive Content Security Policy. Dependency integrity and GitHub account security still matter: delivered app code can access its own browser storage.
- GitHub Pages project sites under the same account share the `up160.github.io` origin. URL paths do not isolate browser storage from other code on that origin; keep all apps published under that account trustworthy.
- Storage uses IndexedDB, independently for each browser/origin/device. It is not encrypted storage or a backup. Persistent storage is best effort unless the browser grants persistence, and users can always clear it.
- Internet access is required to load the site and resolve uncached cards. While the page is open, cached analysis works without new lookups. V1 does not include a service worker or promise offline application-shell loading.
- Names are fetched in batches of up to 75, with exact/fuzzy fallback and at least 200 ms request spacing. Rate limits establish a cooldown; outages remain explicit unresolved slots rather than nonexistent cards. Successful cache entries remain available indefinitely; cached prices, legalities and Oracle text can become stale.

## Analysis and limitations

All 25 category scores expose contributing cards, tags, provenance and weights. Deterministic rules and curated overrides remain authoritative; no LLM is involved. Synergies, engines and verified combo patterns remain distinct; card presence does not establish an executable win.

```text
category = min(5, 5 × sum(quantity × strongest matching tag weight) / threshold)
coverage = min(5, 5 × sum(relevant answer weights) / 4)
axis weight = threat² × evidenced opponent-profile multiplier
readiness = 100 × (0.85 × weighted coverage ratio + 0.15 × proactive pressure)
```

Readiness is **not win probability**. Partial lists retain observed scores and explicitly conservative uncertainty bounds. Recommendations preserve identity, suppress redundant hate and propose up to five changes, including zero. B2/B3 are your philosophy profiles; official bracket checks remain advisory. Oracle heuristics, the recommendation catalogue and verified combo catalogue are incomplete. Review evidence and candidate cuts.

Full scoring explanation is preserved in [the original V1 documentation](docs/LOCAL_V1.md#transparent-scoring-version-10); coefficients remain unchanged. The browser port is checked against six Python-generated synthetic scenarios, including exact contributor evidence, confidence, coverage, overreaction and B2/B3 recommendations.

## Project structure

```text
frontend/src/analysis/    modular TypeScript parser, tags, scores, matchups and reports
frontend/src/services/    IndexedDB, Scryfall, library backup and analysis worker
frontend/src/main.tsx     React interface and report views
frontend/tests/          parity, storage, backup, failure and Scryfall tests
backend/app/config/      shared rule/profile/pattern/recommendation JSON
backend/                 preserved Python reference and its tests
scripts/                 parity fixture generation and legacy library export
.github/workflows/       verification and static Pages deployment
```

Only `frontend/dist/` is published. No database, Python code, test fixture or local reference file is included in the deployment artifact. The public source repository includes the Python reference and synthetic tests, but `.gitignore` excludes runtime databases, exports and dependencies. Accepted ADR 0003 replaces the original production architecture; ADRs 0001/0002 remain unchanged.

## Development and checks

Node.js **22.12+** is required for the test tooling. From the project root:

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

The development server binds only to `127.0.0.1`; it is not needed to use the published app. To verify:

```sh
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend audit
```

For a local production preview: `npm --prefix frontend run preview`. No Python process is needed. The relative asset base supports GitHub Pages repository paths.

For reference regression checks, install `requirements.lock` in a Python 3.11+ virtual environment, then run:

```sh
python -m pytest -q
ruff check backend
mypy backend/app
python scripts/generate-parity.py
git diff --exit-code frontend/tests/parity.json
```

GitHub Actions runs both suites, checks parity, builds, and deploys only `frontend/dist` on changes to `main`. Pull requests run verification without publishing. In repository Settings → Pages, the publishing source is **GitHub Actions**. No deployment secret is required; the workflow uses GitHub's scoped Pages/OIDC permissions.

## Existing Mac data

`data/matrix.sqlite3` and the Python backend are untouched. The original app is retained in Git history and under the `original-local-v1` tag. `start.sh` is the legacy server launcher, not the recommended way to use this app.

To transfer saved SQLite decks, run the read-only exporter on the Mac:

```sh
.venv/bin/python scripts/export-legacy-library.py --output /tmp/deck-threat-matrix-library.json
```

Import that JSON into the browser app. It contains private deck metadata; do not commit it. The script does not alter SQLite. Copy files through Files/iCloud Drive for subsequent manual device transfer.

## Verification boundaries

Automated tests and desktop browser walkthroughs cover storage, worker analysis, backups and mobile-sized layouts. **Actual iPhone/iPad Safari verification requires those devices** and must not be inferred from desktop emulation. Check upload/download behaviour and persistence on your own devices before relying on the local library alone. Keep a backup in Files.

Next iteration: calibrate answer applicability and role rules against your actual decks and recorded matchups. Automatic sync would add accounts/hosted storage and is intentionally excluded.

### Reading the first page
The default **Matchup Overview** explains the coverage verdict, three main threats, your applicable answers and practical play pointers. It separately asks whether the opponent shows broader strength than your deck and whether their list raises concerns for your personal B2/B3 target. Neither check predicts a winner or certifies official brackets. Open each check's evidence, or use the detailed tabs for all card contributions and scoring. Incomplete lists remain provisional. A limited recommendation catalogue may leave real gaps without a safe suggested addition.

The exact overview thresholds and compared capability dimensions are documented in [the spec](docs/SPEC.md#matchup-overview-issue-5). Stank and permanent density are excluded from the relative power check; the existing readiness formula is unchanged.
