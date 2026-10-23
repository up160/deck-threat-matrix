import asyncio
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .card_cache import Store
from .deck_analyser import analyse_deck
from .deck_profiles import bracket_advisory
from .matchup_analyser import compare
from .opponent_profiles import load_profiles
from .recommendation_engine import recommend
from .report_generator import blast, markdown
from .scryfall_client import ScryfallClient

ROOT = Path(__file__).resolve().parents[2]
store = Store(Path(os.environ.get("DTM_DB", ROOT / "data" / "matrix.sqlite3")))
client = ScryfallClient(store)
app = FastAPI(title="Deck Threat Matrix", version="1.0.0")
analysis_lock = asyncio.Lock()


class DeckInput(BaseModel):
    name: str = Field(default="Untitled deck", max_length=200)
    commander: str = Field(default="", max_length=300)
    text: str = Field(min_length=1, max_length=60000)


class SavedDeck(DeckInput):
    bracket: Literal["B2", "B3"] = "B2"
    owner: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=10000)
    include_in_comparisons: bool = False


class AnalysisRequest(BaseModel):
    opponent: DeckInput
    mine: DeckInput
    environment: Literal["B2", "B3"] = "B2"
    profile: str = ""


class BulkRequest(BaseModel):
    opponent: DeckInput
    environment: Literal["B2", "B3"] = "B2"
    profile: str = ""


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "local": True, "version": "1.0.0"}


@app.get("/api/config")
def config() -> dict:
    return load_profiles()


@app.get("/api/decks")
def list_decks() -> list:
    return store.decks()


@app.post("/api/decks")
def save_deck(deck: SavedDeck) -> dict:
    payload = {**deck.model_dump(), "updated": datetime.now(UTC).isoformat()}
    return {**payload, "id": store.save(payload)}


@app.put("/api/decks/{deck_id}")
def update_deck(deck_id: int, deck: SavedDeck) -> dict:
    payload = {**deck.model_dump(), "updated": datetime.now(UTC).isoformat()}
    try:
        store.save(payload, deck_id)
    except KeyError:
        raise HTTPException(404, "Deck not found") from None
    return {**payload, "id": deck_id}


@app.delete("/api/decks/{deck_id}")
def delete_deck(deck_id: int) -> dict:
    if not store.delete(deck_id):
        raise HTTPException(404, "Deck not found")
    return {"deleted": deck_id}


def validate_profile(profile: str) -> None:
    if profile and profile not in load_profiles()["opponents"]:
        raise HTTPException(422, "Unknown opponent profile")


async def build_report(
    opponent: dict[str, Any], mine_input: dict[str, Any], environment: str, profile: str
) -> dict[str, Any]:
    mine = await analyse_deck(mine_input, client)
    matchup = compare(opponent, mine, profile, load_profiles())
    report = {
        "opponent": opponent,
        "mine": mine,
        "environment": environment,
        "profile": profile,
        "matchup": matchup,
        "recommendations": await recommend(mine, matchup, environment, client),
        "bracket_advisory": bracket_advisory(mine),
        "generated": datetime.now(UTC).isoformat(),
    }
    report["blast"] = blast(report)
    report["markdown"] = markdown(report)
    return report


@app.post("/api/analyse")
async def analyse(request: AnalysisRequest) -> dict:
    validate_profile(request.profile)
    if analysis_lock.locked():
        raise HTTPException(409, "An analysis is already running; please wait.")
    async with analysis_lock:
        opponent = await analyse_deck(request.opponent.model_dump(), client)
        return await build_report(opponent, request.mine.model_dump(), request.environment, request.profile)


@app.post("/api/analyse-all")
async def analyse_all(request: BulkRequest) -> dict:
    validate_profile(request.profile)
    decks = [d for d in store.decks() if d.get("include_in_comparisons")]
    if not decks:
        raise HTTPException(422, "Save at least one deck with Include in my comparisons enabled.")
    if analysis_lock.locked():
        raise HTTPException(409, "An analysis is already running; please wait.")
    async with analysis_lock:
        opponent = await analyse_deck(request.opponent.model_dump(), client)
        reports = []
        for deck in decks:
            report = await build_report(opponent, deck, request.environment, request.profile)
            reports.append(
                {
                    "id": deck["id"],
                    "name": deck["name"],
                    "readiness": report["matchup"]["readiness"],
                    "confidence": report["mine"]["confidence"]["level"],
                    "weakness": next(
                        (r["axis"] for r in report["matchup"]["rows"] if r["status"] in ("Weak", "Critical")),
                        "No major observed gap",
                    ),
                    "report": report,
                }
            )
        return {
            "decks": sorted(reports, key=lambda r: r["readiness"] if r["readiness"] is not None else -1, reverse=True)
        }


DIST = ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/")
def index() -> FileResponse:
    if not (DIST / "index.html").exists():
        raise HTTPException(503, "Frontend not built. Run ./start.sh first.")
    return FileResponse(DIST / "index.html")
