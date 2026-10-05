import { useState, useSyncExternalStore } from "react";
import { api, ApiError } from "../api";
import { keystore, looksLikeKey } from "../keystore";

export function KeyPanel() {
  const has = useSyncExternalStore(keystore.subscribe, keystore.has);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    keystore.set(draft);
    setDraft(""); // the input never retains the key after submit
    try {
      await api.list(1, 0);
      setStatus("Key accepted by the API.");
    } catch (e) {
      keystore.clear();
      setStatus(e instanceof ApiError ? e.message : "Check failed.");
    }
  }

  return (
    <section aria-labelledby="key-h">
      <h2 id="key-h">API key</h2>
      <p className="warn" role="alert">
        The key is held in memory for this tab only. It is never written to localStorage, cookies or
        the URL, and is forgotten on reload or when you press Forget. Use a key for a
        synthetic-data tenant only.
      </p>
      <p>
        Keys look like <code>frk_&lt;8 hex&gt;_&lt;secret&gt;</code>. An operator issues one with{" "}
        <code>python -m freight_recovery.admin issue-key</code>; it is printed{" "}
        <strong>once</strong> and cannot be recovered, only replaced. This UI cannot create keys.
      </p>
      {has ? (
        <p>
          A key is loaded.{" "}
          <button
            onClick={() => {
              keystore.clear();
              setStatus("Key forgotten.");
            }}
          >
            Forget key
          </button>
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label htmlFor="key">API key</label>
          <input
            id="key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {draft && !looksLikeKey(draft) && (
            <p className="hint">That does not look like a frk_ key; the server decides.</p>
          )}
          <button type="submit" disabled={!draft.trim()}>
            Use key
          </button>
        </form>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
