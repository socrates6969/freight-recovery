import { DD_CHECK_LABELS, DD_CHECK_STATUS_LABELS, DD_PACKET_DISCLAIMER } from '@fr/shared';

import { downloadText, safeFilename } from '../download';
import { confidenceText } from '../freight/packet';
import { Money, SafeText } from '../ui';

import { type DdOutcome } from './model';
import { renderDdPacket } from './packet';

const cents = (v: number | null): string => (v === null ? 'n/a' : `$${(v / 100).toFixed(2)}`);
/** Check reasons are fixed snake_case codes from the shared audit; show them as words. */
export const reasonText = (reason: string | null): string | null => (reason === null ? null : reason.replaceAll('_', ' '));

export function DdResults({ outcome }: { outcome: DdOutcome }) {
  const { result, invoice } = outcome;
  const stem = `scoup-dd-${invoice.invoiceNumber}`;
  return (
    <section className="flex flex-col gap-4" aria-label="Audit results">
      <h2 className="text-xl font-semibold">Audit results</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card">
          <p className="muted m-0 text-sm">Confirmed findings</p>
          <p className="m-0 text-2xl font-semibold"><Money value={result.recoverable} /></p>
          <p className="muted m-0 text-xs">Pre-review estimate from fixed rules.</p>
        </div>
        <div className="card">
          <p className="muted m-0 text-sm">Pending human review (not counted)</p>
          <p className="m-0 text-2xl font-semibold"><Money value={result.pendingReview} /></p>
        </div>
        <div className="card">
          <p className="muted m-0 text-sm">Findings</p>
          <p className="m-0 text-2xl font-semibold">{result.findings.length}</p>
          <p className="muted m-0 text-xs">{result.checks.filter((c) => c.status === 'ok').length} of {result.checks.length} checks passed.</p>
        </div>
      </div>
      <p className="warn">{DD_PACKET_DISCLAIMER}</p>

      <div className="scroll">
        <table aria-label="Checks">
          <caption className="muted py-1 text-left text-sm">Checks</caption>
          <thead>
            <tr><th>Check</th><th>Container</th><th>Status</th><th>Reason</th></tr>
          </thead>
          <tbody>
            {result.checks.map((c, i) => (
              <tr key={i}>
                <td>{DD_CHECK_LABELS[c.id]}</td>
                <td>{c.containerIndex === null ? 'invoice' : `#${c.containerIndex + 1}`}</td>
                <td>{DD_CHECK_STATUS_LABELS[c.status]}</td>
                <td className="text-sm"><SafeText value={reasonText(c.reason)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="scroll">
        <table aria-label="Containers">
          <caption className="muted py-1 text-left text-sm">Containers</caption>
          <thead>
            <tr><th>#</th><th>Container</th><th>Type</th><th>Size</th><th>Charged</th><th>Tariff expected</th><th>Free time end</th><th>Chargeable days</th></tr>
          </thead>
          <tbody>
            {result.containers.map((c) => (
              <tr key={c.index}>
                <td className="num">{c.index + 1}</td>
                <td><SafeText value={c.label} /></td>
                <td>{c.chargeType}</td>
                <td className="mono">{c.sizeType}</td>
                <td className="num">{cents(c.chargedCents)}</td>
                <td className="num">{cents(c.expectedCents)}</td>
                <td>{c.freeTimeEnd ?? 'n/a'}</td>
                <td className="num">{c.chargeableDays ?? 'n/a'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result.findings.length === 0 ? <p className="ok">No findings. The invoice passed every check that could be evaluated with the information entered.</p> : null}
      {result.findings.map((f, i) => (
        <article key={`${f.ruleId}-${i}`} className="card">
          <h3 className="m-0 text-base font-semibold">
            {i + 1}. <SafeText value={f.title} /> - <Money value={f.amount} />
            {f.needsHumanReview ? <span className="muted"> (needs human review)</span> : null}
          </h3>
          <p className="muted mt-1 text-xs">Rule <span className="mono">{f.ruleId}</span>, {confidenceText(f.confidence)}.</p>
          <p className="mt-2 text-sm"><SafeText value={f.explanation} /></p>
          {f.calculation.length > 0 ? (
            <ol className="mt-2 list-decimal pl-5 text-sm">
              {f.calculation.map((step, k) => (
                <li key={k}><SafeText value={step} /></li>
              ))}
            </ol>
          ) : null}
          {f.citations.length > 0 ? (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer">Cited values ({f.citations.length})</summary>
              <ul className="mt-1 list-disc pl-5">
                {f.citations.map((c, k) => (
                  <li key={k}>{c.source} <span className="mono"><SafeText value={c.pointer} /></span>: <SafeText value={c.excerpt} /></li>
                ))}
              </ul>
            </details>
          ) : null}
          {f.clause ? <p className="muted mt-2 text-xs"><SafeText value={f.clause.label} />: <SafeText value={f.clause.excerpt} /></p> : null}
        </article>
      ))}

      <details className="card">
        <summary className="cursor-pointer font-semibold">Draft dispute letter (not sent; for human review)</summary>
        <pre className="doc mt-2">{outcome.letter}</pre>
      </details>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => downloadText(safeFilename(stem, 'md'), renderDdPacket(outcome), 'text/markdown')}>Download audit packet (.md)</button>
        <button type="button" className="btn" onClick={() => downloadText(safeFilename(`${stem}-audit`, 'json'), JSON.stringify({ generatedAt: outcome.generatedAt, tariff: outcome.tariff?.id ?? null, invoice, result }, null, 2), 'application/json')}>Download audit (.json)</button>
        <button type="button" className="btn" onClick={() => downloadText(safeFilename(`${stem}-letter`, 'txt'), outcome.letter)}>Download draft letter (.txt)</button>
      </div>
      <p className="muted text-xs">Downloads are created in your browser. Nothing is uploaded or kept after you close this page.</p>
    </section>
  );
}