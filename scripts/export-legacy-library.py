"""Read-only legacy SQLite library export; never publish the exported private JSON."""
import argparse
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--database', type=Path, default=Path(__file__).resolve().parents[1] / 'data/matrix.sqlite3')
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
if args.output.resolve() == args.database.resolve():
    parser.error('Output must not be the database file.')
with sqlite3.connect(args.database.resolve().as_uri() + '?mode=ro', uri=True) as database:
    decks = [dict(json.loads(payload), id=identifier) for identifier, payload in database.execute('SELECT id,payload FROM decks ORDER BY id')]
backup = {'format':'deck-threat-matrix-library', 'version':1, 'exported_at':datetime.now(UTC).isoformat(), 'decks':decks}
with args.output.open('x') as output:
    json.dump(backup, output, indent=2)
print(f'Exported {len(decks)} deck(s). The database was not modified.')
