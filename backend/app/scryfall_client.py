"""Paced exact-name batches plus cached fuzzy fallback, with explicit service failures."""

import asyncio
import time
from typing import Any

import httpx

from .card_cache import Store


class CardServiceError(Exception):
    pass


def normalise(card: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "id",
        "oracle_id",
        "name",
        "oracle_text",
        "mana_cost",
        "cmc",
        "colors",
        "color_identity",
        "type_line",
        "keywords",
        "legalities",
        "prices",
        "card_faces",
        "reserved",
        "layout",
        "scryfall_uri",
        "game_changer",
    )
    return {
        key: card.get(
            key,
            []
            if key in ("colors", "color_identity", "keywords", "card_faces")
            else {}
            if key in ("legalities", "prices")
            else "",
        )
        for key in keys
    }


def name_key(name: str) -> str:
    return name.casefold().replace("’", "'").replace("æ", "ae").strip()


class ScryfallClient:
    def __init__(self, store: Store):
        self.store = store
        self.lock = asyncio.Lock()
        self.cooldown_until = 0.0

    async def request(self, method: str, endpoint: str, **kwargs: Any) -> httpx.Response:
        if time.monotonic() < self.cooldown_until:
            raise CardServiceError("Scryfall rate limit cooldown is active. Try again later; cached cards still work.")
        async with httpx.AsyncClient(
            timeout=20,
            headers={
                "User-Agent": "DeckThreatMatrix/1.0 (local Commander analysis)",
                "Accept": "application/json",
            },
        ) as client:
            for attempt in range(3):
                await asyncio.sleep(0.2)
                try:
                    response = await client.request(method, "https://api.scryfall.com" + endpoint, **kwargs)
                except httpx.HTTPError as exc:
                    raise CardServiceError("Scryfall could not be reached; cached cards still work.") from exc
                if response.status_code == 429:
                    try:
                        delay = max(30.0, float(response.headers.get("Retry-After", 60)))
                    except ValueError:
                        delay = 60.0
                    self.cooldown_until = time.monotonic() + delay
                    raise CardServiceError(
                        f"Scryfall rate limited this lookup. Wait at least {int(delay)} seconds before retrying; cached cards still work."
                    )
                if response.status_code < 500:
                    return response
                await asyncio.sleep(1 + attempt)
            raise CardServiceError("Scryfall is temporarily unavailable; this is not an unknown-card result.")

    async def prefetch(self, names: list[str]) -> None:
        """Collection endpoint accepts up to 75 identifiers; reduce a full import to a few requests."""
        missing = list(dict.fromkeys(name for name in names if not self.store.cached(name)[0]))
        async with self.lock:
            for offset in range(0, len(missing), 75):
                batch = missing[offset : offset + 75]
                response = await self.request(
                    "POST", "/cards/collection", json={"identifiers": [{"name": n} for n in batch]}
                )
                if response.status_code != 200:
                    raise CardServiceError(
                        f"Scryfall collection lookup returned HTTP {response.status_code}; cached cards still work."
                    )
                try:
                    data = response.json()
                except ValueError as exc:
                    raise CardServiceError("Scryfall returned unreadable data; cached cards still work.") from exc
                for raw in data.get("data", []):
                    card = normalise(raw)
                    self.store.cache(card["name"], card)
                    aliases = [card["name"]] + [face.get("name", "") for face in card.get("card_faces", [])]
                    for name in batch:
                        if name_key(name) in [name_key(alias) for alias in aliases]:
                            self.store.cache(name, card)

    async def resolve(self, name: str) -> tuple[dict[str, Any] | None, str]:
        hit, card = self.store.cached(name)
        if hit:
            mode = "cache"
            if (
                card
                and name_key(card["name"]) != name_key(name)
                and name_key(name) not in [name_key(f.get("name", "")) for f in card.get("card_faces", [])]
            ):
                mode = "cached normalisation"
            return card, mode
        async with self.lock:
            hit, card = self.store.cached(name)
            if hit:
                return card, "cache"
            for mode in ("exact", "fuzzy"):
                response = await self.request("GET", "/cards/named", params={mode: name})
                if response.status_code == 404:
                    continue
                if response.status_code != 200:
                    raise CardServiceError(
                        f"Scryfall returned HTTP {response.status_code}; this is not an unknown-card result."
                    )
                try:
                    card = normalise(response.json())
                except ValueError as exc:
                    raise CardServiceError("Scryfall returned unreadable data; cached cards still work.") from exc
                self.store.cache(name, card)
                self.store.cache(card["name"], card)
                return card, mode
            self.store.cache(name, None)
            return None, "unmatched or ambiguous"
