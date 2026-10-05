import { useState } from "react";
import { api, ApiError } from "../api";
import type { AnalysisResponse, Perspective } from "../types";
import { Packet } from "./Packet";

export function Analyze() {
  const [files, setFiles] = useState<File[]>([]);
  const [perspective, setPerspective] = useState<Perspective>("shipper");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResponse | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.analyze(files, perspective));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Unexpected error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="an-h">
      <h2 id="an-h">Upload and analyze</h2>
      <p>
        One load per run: rate confirmation, BOL/gate record and invoice (PDF, CSV or TXT; up to 10
        files, 10 MB each). Synthetic samples only.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label htmlFor="files">Documents</label>
        <input
          id="files"
          type="file"
          multiple
          accept=".pdf,.csv,.txt"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
        <label htmlFor="persp">Perspective</label>
        <select
          id="persp"
          value={perspective}
          onChange={(e) => setPerspective(e.target.value as Perspective)}
        >
          <option value="shipper">Shipper (unauthorized / unsupported charges)</option>
          <option value="carrier">Carrier (unbilled / under-billed detention)</option>
        </select>
        <button type="submit" disabled={busy || files.length === 0}>
          {busy ? "Analyzing..." : "Run analysis"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          {result.analysis_id && (
            <p className="hint">
              Saved as analysis <code>{result.analysis_id}</code>.
            </p>
          )}
          <Packet packet={result.packet} />
        </>
      )}
    </section>
  );
}
