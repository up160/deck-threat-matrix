import { BrowserStore } from "./storage";
import { validateDeck } from "./backup";
import { profiles } from "../analysis/matchup";
const store = new BrowserStore();
let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();
function analyse(input: unknown, all: boolean): Promise<unknown> {
  if (!worker) {
    worker = new Worker(new URL("./analysisWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event) => {
      const { id, result, error } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (error) entry.reject(new Error(error));
      else entry.resolve(result);
    };
    worker.onerror = () => {
      for (const entry of pending.values())
        entry.reject(
          new Error(
            "Analysis worker could not run. Reload the page and try again.",
          ),
        );
      pending.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, input, all });
  });
}
// Preserve the existing UI's service contract while removing all HTTP /api calls.
export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const verb = method || (body ? "POST" : "GET");
  let result: unknown;
  if (path === "/config") result = profiles;
  else if (path === "/decks" && verb === "GET") result = await store.decks();
  else if (path === "/decks" && verb === "POST") {
    const deck = validateDeck(body);
    delete deck.id;
    result = await store.save(deck);
  } else if (/^\/decks\/\d+$/.test(path)) {
    const id = Number(path.split("/").pop());
    if (!(await store.decks()).some((d) => d.id === id))
      throw new Error("Deck not found");
    if (verb === "DELETE") {
      await store.delete(id);
      result = { deleted: id };
    } else if (verb === "PUT")
      result = await store.save({ ...validateDeck(body), id });
    else throw new Error("Unsupported library operation.");
  } else if (path === "/analyse" || path === "/analyse-all")
    result = await analyse(body, path === "/analyse-all");
  else throw new Error("Unknown local application operation.");
  return result as T;
}
