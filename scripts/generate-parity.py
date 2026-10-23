"""Generate deterministic synthetic fixtures from the preserved Python reference (no network)."""
import asyncio
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'backend' / 'tests')]
from conftest import card, client as fixture_client  # noqa: E402
from backend.app.card_cache import Store  # noqa: E402
from backend.app.deck_analyser import analyse_deck  # noqa: E402
from backend.app.matchup_analyser import compare  # noqa: E402
from backend.app.opponent_profiles import load_profiles  # noqa: E402
from backend.app.recommendation_engine import recommend  # noqa: E402


def projection(deck):
    return {k: deck[k] for k in ('commander', 'identity', 'identity_known', 'supplied', 'resolved', 'missing', 'confidence', 'scores', 'warnings', 'unmatched', 'overview')}


async def generate():
    with TemporaryDirectory() as folder:
        store = Store(Path(folder) / 'fixtures.sqlite3')
        provider = fixture_client.__wrapped__(store)
        extra = [card('Heliod, Sun-Crowned', 'Lifelink', 'Legendary Enchantment Creature — God', 3, ['W']),
                 card('Walking Ballista', 'Walking Ballista enters with X +1/+1 counters.', 'Artifact Creature', 0),
                 card('Negate', 'Counter target noncreature spell.', 'Instant', 2, ['U']),
                 card('Front // Back', card_faces=[{'name':'Front','oracle_text':'Draw two cards.'},{'name':'Back','oracle_text':'Flying'}])]
        for item in extra:
            store.cache(item['name'], item)
        store.cache('Imaginary Card', None)
        catalogue = json.loads((ROOT / 'backend/app/config/recommendations.json').read_text())
        for candidate in catalogue:
            if not store.cached(candidate['name'])[0]:
                store.cache(candidate['name'], None)
        cards = [json.loads(row[0]) for row in store.connect().execute('SELECT payload FROM cards').fetchall()]
        cards = list({c['name']: c for c in cards if c}.values())
        cases = []
        inputs = [
            ('Graveyard covered', "Reanimate\nAnimate Dead\nEternal Witness\nStitcher's Supplier\nBlood Artist\nViscera Seer", 'Soul-Guide Lantern\nBojuka Bog\nScavenger Grounds\nScavenging Ooze', 'B2', 'Simon'),
            ('Enchantment gap', '8 Mystic Engine', 'Vanilla Giant\nForest', 'B2', ''),
            ('B3 enchantment gap', '8 Mystic Engine', 'Vanilla Giant\nForest', 'B3', ''),
            ('Complete basic list', '99 Forest', '99 Forest', 'B2', ''),
            ('Unresolved and narrow', 'Imaginary Card\nMystic Engine', 'Negate\nSwords to Plowshares', 'B2', ''),
            ('Verified combo and faces', 'Heliod, Sun-Crowned\nWalking Ballista\nFront // Back', 'Beast Within\nCounterspell', 'B3', ''),
        ]
        for name, enemy, personal, env, profile in inputs:
            opponent_input = {'name':name,'text':enemy,'commander':'Test Commander'}
            mine_input = {'name':'My '+name,'text':personal,'commander':'Test Commander'}
            opponent = await analyse_deck(opponent_input, provider)
            mine = await analyse_deck(mine_input, provider)
            matchup = compare(opponent, mine, profile, load_profiles())
            recs = await recommend(mine, matchup, env, provider)
            cases.append({'name':name,'opponent':opponent_input,'mine':mine_input,'environment':env,'profile':profile,
                          'expected':{'opponent':projection(opponent),'mine':projection(mine),'matchup':matchup,'recommendations':recs}})
        result={'cards':cards,'missing':['Imaginary Card']+[c['name'] for c in catalogue if not store.cached(c['name'])[1]],'cases':cases}
        (ROOT/'frontend/tests/parity.json').write_text(json.dumps(result,indent=2)+'\n')


if __name__ == '__main__':
    asyncio.run(generate())
