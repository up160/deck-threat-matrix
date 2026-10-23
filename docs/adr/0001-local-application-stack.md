# ADR 0001: Local application stack and data boundary

Status: Accepted

## Context
The app must run easily on macOS, persist decks and cache card data locally, and support a maintainable interactive interface without login or hosting.

## Decision
Use FastAPI and Python for modular analysis, SQLite for decks and Scryfall cache, and React/TypeScript with Vite for the interface. A startup script installs declared dependencies when needed, builds the frontend and launches FastAPI on localhost; FastAPI serves the built frontend. Development may use a separate Vite server. Store runtime data in the ignored project-local data directory. Scryfall is the sole required external service, used only for uncached card data. No telemetry or remote deck storage.

## Consequences
Python and Node.js are prerequisites for first setup; subsequent launches retain cached data. SQLite needs no separate service. Initial uncached analysis requires network access. The localhost-only, unauthenticated app is intended for one trusted local user. Moving to shared hosting would require a new security/data-access decision.
