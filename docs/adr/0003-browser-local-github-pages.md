# ADR 0003: Browser-local application on GitHub Pages

**Status:** Accepted
**Date:** 23 October 2026
**Decider:** Darren
**Supersedes:** ADR 0001 for the deployed application. ADR 0002 remains accepted.

## Context
The original localhost FastAPI/SQLite app addressed Mac-only use. The primary devices are now iPhone and iPad. The user prioritises simple personal use, minimal cost and maintenance, and no incoming connections to their Mac or home network. The user accepts a public app with private device-local decks and manual file-based transfer between devices.

## Decision
Deploy static React/TypeScript assets to GitHub Pages. Run deterministic analysis in a Web Worker; use IndexedDB for saved decks, card cache and schema/backup metadata. Request card data directly from Scryfall over HTTPS. There is no runtime backend, hosted deck database, login, secret, proxy, telemetry or network listener on personal computers. No Docker, VPN or router changes.

Replace the UI's HTTP API client with a typed local service preserving report shapes. Port the original analysis without changing scoring coefficients. Keep shared configuration JSON authoritative; preserve Python and its original SQLite data for reference. Use versioned JSON library exports/imports for backups and transfer through Files/iCloud Drive. Imports preview then explicitly replace the local library in one transaction. Request persistent browser storage; show whether it was granted and whether changes occurred since export. Exports are user downloads, not proof that a backup was retained.

## Options considered

| Option | Complexity | Cost | Suitability |
|---|---|---|---|
| GitHub Pages + IndexedDB | Low; browser APIs, static deployment | Free within current Pages limits for a public repository | Selected |
| Pages + SQLite WebAssembly | Additional runtime, worker/persistence configuration | Same hosting cost | No benefit for JSON-record storage today |
| Mac server + isolation/private network | Multiple services, patching, network policy | Local resources and possible service fees | Does not meet the desired operating model |
| Hosted backend/database | Authentication, backups, server management | Possible recurring charges | Unnecessary without automatic sync |

## Trade-off analysis
IndexedDB removes SQL/WASM integration and permits native browser persistence. Keeping deterministic logic in TypeScript avoids Python-in-browser runtimes. No automatic sync means fewer services and privacy boundaries, at the cost of deliberate backup/import. A public app means anybody can use their own isolated library; it does not publish this user's decks. GitHub account/repository and dependency integrity remain important because delivered JavaScript can access its own origin's storage.

## Consequences
- Phone/iPad usage does not depend on the Mac, and no personal computer accepts incoming connections.
- Browser storage can be cleared or evicted; persistence requests are not a substitute for exported backups. Different browsers, origins and Home Screen contexts may have separate storage.
- No initial offline application-shell guarantee: internet is required to load the static app. While loaded, cached-card analysis works offline; uncached cards remain unknown.
- Card queries go to Scryfall; owner names, notes and full deck records are not uploaded. Browser-controlled User-Agent cannot be set by application code.
- Original Python remains a reference, not a second production system. Changing shared rules must update parity fixtures and pass tests.
- Actual iPhone/iPad Safari verification must be reported honestly; desktop emulation is not a replacement.

## Action items
1. Port analysis and verify structured Python parity with synthetic fixtures.
2. Implement browser persistence, atomic import/export and failure handling.
3. Add mobile-friendly library controls and storage/backup notices.
4. Deploy using GitHub Actions, publish only static build assets, verify requests and report device test limits.
