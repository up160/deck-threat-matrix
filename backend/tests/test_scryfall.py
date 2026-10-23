import asyncio
from unittest.mock import patch

import httpx
import pytest
from conftest import card

from backend.app.scryfall_client import CardServiceError, ScryfallClient


def test_exact_fuzzy_normalisation_and_cache(database):
    requests = []

    async def respond(request):
        requests.append(request)
        if request.url.params.get("exact") == "Sole Ring":
            return httpx.Response(404)
        return httpx.Response(200, json=card("Sol Ring"))

    factory = httpx.AsyncClient
    transport = httpx.MockTransport(respond)
    with patch(
        "backend.app.scryfall_client.httpx.AsyncClient", side_effect=lambda **kw: factory(transport=transport, **kw)
    ):
        client = ScryfallClient(database)
        value, mode = asyncio.run(client.resolve("Sole Ring"))
        assert value["name"] == "Sol Ring" and mode == "fuzzy"
        assert asyncio.run(client.resolve("Sole Ring"))[0]["name"] == "Sol Ring"
    assert len(requests) == 2
    assert requests[0].headers["User-Agent"].startswith("DeckThreatMatrix")


def test_outage_is_not_cached_as_missing(database):
    async def respond(request):
        raise httpx.ConnectError("offline")

    factory = httpx.AsyncClient
    with (
        patch(
            "backend.app.scryfall_client.httpx.AsyncClient",
            side_effect=lambda **kw: factory(transport=httpx.MockTransport(respond), **kw),
        ),
        pytest.raises(CardServiceError),
    ):
        asyncio.run(ScryfallClient(database).resolve("Sol Ring"))
    assert database.cached("Sol Ring") == (False, None)


def test_ambiguous_result_is_explicit(database):
    factory = httpx.AsyncClient
    with patch(
        "backend.app.scryfall_client.httpx.AsyncClient",
        side_effect=lambda **kw: factory(transport=httpx.MockTransport(lambda req: httpx.Response(404)), **kw),
    ):
        result = asyncio.run(ScryfallClient(database).resolve("ambiguous"))
    assert result == (None, "unmatched or ambiguous")
    assert database.cached("ambiguous") == (True, None)


def test_collection_batches_and_faces(database):
    calls = []

    async def respond(request):
        calls.append(request)
        return httpx.Response(
            200,
            json={
                "data": [
                    card(
                        "Front // Back",
                        card_faces=[
                            {"name": "Front", "oracle_text": "Draw a card."},
                            {"name": "Back", "oracle_text": ""},
                        ],
                    )
                ],
                "not_found": [],
            },
        )

    factory = httpx.AsyncClient
    with patch(
        "backend.app.scryfall_client.httpx.AsyncClient",
        side_effect=lambda **kw: factory(transport=httpx.MockTransport(respond), **kw),
    ):
        client = ScryfallClient(database)
        asyncio.run(client.prefetch(["Front"]))
        assert asyncio.run(client.resolve("Front"))[0]["name"] == "Front // Back"
    assert len(calls) == 1
    assert calls[0].method == "POST"


def test_rate_limit_cooldown_stops_repeated_requests(database):
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(429, headers={"Retry-After": "120"})

    factory = httpx.AsyncClient
    with patch(
        "backend.app.scryfall_client.httpx.AsyncClient",
        side_effect=lambda **kw: factory(transport=httpx.MockTransport(respond), **kw),
    ):
        client = ScryfallClient(database)
        with pytest.raises(CardServiceError, match="120"):
            asyncio.run(client.resolve("Anything"))
        with pytest.raises(CardServiceError, match="cooldown"):
            asyncio.run(client.resolve("Anything"))
    assert len(calls) == 1
    assert database.cached("Anything") == (False, None)
