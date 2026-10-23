from fastapi.testclient import TestClient

from backend.app import main


def test_library_crud_and_bulk(database, client, monkeypatch):
    monkeypatch.setattr(main, "store", database)
    monkeypatch.setattr(main, "client", client)
    with TestClient(main.app) as api:
        payload = {
            "name": "Answers",
            "text": "Beast Within\nCounterspell",
            "commander": "Test Commander",
            "include_in_comparisons": True,
        }
        saved = api.post("/api/decks", json=payload).json()
        assert saved["id"] > 0
        assert api.get("/api/decks").json()[0]["name"] == "Answers"
        payload["notes"] = "Updated locally"
        assert api.put("/api/decks/" + str(saved["id"]), json=payload).status_code == 200
        analysis = api.post(
            "/api/analyse",
            json={"opponent": {"text": "Blood Artist\nViscera Seer", "commander": "Test Commander"}, "mine": payload},
        ).json()
        assert len(analysis["opponent"]["scores"]) == 25
        assert "markdown" in analysis
        bulk = api.post(
            "/api/analyse-all", json={"opponent": {"text": "Blood Artist\nViscera Seer", "commander": "Test Commander"}}
        )
        assert bulk.status_code == 200
        assert len(bulk.json()["decks"]) == 1
        assert api.delete("/api/decks/" + str(saved["id"])).status_code == 200
        assert api.get("/api/decks").json() == []
        assert api.post("/api/analyse-all", json={"opponent": {"text": "Sol Ring"}}).status_code == 422


def test_bad_profile_and_validation(database, monkeypatch):
    monkeypatch.setattr(main, "store", database)
    with TestClient(main.app) as api:
        assert (
            api.post(
                "/api/analyse", json={"opponent": {"text": "a"}, "mine": {"text": "b"}, "profile": "Made up"}
            ).status_code
            == 422
        )
        assert api.post("/api/decks", json={"text": ""}).status_code == 422
        assert api.delete("/api/decks/999").status_code == 404
