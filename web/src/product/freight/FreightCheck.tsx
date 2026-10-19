import { useState } from 'react';

import { downloadText, safeFilename } from '../download';
import { ErrorList, Field, Money, SafeText, Section, Select, TextArea } from '../ui';

import { EMPTY_FREIGHT_FORM, EXAMPLE_FREIGHT_FORM, runFreightCheck, type FreightForm, type FreightOutcome } from './model';
import { APP_DISCLAIMER, confidenceText, renderFreightPacket } from './packet';

const PERSPECTIVES = [
  { value: 'shipper', label: 'Shipper or broker paying the invoice (find overcharges)' },
  { value: 'carrier', label: 'Carrier issuing the invoice (find under-billed charges)' },
] as const;

export function FreightCheck() {
  const [form, setForm] = useState<FreightForm>({ ...EMPTY_FREIGHT_FORM });
  const [errors, setErrors] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<FreightOutcome | null>(null);
  const set = (key: keyof FreightForm) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setOutcome(null);
  };

  const run = () => {
    const r = runFreightCheck(form, new Date());
    setErrors(r.errors);
    setOutcome(r.outcome);
  };
  const stem = `scoup-freight-${form.loadNumber || form.invoiceNumber || 'check'}`;

  return (
    <div className="flex flex-col gap-4">
      <p className="note">
        Checks each invoice line against the rate confirmation that should have authorized it and recomputes detention from the
        time records and the contract terms, with every step of the arithmetic shown. Findings are drafts for a person to review.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={() => { setForm({ ...EXAMPLE_FREIGHT_FORM }); setOutcome(null); setErrors([]); }}>
          Load synthetic example
        </button>
        <button type="button" className="btn" onClick={() => { setForm({ ...EMPTY_FREIGHT_FORM }); setOutcome(null); setErrors([]); }}>
          Clear
        </button>
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <Section title="1. Invoice" intro="Copy the charge lines from the carrier or broker invoice, one per line as description, amount.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Invoice number" value={form.invoiceNumber} onChange={set('invoiceNumber')} />
            <Field label="Load number" value={form.loadNumber} onChange={set('loadNumber')} />
            <Field label="Invoice date" type="date" value={form.invoiceDate} onChange={set('invoiceDate')} />
            <Field label="Carrier (billing party)" value={form.carrier} onChange={set('carrier')} />
            <Field label="Shipper (billed party)" value={form.shipper} onChange={set('shipper')} />
            <Field label="Total on the invoice" value={form.total} onChange={set('total')} inputMode="decimal" mono placeholder="2118.00" />
          </div>
          <TextArea
            label="Charge lines"
            value={form.linesText}
            onChange={set('linesText')}
            rows={6}
            placeholder={'Linehaul, 1500.00\nFuel Surcharge, 168.00\nDetention, 300.00'}
            hint="One charge per line. The last comma separates the amount; tabs, | and ; also work. Up to 500 lines."
          />
        </Section>

        <Section title="2. Rate confirmation" intro="The terms the carrier agreed to for this load.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Linehaul rate" value={form.rcLinehaul} onChange={set('rcLinehaul')} inputMode="decimal" mono />
            <Field label="Fuel surcharge" value={form.rcFuel} onChange={set('rcFuel')} inputMode="decimal" mono />
            <Field label="Detention free hours" value={form.rcFreeHours} onChange={set('rcFreeHours')} inputMode="decimal" mono />
            <Field label="Detention rate per hour" value={form.rcRatePerHour} onChange={set('rcRatePerHour')} inputMode="decimal" mono />
            <Field label="Detention maximum hours" value={form.rcMaxHours} onChange={set('rcMaxHours')} inputMode="decimal" mono />
            <Field label="Authorized accessorials" value={form.rcAuthorized} onChange={set('rcAuthorized')} placeholder="Detention, Lumper" hint="Comma-separated names as written on the rate confirmation." />
          </div>
        </Section>

        <Section title="3. Time records (optional)" intro="From the bill of lading or gate record. With these, detention is recomputed from the contract terms.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Facility" value={form.facility} onChange={set('facility')} />
            <Field label="Appointment" type="datetime-local" value={form.appointment} onChange={set('appointment')} />
            <Field label="Arrival" type="datetime-local" value={form.arrival} onChange={set('arrival')} />
            <Field label="Departure" type="datetime-local" value={form.departure} onChange={set('departure')} />
          </div>
        </Section>

        <details className="card">
          <summary className="cursor-pointer font-semibold">Settings</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select label="Perspective" value={form.perspective} onChange={(v) => { setForm((f) => ({ ...f, perspective: v })); setOutcome(null); }} options={PERSPECTIVES} />
            <Field label="Detention increment (minutes)" value={form.incrementMinutes} onChange={set('incrementMinutes')} inputMode="numeric" mono hint="Billable time is rounded down to this step. Default 15." />
            <Field label="Amount tolerance" value={form.tolerance} onChange={set('tolerance')} inputMode="decimal" mono hint="Differences up to this amount are ignored. Default 0.01." />
            <Field label="Dispute window (days)" value={form.windowDays} onChange={set('windowDays')} inputMode="numeric" mono hint="Quoted in the draft letter. Default 90." />
          </div>
        </details>

        <ErrorList errors={errors} />
        <div>
          <button type="submit" className="btn btn-primary">Run the check</button>
        </div>
      </form>

      {outcome ? <FreightResults outcome={outcome} stem={stem} /> : null}
    </div>
  );
}

