import { it, expect, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { BrowserStore } from "../src/services/storage";
import type { Deck } from "../src/types";
const deck: Deck = {
  name: "Original",
  text: "Sol Ring",
  commander: "",
  owner: "",
  notes: "Keep me",
  bracket: "B2",
  include_in_comparisons: false,
};
it("keeps the previous library if an import encounters a quota error", async () => {
  const store = new BrowserStore(new IDBFactory(), "quota");
  await store.save(deck);
  const original = IDBObjectStore.prototype.put;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === "decks")
        throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, value, key);
    });
  await expect(
    store.replace([{ ...deck, name: "Replacement" }]),
  ).rejects.toThrow("Full");
  spy.mockRestore();
  expect((await store.decks())[0].name).toBe("Original");
});
it("expires negative cache entries without discarding positive offline data", async () => {
  const store = new BrowserStore(new IDBFactory(), "expiry");
  await store.cache("missing", null);
  const now = Date.now();
  const spy = vi.spyOn(Date, "now").mockReturnValue(now + 3600001);
  expect((await store.cached("missing")).hit).toBe(false);
  spy.mockRestore();
});
