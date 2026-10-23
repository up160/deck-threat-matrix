import type { CardData, CardProvider, CardStore } from "../analysis/model";
export class CardServiceError extends Error {}
export function normalise(raw: Record<string, unknown>): CardData {
  return {
    id: raw.id as string,
    oracle_id: raw.oracle_id as string,
    name: String(raw.name),
    oracle_text: String(raw.oracle_text ?? ""),
    mana_cost: String(raw.mana_cost ?? ""),
    cmc: Number(raw.cmc ?? 0),
    colors: (raw.colors ?? []) as string[],
    color_identity: (raw.color_identity ?? []) as string[],
    type_line: String(raw.type_line ?? ""),
    keywords: (raw.keywords ?? []) as string[],
    legalities: (raw.legalities ?? {}) as CardData["legalities"],
    prices: (raw.prices ?? {}) as CardData["prices"],
    card_faces: (raw.card_faces ?? []) as CardData["card_faces"],
    reserved: raw.reserved as boolean,
    layout: String(raw.layout ?? ""),
    scryfall_uri: String(raw.scryfall_uri ?? ""),
    game_changer: raw.game_changer as boolean,
  };
}
export const nameKey = (name: string) =>
  name.toLowerCase().replaceAll("’", "'").replaceAll("æ", "ae").trim();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export class ScryfallClient implements CardProvider {
  private cooldownUntil = 0;
  private lastRequest = 0;
  constructor(
    public store: CardStore,
    private fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}
  private async request(
    method: string,
    endpoint: string,
    body?: unknown,
  ): Promise<Response> {
    if (Date.now() < this.cooldownUntil)
      throw new CardServiceError(
        "Scryfall rate limit cooldown is active. Try again later; cached cards still work.",
      );
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(Math.max(0, 200 - (Date.now() - this.lastRequest)));
      this.lastRequest = Date.now();
      let response: Response;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        response = await this.fetcher("https://api.scryfall.com" + endpoint, {
          method,
          headers: {
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
      } catch (error) {
        const detail=error instanceof Error ? error.message : String(error);
        throw new CardServiceError(`Scryfall could not be reached (${detail}); cached cards still work.`);
      } finally {
        clearTimeout(timeout);
      }
      if (response.status === 429) {
        const header = response.headers.get("Retry-After");
        const seconds =
          header && Number.isFinite(Number(header))
            ? Number(header)
            : header
              ? Math.max(0, (Date.parse(header) - Date.now()) / 1000)
              : 60;
        const delay = Math.max(30, Number.isFinite(seconds) ? seconds : 60);
        this.cooldownUntil = Date.now() + delay * 1000;
        throw new CardServiceError(
          `Scryfall rate limited this lookup. Wait at least ${Math.ceil(delay)} seconds before retrying; cached cards still work.`,
        );
      }
      if (response.status < 500) return response;
      await sleep((1 + attempt) * 1000);
    }
    throw new CardServiceError(
      "Scryfall is temporarily unavailable; this is not an unknown-card result.",
    );
  }
  async prefetch(names: string[]): Promise<void> {
    const missing: string[] = [];
    for (const name of new Set(names))
      if (!(await this.store.cached(name)).hit) missing.push(name);
    for (let offset = 0; offset < missing.length; offset += 75) {
      const batch = missing.slice(offset, offset + 75);
      const response = await this.request("POST", "/cards/collection", {
        identifiers: batch.map((name) => ({ name })),
      });
      if (response.status !== 200)
        throw new CardServiceError(
          `Scryfall collection lookup returned HTTP ${response.status}; cached cards still work.`,
        );
      let data: { data?: Record<string, unknown>[] };
      try {
        data = await response.json();
      } catch {
        throw new CardServiceError(
          "Scryfall returned unreadable data; cached cards still work.",
        );
      }
      for (const raw of data.data || []) {
        const card = normalise(raw);
        await this.store.cache(card.name, card);
        const aliases = [card.name, ...card.card_faces.map((f) => f.name)].map(
          nameKey,
        );
        for (const name of batch)
          if (aliases.includes(nameKey(name)))
            await this.store.cache(name, card);
      }
    }
  }
  async resolve(name: string): Promise<[CardData | null, string]> {
    const cached = await this.store.cached(name);
    if (cached.hit) {
      const card = cached.card;
      const renamed =
        card &&
        nameKey(card.name) !== nameKey(name) &&
        !card.card_faces.some((f) => nameKey(f.name) === nameKey(name));
      return [card, renamed ? "cached normalisation" : "cache"];
    }
    for (const mode of ["exact", "fuzzy"]) {
      const response = await this.request(
        "GET",
        "/cards/named?" + new URLSearchParams({ [mode]: name }),
      );
      if (response.status === 404) continue;
      if (response.status !== 200)
        throw new CardServiceError(
          `Scryfall returned HTTP ${response.status}; this is not an unknown-card result.`,
        );
      let card: CardData;
      try {
        card = normalise(await response.json());
      } catch {
        throw new CardServiceError(
          "Scryfall returned unreadable data; cached cards still work.",
        );
      }
      await this.store.cache(name, card);
      await this.store.cache(card.name, card);
      return [card, mode];
    }
    await this.store.cache(name, null);
    return [null, "unmatched or ambiguous"];
  }
}
