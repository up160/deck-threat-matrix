"""SQLite persistence; every operation uses its own connection."""

import json
import sqlite3
import time
from pathlib import Path
from typing import Any


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS cards (query TEXT PRIMARY KEY, payload TEXT, fetched REAL);
                CREATE TABLE IF NOT EXISTS decks (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
            """)

    def connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=20)

    def cached(self, query: str) -> tuple[bool, Any]:
        with self.connect() as db:
            row = db.execute("SELECT payload,fetched FROM cards WHERE query=?", (query.casefold(),)).fetchone()
        if row:
            payload = json.loads(row[0])
            # Successful records remain usable offline; misses expire after one hour.
            if payload is not None or time.time() - row[1] < 3600:
                return True, payload
        return False, None

    def cache(self, query: str, payload: Any) -> None:
        with self.connect() as db:
            db.execute(
                "INSERT OR REPLACE INTO cards VALUES (?,?,?)", (query.casefold(), json.dumps(payload), time.time())
            )

    def decks(self) -> list[dict[str, Any]]:
        with self.connect() as db:
            rows = db.execute("SELECT id,payload FROM decks ORDER BY id DESC").fetchall()
        return [dict(json.loads(row[1]), id=row[0]) for row in rows]

    def save(self, payload: dict[str, Any], deck_id: int | None = None) -> int:
        with self.connect() as db:
            if deck_id is not None:
                cursor = db.execute("UPDATE decks SET payload=? WHERE id=?", (json.dumps(payload), deck_id))
                if not cursor.rowcount:
                    raise KeyError(deck_id)
                return deck_id
            cursor = db.execute("INSERT INTO decks(payload) VALUES (?)", (json.dumps(payload),))
            assert cursor.lastrowid is not None
            return cursor.lastrowid

    def delete(self, deck_id: int) -> bool:
        with self.connect() as db:
            return bool(db.execute("DELETE FROM decks WHERE id=?", (deck_id,)).rowcount)