function FreightResults({ outcome, stem }: { outcome: FreightOutcome; stem: string }) {
  const { result } = outcome;
  const packet = renderFreightPacket(outcome);
  return (
    <section className="flex flex-col gap-4" aria-label="Results">
      <h2 className="text-xl font-semibold">Results</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card">
          <p className="muted m-0 text-sm">Confirmed findings ({result.perspective === 'shipper' ? 'overcharges' : 'under-billed'})</p>
          <p className="m-0 text-2xl font-semibold"><Money value={result.recoverable_total} /></p>
          <p className="muted m-0 text-xs">Pre-review estimate from fixed rules.</p>
        </div>
        <div className="card">
          <p className="muted m-0 text-sm">Pending human review (not counted)</p>
          <p className="m-0 text-2xl font-semibold"><Money value={result.pending_review_total} /></p>
        </div>
        <div className="card">
          <p className="muted m-0 text-sm">Findings</p>
          <p className="m-0 text-2xl font-semibold">{result.findings.length}</p>
          <p className="muted m-0 text-xs">{result.ignored_findings.length} in the other direction, listed below.</p>
        </div>
      </div>
      <p className="warn">{APP_DISCLAIMER}</p>

      {result.findings.length === 0 ? <p className="ok">No findings for this perspective. Every checked line matched the rate confirmation within the tolerance.</p> : null}
      {result.findings.map((f, i) => (
        <article key={`${f.rule_id}-${i}`} className="card">
          <h3 className="m-0 text-base font-semibold">
            {i + 1}. <SafeText value={f.title} /> - <Money value={f.amount} />
            {f.needs_human_review ? <span className="muted"> (needs human review)</span> : null}
          </h3>
          <p className="muted mt-1 text-xs">Rule <span className="mono">{f.rule_id}</span>, {confidenceText(f.confidence)}.</p>
          <p className="mt-2 text-sm"><SafeText value={f.explanation} /></p>
          {f.calculation.length > 0 ? (
            <ol className="mt-2 list-decimal pl-5 text-sm">
              {f.calculation.map((step, k) => (
                <li key={k}><SafeText value={step} /></li>
              ))}
            </ol>
          ) : null}
        </article>
      ))}

      {result.ignored_findings.length > 0 ? (
        <details className="card">
          <summary className="cursor-pointer font-semibold">Findings in the other direction ({result.ignored_findings.length})</summary>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {result.ignored_findings.map((f, i) => (
              <li key={`${f.rule_id}-${i}`}><SafeText value={f.title} />: <Money value={f.amount} /> ({f.direction})</li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="card">
        <summary className="cursor-pointer font-semibold">Draft letter (not sent; for human review)</summary>
        <pre className="doc mt-2">{outcome.letter}</pre>
      </details>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => downloadText(safeFilename(stem, 'md'), packet, 'text/markdown')}>Download evidence packet (.md)</button>
        <button type="button" className="btn" onClick={() => downloadText(safeFilename(`${stem}-findings`, 'json'), JSON.stringify({ generatedAt: outcome.generatedAt, rulesVersion: 'rules-v1', settings: outcome.settings, input: outcome.bundle, result }, null, 2), 'application/json')}>Download findings (.json)</button>
        <button type="button" className="btn" onClick={() => downloadText(safeFilename(`${stem}-letter`, 'txt'), outcome.letter)}>Download draft letter (.txt)</button>
      </div>
      <p className="muted text-xs">Downloads are created in your browser. Nothing is uploaded or kept after you close this page.</p>
    </section>
  );
}