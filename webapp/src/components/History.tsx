import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { AnalysisRecord, AnalysisSummary } from "../types";
import { Packet } from "./Packet";

export function History() {
  const [items, setItems] = useState<AnalysisSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AnalysisRecord | null>(null);

  useEffect(() => {
    api
      .list()
      .then((l) => setItems(l.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed."));
  }, []);

  async function show(id: string) {
    setError(null);
    try {
      setOpen(await api.get(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed.");
    }
  }

  return (
    <section aria-labelledby="hi-h">
      <h2 id="hi-h">Past analyses</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {items && items.length === 0 && <p>None yet.</p>}
      {items && items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Load</th>
              <th>Status</th>
              <th>Confirmed</th>
              <th>Pending review</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td>{a.created_at}</td>
                <td>{a.load_number ?? "-"}</td>
                <td>
                  {a.status}
                  {a.error_code ? ` (${a.error_code})` : ""}
                </td>
                <td>{a.recoverable_total ?? "-"}</td>
                <td>{a.pending_review_total ?? "-"}</td>
                <td>
                  <button onClick={() => void show(a.id)}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open?.packet && <Packet packet={open.packet} />}
      {open && !open.packet && <p>This analysis has no packet (status: {open.status}).</p>}
    </section>
  );
}
