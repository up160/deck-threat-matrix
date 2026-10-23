"""Tolerant text import. Preserve ambiguous names for explicit resolution."""

import re
from dataclasses import dataclass, field


@dataclass
class ParsedDeck:
    cards: dict[str, int] = field(default_factory=dict)
    commanders: list[str] = field(default_factory=list)
    excluded: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def clean_line(line: str) -> tuple[str, int]:
    line = line.strip().lstrip("\ufeff")
    match = re.match(r"^(\d+)\s*x?\s+(.+)$", line, re.IGNORECASE)
    quantity = int(match[1]) if match else 1
    name = match[2] if match else line
    name = re.sub(r"\s+(?:\([A-Za-z0-9]{2,8}\)|\[[A-Za-z0-9]{2,8}\])(?:\s+[A-Za-z0-9★-]+)?(?:\s+.*)?$", "", name)
    name = re.sub(r"\s+(?:\*[^*]*\*|#.*|!.*|\[foil\]|\(foil\))\s*$", "", name, flags=re.IGNORECASE)
    return name.strip(), quantity


def parse_deck(text: str, commander: str = "") -> ParsedDeck:
    result = ParsedDeck()
    section = "main"
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            if section == "commander" and result.commanders:
                section = "main"
            continue
        heading = re.sub(r"[\[\]#:/]", "", line).strip().lower()
        if re.fullmatch(
            r"(commander|commanders|deck|mainboard|main deck|sideboard|maybeboard|considering|companion)(?:\s*\(\d+\))?",
            heading,
        ):
            section = (
                "commander"
                if heading.startswith("commander")
                else ("main" if heading.startswith(("deck", "main")) else "excluded")
            )
            continue
        if line.startswith(("#", "//")):
            continue
        if section == "excluded" or line.upper().startswith("SB:"):
            result.excluded.append(line)
            continue
        marked = bool(re.search(r"\s+\*CMDR\*", line, re.IGNORECASE))
        name, quantity = clean_line(line)
        if not name or quantity < 1 or quantity > 250:
            result.warnings.append(f"Ignored invalid entry: {line}")
            continue
        if section == "commander" or marked:
            if name not in result.commanders:
                result.commanders.append(name)
            quantity = 1
        result.cards[name] = result.cards.get(name, 0) + quantity
    if commander.strip():
        result.commanders = [x.strip() for x in commander.split(";") if x.strip()]
    for name in result.commanders:
        existing = next((n for n in result.cards if n.casefold() == name.casefold()), None)
        if existing is None:
            result.cards[name] = 1
        else:
            result.cards[existing] = 1
    return result
