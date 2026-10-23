import { it, expect } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { BrowserStore } from "../src/services/storage";
import { makeBackup, parseBackup, validateDeck } from "../src/services/backup";
import type { Deck } from "../src/types";
const deck: Deck = {
  name: "Answers",
  text: "Sol Ring",
  commander: "Kenrith, the Returned King",
  owner: "Me",
  notes: "Private",
  bracket: "B2",
  include_in_comparisons: true,
};
it("persists CRUD across connections and tracks unexported revisions", async () => {
  const factory = new IDBFactory(),
    first = new BrowserStore(factory, "crud"),
    saved = await first.save(deck),
    second = new BrowserStore(factory, "crud");
  expect(await second.decks()).toEqual([saved]);
  expect((await second.state()).revision).toBe(1);
  const snapshot = await second.snapshot();
  await second.markExported(snapshot.state.revision);
  expect((await first.state()).backedUpRevision).toBe(1);
  await first.save({ ...saved, notes: "Changed" });
  expect((await second.state()).revision).toBe(2);
  await second.delete(saved.id!);
  expect(await first.decks()).toEqual([]);
});
it("round-trips entire library backups and replaces atomically", async () => {
  const factory = new IDBFactory(),
    source = new BrowserStore(factory, "source"),
    target = new BrowserStore(factory, "target");
  await source.save(deck);
  await source.save({ ...deck, name: "Other", include_in_comparisons: false });
  await target.save({ ...deck, name: "Discarded" });
  const backup = parseBackup(JSON.stringify(makeBackup(await source.decks())));
  await target.replace(backup.decks);
  expect((await target.decks()).map((d) => d.name).sort()).toEqual([
    "Answers",
    "Other",
  ]);
  expect((await target.state()).revision).toBeGreaterThan(
    (await target.state()).backedUpRevision,
  );
});
it("rejects reports, corrupt formats, duplicate IDs and invalid fields before import", () => {
  expect(() => parseBackup("{}")).toThrow("Unsupported");
  expect(() => parseBackup("no")).toThrow("valid JSON");
  const backup = makeBackup([
    { ...deck, id: 1 },
    { ...deck, id: 1 },
  ]);
  expect(() => parseBackup(JSON.stringify(backup))).toThrow("duplicate");
  expect(() => validateDeck({ ...deck, text: "" })).toThrow();
  expect(() =>
    validateDeck({ ...deck, include_in_comparisons: "yes" }),
  ).toThrow();
});
it("retains positive cache offline and expires negative misses", async () => {
  const store = new BrowserStore(new IDBFactory(), "cache");
  await store.cache("Unknown", null);
  expect(await store.cached("unknown")).toEqual({ hit: true, card: null });
  expect(await store.cached("Other")).toEqual({ hit: false, card: null });
});
it("surfaces unavailable storage rather than pretending a save succeeded", async () => {
  const store = new BrowserStore(undefined, "unsupported");
  await expect(store.save(deck)).rejects.toThrow("storage");
});

it("does not overwrite decks when imported records omit some IDs", async () => {
  const store = new BrowserStore(new IDBFactory(), "mixed");
  await store.replace([{ ...deck }, { ...deck, id: 1, name: "Explicit" }]);
  expect(await store.decks()).toHaveLength(2);
});
