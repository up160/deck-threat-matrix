export type ParsedDeck = {
  cards: Map<string, number>;
  commanders: string[];
  excluded: string[];
  warnings: string[];
};
export function cleanLine(line: string): [string, number] {
  const match = line
    .trim()
    .replace(/^\uFEFF/, "")
    .match(/^(\d+)\s*x?\s+(.+)$/i);
  const quantity = match ? Number(match[1]) : 1;
  const name = (match ? match[2] : line.trim())
    .replace(
      /\s+(?:\([A-Za-z0-9]{2,8}\)|\[[A-Za-z0-9]{2,8}\])(?:\s+[A-Za-z0-9★-]+)?(?:\s+.*)?$/,
      "",
    )
    .replace(/\s+(?:\*[^*]*\*|#.*|!.*|\[foil\]|\(foil\))\s*$/i, "")
    .trim();
  return [name, quantity];
}
export function parseDeck(text: string, commander = ""): ParsedDeck {
  const result: ParsedDeck = {
    cards: new Map(),
    commanders: [],
    excluded: [],
    warnings: [],
  };
  let section = "main";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      if (section === "commander" && result.commanders.length) section = "main";
      continue;
    }
    const heading = line
      .replace(/[[\]#:/]/g, "")
      .trim()
      .toLowerCase();
    if (
      /^(commander|commanders|deck|mainboard|main deck|sideboard|maybeboard|considering|companion)(?:\s*\(\d+\))?$/.test(
        heading,
      )
    ) {
      section = heading.startsWith("commander")
        ? "commander"
        : /^(deck|main)/.test(heading)
          ? "main"
          : "excluded";
      continue;
    }
    if (line.startsWith("#") || line.startsWith("//")) continue;
    if (section === "excluded" || line.toUpperCase().startsWith("SB:")) {
      result.excluded.push(line);
      continue;
    }
    const marked = /\s+\*CMDR\*/i.test(line);
    const [name, initialQuantity] = cleanLine(line);
    let quantity = initialQuantity;
    if (!name || quantity < 1 || quantity > 250) {
      result.warnings.push("Ignored invalid entry: " + line);
      continue;
    }
    if (section === "commander" || marked) {
      if (!result.commanders.includes(name)) result.commanders.push(name);
      quantity = 1;
    }
    result.cards.set(name, (result.cards.get(name) || 0) + quantity);
  }
  if (commander.trim())
    result.commanders = commander
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
  for (const name of result.commanders) {
    const existing = [...result.cards.keys()].find(
      (n) => n.toLowerCase() === name.toLowerCase(),
    );
    result.cards.set(existing ?? name, 1);
  }
  return result;
}
