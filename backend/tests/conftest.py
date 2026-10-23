import pytest

from backend.app.card_cache import Store
from backend.app.scryfall_client import ScryfallClient


def card(name, text="", types="Artifact", mv=2, identity=None, **extra):
    return {
        "name": name,
        "oracle_text": text,
        "type_line": types,
        "cmc": mv,
        "color_identity": identity or [],
        "colors": identity or [],
        "mana_cost": "{2}",
        "keywords": [],
        "legalities": {"commander": "legal"},
        "prices": {},
        "card_faces": [],
        "reserved": False,
        **extra,
    }


@pytest.fixture
def database(tmp_path):
    return Store(tmp_path / "test.sqlite3")


@pytest.fixture
def client(database):
    fixtures = [
        card("Test Commander", "Flying", "Legendary Creature — Elf", 4, ["W", "U", "B", "R", "G"]),
        card("Sol Ring", "{T}: Add {C}{C}.", mv=1),
        card("Arcane Signet", "{T}: Add one mana of any color in your commander’s color identity."),
        card(
            "Blood Artist",
            "Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.",
            "Creature — Vampire",
        ),
        card("Viscera Seer", "Sacrifice a creature: Scry 1.", "Creature — Vampire", 1),
        card(
            "Reanimate",
            "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value.",
            "Sorcery",
            1,
            ["B"],
        ),
        card(
            "Eternal Witness",
            "When Eternal Witness enters, return target card from your graveyard to your hand.",
            "Creature — Human Shaman",
            3,
            ["G"],
        ),
        card(
            "Stitcher's Supplier",
            "When Stitcher's Supplier enters or dies, mill three cards.",
            "Creature — Zombie",
            1,
            ["B"],
        ),
        card("Animate Dead", "Enchant creature card in a graveyard.", "Enchantment — Aura", 2, ["B"]),
        card(
            "Living Death",
            "Each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield.",
            "Sorcery",
            5,
            ["B"],
        ),
        card(
            "Soul-Guide Lantern",
            "When Soul-Guide Lantern enters, exile target card from a graveyard. {T}, Sacrifice Soul-Guide Lantern: Exile each opponent’s graveyard. {1}, {T}, Sacrifice Soul-Guide Lantern: Draw a card.",
            mv=1,
        ),
        card(
            "Bojuka Bog",
            "Bojuka Bog enters tapped. When Bojuka Bog enters, exile target player’s graveyard. {T}: Add {B}.",
            "Land",
            0,
            ["B"],
        ),
        card(
            "Scavenger Grounds",
            "{T}: Add {C}. {2}, {T}, Sacrifice a Desert: Exile all cards from all graveyards.",
            "Land",
            0,
        ),
        card(
            "Scavenging Ooze",
            "{G}: Exile target card from a graveyard. If it was a creature card, put a +1/+1 counter on Scavenging Ooze and you gain 1 life.",
            "Creature — Ooze",
            2,
            ["G"],
        ),
        card(
            "Swords to Plowshares",
            "Exile target creature. Its controller gains life equal to its power.",
            "Instant",
            1,
            ["W"],
        ),
        card(
            "Beast Within",
            "Destroy target permanent. Its controller creates a 3/3 green Beast creature token.",
            "Instant",
            3,
            ["G"],
        ),
        card(
            "Generous Gift",
            "Destroy target permanent. Its controller creates a 3/3 white Elephant creature token.",
            "Instant",
            3,
            ["W"],
        ),
        card("Counterspell", "Counter target spell.", "Instant", 2, ["U"]),
        card("Forest", "{T}: Add {G}.", "Basic Land — Forest", 0, ["G"]),
        card("Mystic Engine", "Whenever you cast an enchantment spell, draw a card.", "Enchantment", 3, ["G"]),
        card("Vanilla Giant", "", "Creature — Giant", 6, ["G"]),
    ]
    for value in fixtures:
        database.cache(value["name"], value)
    return ScryfallClient(database)
