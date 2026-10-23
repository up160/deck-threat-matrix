import { it, expect, vi } from "vitest";
import { ScryfallClient } from "../src/services/scryfall";
import type { CardStore, CardData } from "../src/analysis/model";
import fixture from "./parity.json";
function cache(): CardStore {
  const values = new Map<string, CardData | null>();
  return {
    cached: async (name) => ({
      hit: values.has(name),
      card: values.get(name) ?? null,
    }),
    cache: async (name, value) => {
      values.set(name, value);
    },
  };
}
it("batches lookups and never transmits deck metadata or credentials", async () => {
  const store = cache(),
    fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [fixture.cards[0]] }), {
          status: 200,
        }),
    );
  const client = new ScryfallClient(store, fetcher);
  await client.prefetch([fixture.cards[0].name]);
  expect((await client.resolve(fixture.cards[0].name))[0]?.name).toBe(
    fixture.cards[0].name,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, request] = fetcher.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("https://api.scryfall.com/cards/collection");
  expect(JSON.parse(request.body as string)).toEqual({
    identifiers: [{ name: fixture.cards[0].name }],
  });
  expect(request.credentials).toBe("omit");
  expect(request.referrerPolicy).toBe("no-referrer");
});
it("falls back exact to fuzzy and caches the alias", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response("{}", { status: 404 }))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify(fixture.cards.find((c) => c.name === "Sol Ring")),
        { status: 200 },
      ),
    );
  const client = new ScryfallClient(cache(), fetcher);
  expect((await client.resolve("Sole Ring"))[1]).toBe("fuzzy");
  expect((await client.resolve("Sole Ring"))[0]?.name).toBe("Sol Ring");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("does not cache outages as missing cards", async () => {
  const store = cache(),
    client = new ScryfallClient(
      store,
      vi.fn().mockRejectedValue(new Error("offline")),
    );
  await expect(client.resolve("Sol Ring")).rejects.toThrow(
    "could not be reached",
  );
  expect((await store.cached("Sol Ring")).hit).toBe(false);
});
it("honours rate limit cooldown without retry storms", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response("{}", { status: 429, headers: { "Retry-After": "120" } }),
    );
  const client = new ScryfallClient(cache(), fetcher);
  await expect(client.resolve("Sol Ring")).rejects.toThrow("120");
  await expect(client.resolve("Sol Ring")).rejects.toThrow("cooldown");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('uses positive cached data without any network while offline',async()=>{
 const store=cache();await store.cache(fixture.cards[0].name,fixture.cards[0] as CardData);
 const fetcher=vi.fn().mockRejectedValue(new Error('offline'));const client=new ScryfallClient(store,fetcher);
 await client.prefetch([fixture.cards[0].name]);expect((await client.resolve(fixture.cards[0].name))[0]?.name).toBe(fixture.cards[0].name);expect(fetcher).not.toHaveBeenCalled();
});
