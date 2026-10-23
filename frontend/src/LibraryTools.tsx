import { useEffect, useState } from "react";
import { BrowserStore, type LibraryState } from "./services/storage";
import { makeBackup, parseBackup, type LibraryBackup } from "./services/backup";
const store = new BrowserStore();
export function LibraryTools({
  busy,
  onError,
  onChanged,
}: {
  busy: boolean;
  onError: (s: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [state, setState] = useState<LibraryState | null>(null),
    [persistent, setPersistent] = useState("Checking…"),
    [preview, setPreview] = useState<LibraryBackup | null>(null),
    [working, setWorking] = useState(false);
  const refresh = () =>
    store
      .state()
      .then(setState)
      .catch((e) => onError(String(e)));
  useEffect(() => {
    const update = () =>
      store
        .state()
        .then(setState)
        .catch((e) => onError(String(e)));
    void update();
    const timer = setInterval(() => void update(), 2000);
    return () => clearInterval(timer);
  }, [onError]);
  useEffect(() => {
    if (!navigator.storage?.persisted) {
      setPersistent("Not supported by this browser");
      return;
    }
    void navigator.storage
      .persisted()
      .then((value) =>
        setPersistent(value ? "Granted" : "Not granted — export backups"),
      )
      .catch(() => setPersistent("Unavailable — export backups"));
  }, []);
  async function exportLibrary() {
    try {
      setWorking(true);
      const snapshot = await store.snapshot();
      const blob = new Blob(
        [JSON.stringify(makeBackup(snapshot.decks), null, 2)],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "deck-threat-matrix-library.json";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      await store.markExported(snapshot.state.revision);
      await refresh();
    } catch (e) {
      onError(String(e));
    } finally {
      setWorking(false);
    }
  }
  async function persist() {
    try {
      setPersistent(
        (await navigator.storage.persist())
          ? "Granted"
          : "Not granted — export backups",
      );
    } catch (e) {
      onError(String(e));
    }
  }
  async function restore() {
    if (!preview) return;
    try {
      setWorking(true);
      await store.replace(preview.decks);
      setPreview(null);
      await onChanged();
      await refresh();
    } catch (e) {
      onError(String(e));
    } finally {
      setWorking(false);
    }
  }
  return (
    <section className="library-tools" aria-label="Library backups and privacy">
      <div>
        <strong>Your library stays on this device.</strong>
        <small>
          No automatic sync. Transfer a library file through Files or iCloud
          Drive.
        </small>
      </div>
      <div className="library-actions">
        <button
          className="secondary"
          disabled={busy || working}
          onClick={() => void exportLibrary()}
        >
          Export library
        </button>
        <label className="button secondary upload">
          Import library
          <input
            aria-label="Import library backup"
            type="file"
            accept=".json,application/json"
            disabled={busy || working}
            onChange={async (e) => {
              const input = e.currentTarget;
              try {
                const file = input.files?.[0];
                if (file) {
                  if (file.size > 20_000_000)
                    throw new Error("Backup is too large (20 MB limit).");
                  setPreview(parseBackup(await file.text()));
                }
              } catch (error) {
                onError(String(error));
              }
              input.value = "";
            }}
          />
        </label>
      </div>
      <p role="status">
        {state && state.revision > state.backedUpRevision
          ? "Changes since last export — make a backup."
          : state?.lastExport
            ? "Export requested " +
              new Date(state.lastExport).toLocaleString("en-GB") +
              ". Check the file was saved."
            : "No library backup exported yet."}{" "}
        Persistent storage: {persistent}.{" "}
        {typeof navigator.storage?.persist === "function" &&
          persistent !== "Granted" && (
            <button className="text-button" onClick={() => void persist()}>
              Request persistence
            </button>
          )}
      </p>
      <small>
        Clearing website data removes this library. Installing on your Home
        Screen may help persistence; keep an exported backup.
      </small>
      {preview && (
        <div
          className="notice"
          role="region"
          aria-label="Library import preview"
        >
          <strong>Import {preview.decks.length} deck(s)</strong>
          <p>
            From {new Date(preview.exported_at).toLocaleString("en-GB")}:{" "}
            {preview.decks.map((d) => d.name).join(", ") || "Empty library"}.
          </p>
          <p>
            This replaces this device’s saved library. It does not merge
            libraries or import card cache. Export your current library first if
            you want to keep it.
          </p>
          <button
            className="secondary"
            disabled={busy || working}
            onClick={() => void exportLibrary()}
          >
            Back up current library
          </button>{" "}
          <button
            className="primary"
            disabled={busy || working}
            onClick={() => void restore()}
          >
            Replace library with import
          </button>{" "}
          <button
            className="text-button"
            disabled={working}
            onClick={() => setPreview(null)}
          >
            Cancel import
          </button>
        </div>
      )}
    </section>
  );
}
