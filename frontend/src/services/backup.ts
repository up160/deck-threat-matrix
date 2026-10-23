import type { Deck } from "../types";
export type LibraryBackup = {
  format: "deck-threat-matrix-library";
  version: 1;
  exported_at: string;
  decks: Deck[];
};
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function validateDeck(value: unknown): Deck {
  if (!record(value)) throw new Error("Each deck must be an object.");
  const limits: Record<string, number> = {
    name: 200,
    text: 60000,
    commander: 300,
    owner: 200,
    notes: 10000,
  };
  for (const [field, limit] of Object.entries(limits))
    if (typeof value[field] !== "string" || value[field].length > limit)
      throw new Error(
        `Invalid ${field}; expected text up to ${limit} characters.`,
      );
  if (!(value.name as string).trim() || !(value.text as string).trim())
    throw new Error("Each saved deck needs a name and a list.");
  if (
    !["B2", "B3"].includes(String(value.bracket)) ||
    typeof value.include_in_comparisons !== "boolean"
  )
    throw new Error("Invalid deck bracket or comparison flag.");
  if (
    value.id !== undefined &&
    (!Number.isSafeInteger(value.id) || (value.id as number) <= 0)
  )
    throw new Error("Invalid deck identifier.");
  if (
    value.updated !== undefined &&
    (typeof value.updated !== "string" ||
      !Number.isFinite(Date.parse(value.updated)))
  )
    throw new Error("Invalid updated date.");
  return {
    name: value.name as string,
    text: value.text as string,
    commander: value.commander as string,
    owner: value.owner as string,
    notes: value.notes as string,
    bracket: value.bracket as Deck["bracket"],
    include_in_comparisons: value.include_in_comparisons,
    ...(value.id !== undefined ? { id: value.id as number } : {}),
    ...(value.updated ? { updated: value.updated as string } : {}),
  };
}
export function makeBackup(decks: Deck[]): LibraryBackup {
  return {
    format: "deck-threat-matrix-library",
    version: 1,
    exported_at: new Date().toISOString(),
    decks: decks.map(validateDeck),
  };
}
export function parseBackup(text: string): LibraryBackup {
  if (text.length > 20_000_000)
    throw new Error("Backup is too large (20 MB limit).");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This is not a valid JSON backup.");
  }
  if (
    !record(value) ||
    value.format !== "deck-threat-matrix-library" ||
    value.version !== 1 ||
    !Array.isArray(value.decks) ||
    value.decks.length > 1000 ||
    typeof value.exported_at !== "string" ||
    !Number.isFinite(Date.parse(value.exported_at))
  )
    throw new Error(
      "Unsupported library backup. Choose a version 1 library export, not a report JSON.",
    );
  const decks = value.decks.map(validateDeck);
  const ids = decks.flatMap((d) => (d.id === undefined ? [] : [d.id]));
  if (new Set(ids).size !== ids.length)
    throw new Error("Backup contains duplicate deck identifiers.");
  return {
    format: "deck-threat-matrix-library",
    version: 1,
    exported_at: value.exported_at,
    decks,
  };
}
