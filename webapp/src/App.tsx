import { useState, useSyncExternalStore } from "react";
import { API_BASE } from "./api";
import { Analyze } from "./components/Analyze";
import { Banner } from "./components/Banner";
import { History } from "./components/History";
import { KeyPanel } from "./components/KeyPanel";
import { keystore } from "./keystore";

type Tab = "key" | "analyze" | "history";

export function App() {
  const has = useSyncExternalStore(keystore.subscribe, keystore.has);
  const [tab, setTab] = useState<Tab>("key");
  return (
    <main>
      <h1>Freight Recovery - pilot dashboard</h1>
      <Banner />
      <p className="hint">
        API: <code>{API_BASE}</code> | key: {has ? "loaded (memory only)" : "none"}
      </p>
      <nav aria-label="Sections">
        <button aria-pressed={tab === "key"} onClick={() => setTab("key")}>
          API key
        </button>
        <button aria-pressed={tab === "analyze"} onClick={() => setTab("analyze")} disabled={!has}>
          Analyze
        </button>
        <button aria-pressed={tab === "history"} onClick={() => setTab("history")} disabled={!has}>
          History
        </button>
      </nav>
      {tab === "key" && <KeyPanel />}
      {tab === "analyze" && has && <Analyze />}
      {tab === "history" && has && <History />}
    </main>
  );
}
