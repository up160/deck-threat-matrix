from backend.app.parser import parse_deck


def test_formats_noise_and_quantities():
    deck = parse_deck("1 Sol Ring (CMM) 396 *F*\nArcane Signet\n\n2x Forest\n# comment\n1 Blood Artist [AVR] 86")
    assert deck.cards == {"Sol Ring": 1, "Arcane Signet": 1, "Forest": 2, "Blood Artist": 1}


def test_commander_section_and_comment_heading():
    deck = parse_deck("// COMMANDER\n1 Test Commander (SET) 1\n\n1 Sol Ring\n1 Forest")
    assert deck.commanders == ["Test Commander"]
    assert deck.cards["Test Commander"] == 1
    assert deck.cards["Forest"] == 1


def test_separate_commander_not_double_counted():
    deck = parse_deck("1 Test Commander\nSol Ring\nSIDEBOARD\nCounterspell", "Test Commander")
    assert sum(deck.cards.values()) == 2
    assert deck.excluded == ["Counterspell"]


def test_cmdr_marker_and_invalid_quantity():
    deck = parse_deck("1 Test Commander *CMDR*\n0 Sol Ring\n999 Forest\n1 Arcane Signet")
    assert deck.commanders == ["Test Commander"]
    assert len(deck.warnings) == 2


def test_partner():
    deck = parse_deck("Sol Ring", "Partner One; Partner Two")
    assert len(deck.commanders) == 2
    assert sum(deck.cards.values()) == 3
