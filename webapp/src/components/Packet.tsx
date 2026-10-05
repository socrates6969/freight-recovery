import type { EvidencePacket } from "../types";

/** All API-returned strings are rendered as React text nodes (auto-escaped); never as HTML. */
export function Packet({ packet }: { packet: EvidencePacket }) {
  const r = packet.result;
  return (
    <div className="packet">
      <p className="draft" role="note">
        DRAFT - DO NOT SEND. Generated {packet.generated_at}. Human review required.
      </p>
      <h3>
        Load {packet.load_number ?? "(unknown)"} - {packet.perspective} view
      </h3>
      <dl className="totals">
        <dt>Confirmed recoverable</dt>
        <dd>${r.recoverable_total}</dd>
        <dt>Pending human review (NOT claimed)</dt>
        <dd>${r.pending_review_total}</dd>
      </dl>

      <h4>Findings</h4>
      {r.findings.length === 0 && <p>No findings.</p>}
      <ul className="findings">
        {r.findings.map((f, i) => (
          <li key={`${f.rule_id}-${i}`} className={f.needs_human_review ? "review" : "confirmed"}>
            <strong>{f.title}</strong> - ${f.amount}{" "}
            <span className="tag">{f.needs_human_review ? "needs human review" : "confirmed"}</span>{" "}
            <span className="tag">confidence {f.confidence.toFixed(2)}</span>
            <p>{f.explanation}</p>
            {f.calculation.length > 0 && (
              <ol>
                {f.calculation.map((c, j) => (
                  <li key={j}>{c}</li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
      {r.ignored_findings.length > 0 && (
        <p className="hint">
          {r.ignored_findings.length} finding(s) belong to the other perspective and are not counted.
        </p>
      )}

      <h4>Source documents (SHA-256)</h4>
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Type</th>
            <th>sha256</th>
          </tr>
        </thead>
        <tbody>
          {packet.documents.map((d) => (
            <tr key={d.sha256 + d.filename}>
              <td>{d.filename}</td>
              <td>{d.doc_type}</td>
              <td>
                <code>{d.sha256}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>DRAFT demand letter</h4>
      <pre>{packet.demand_letter}</pre>
      <h4>Evidence packet (markdown source, shown as text)</h4>
      <pre>{packet.markdown}</pre>
      <p className="hint">{packet.disclaimer}</p>
    </div>
  );
}
