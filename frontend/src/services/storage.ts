import type { Deck } from "../types";
import type { CardData, CardStore } from "../analysis/model";
const DB_NAME = "deck-threat-matrix";
export type LibraryState = {
  revision: number;
  backedUpRevision: number;
  lastExport: string | null;
};
const emptyState: LibraryState = {
  revision: 0,
  backedUpRevision: 0,
  lastExport: null,
};
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error || new Error("Storage transaction was cancelled."));
    tx.onerror = () => reject(tx.error);
  });
}
export class BrowserStore implements CardStore {
  private connection?: Promise<IDBDatabase>;
  constructor(
    private factory: IDBFactory = globalThis.indexedDB,
    private name = DB_NAME,
  ) {}
  private db(): Promise<IDBDatabase> {
    if (!this.factory)
      return Promise.reject(
        new Error(
          "Browser storage is unavailable. Use a normal Safari tab and allow website storage.",
        ),
      );
    if (!this.connection)
      this.connection = new Promise((resolve, reject) => {
        const req = this.factory.open(this.name, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore("decks", { keyPath: "id", autoIncrement: true });
          db.createObjectStore("cards", { keyPath: "query" });
          db.createObjectStore("meta");
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => {
            db.close();
            this.connection = undefined;
          };
          resolve(db);
        };
        req.onerror = () => {
          this.connection = undefined;
          reject(
            new Error("Could not open local storage: " + req.error?.message),
          );
        };
        req.onblocked = () => {
          this.connection = undefined;
          reject(
            new Error("Close other Deck Threat Matrix tabs and try again."),
          );
        };
      });
    return this.connection;
  }
  async decks(): Promise<Deck[]> {
    const db = await this.db();
    return (
      (await request(
        db.transaction("decks").objectStore("decks").getAll(),
      )) as Deck[]
    ).sort((a, b) => (b.id || 0) - (a.id || 0));
  }
  async state(): Promise<LibraryState> {
    const db = await this.db();
    return (
      ((await request(
        db.transaction("meta").objectStore("meta").get("library"),
      )) as LibraryState | undefined) ?? { ...emptyState }
    );
  }
  private bump(tx: IDBTransaction) {
    const store = tx.objectStore("meta");
    const req = store.get("library");
    req.onsuccess = () => {
      const state = (req.result as LibraryState | undefined) ?? emptyState;
      store.put({ ...state, revision: state.revision + 1 }, "library");
    };
  }
  async save(deck: Deck): Promise<Deck> {
    const db = await this.db();
    const tx = db.transaction(["decks", "meta"], "readwrite");
    const done = complete(tx);
    const payload = { ...deck, updated: new Date().toISOString() };
    if (payload.id === undefined) delete payload.id;
    const req = tx.objectStore("decks").put(payload);
    this.bump(tx);
    const [id] = await Promise.all([request(req), done]);
    return { ...payload, id: Number(id) };
  }
  async delete(id: number): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(["decks", "meta"], "readwrite");
    const done = complete(tx);
    tx.objectStore("decks").delete(id);
    this.bump(tx);
    await done;
  }
  async snapshot(): Promise<{ decks: Deck[]; state: LibraryState }> {
    const db = await this.db();
    const tx = db.transaction(["decks", "meta"]);
    const [decks, state] = await Promise.all([
      request(tx.objectStore("decks").getAll()),
      request(tx.objectStore("meta").get("library")),
    ]);
    return { decks: decks as Deck[], state: state ?? { ...emptyState } };
  }
  async markExported(revision: number): Promise<void> {
    const db = await this.db();
    const tx = db.transaction("meta", "readwrite");
    const done = complete(tx);
    const meta = tx.objectStore("meta");
    const req = meta.get("library");
    req.onsuccess = () => {
      const state = (req.result as LibraryState | undefined) ?? emptyState;
      meta.put(
        {
          ...state,
          backedUpRevision: revision,
          lastExport: new Date().toISOString(),
        },
        "library",
      );
    };
    await done;
  }
  async replace(decks: Deck[]): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(["decks", "meta"], "readwrite");
    const done = complete(tx);
    const store = tx.objectStore("decks");
    try {
      store.clear();
      let nextId = Math.max(0, ...decks.map((d) => d.id || 0)) + 1;
      for (const deck of decks) store.put({ ...deck, id: deck.id ?? nextId++ });
      this.bump(tx);
    } catch (error) {
      tx.abort();
      await done.catch(() => undefined);
      throw error;
    }
    await done;
  }
  async cached(name: string): Promise<{ hit: boolean; card: CardData | null }> {
    const db = await this.db();
    const row = await request(
      db.transaction("cards").objectStore("cards").get(name.toLowerCase()),
    );
    return row && (row.payload !== null || Date.now() - row.fetched < 3600000)
      ? { hit: true, card: row.payload }
      : { hit: false, card: null };
  }
  async cache(name: string, card: CardData | null): Promise<void> {
    const db = await this.db();
    const tx = db.transaction("cards", "readwrite");
    const done = complete(tx);
    tx.objectStore("cards").put({
      query: name.toLowerCase(),
      payload: card,
      fetched: Date.now(),
    });
    await done;
  }
}
