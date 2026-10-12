/**
 * D&D invoice editor (Part B): every C4 field, container and period sub-forms, tariff and calendar selects,
 * a live preview of `auditDdInvoice` on the form state whenever it parses, and Save (POST, or PUT with the
 * version). Validation messages name the failing fields; server messages are never shown.
 */
import { DD_TEXT, DdInvoiceDetail, auditDdInvoice, type DdInvoiceDetailDto } from '@fr/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { useApi, useToast } from '../../app-context';

import { AuditView } from './AuditView';
import { AreaField, CheckField, Section, SelectField, TextField, ddErrorText, useDdCatalogs } from './dd-common';
import { EMPTY_CONTAINER, EMPTY_PERIOD, bodyToForm, formToBody, type ContainerForm, type InvoiceForm, type PeriodForm } from './invoice-form';
import { EMPTY_INVOICE } from './invoice-form';

const PARTY_TYPES = [
  { value: 'OCEAN_CARRIER', label: 'Ocean carrier' },
  { value: 'MARINE_TERMINAL_OPERATOR', label: 'Marine terminal operator' },
  { value: 'NVOCC', label: 'NVOCC' },
] as const;
const DIRECTIONS = [
  { value: 'IMPORT', label: 'Import' },
  { value: 'EXPORT', label: 'Export' },
] as const;
const CHARGE_TYPES = [
  { value: 'DETENTION', label: 'Detention' },
  { value: 'DEMURRAGE', label: 'Demurrage' },
] as const;

export function InvoiceEditor({ existing, onDone, onCancel }: { existing: DdInvoiceDetailDto | null; onDone: (d: DdInvoiceDetailDto) => void; onCancel: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const { tariffs, calendars } = useDdCatalogs();
  const [f, setF] = useState<InvoiceForm>(() => (existing ? bodyToForm(existing.invoice) : EMPTY_INVOICE));
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string[]>([]);
  const set = <K extends keyof InvoiceForm>(k: K, v: InvoiceForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const setC = (i: number, patch: Partial<ContainerForm>) => setF((x) => ({ ...x, containers: x.containers.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const setP = (i: number, k: number, patch: Partial<PeriodForm>) =>
    setF((x) => ({ ...x, containers: x.containers.map((c, j) => (j === i ? { ...c, periods: c.periods.map((p, q) => (q === k ? { ...p, ...patch } : p)) } : c)) }));

  const parsed = useMemo(() => formToBody(f), [f]);
  const preview = useMemo(() => {
    if (!parsed.ok) return null;
    const { tariffId, calendarId, ...invoice } = parsed.body;
    const tariff = tariffs.data?.items.find((t) => t.id === tariffId)?.data ?? null;
    const calendar = calendars.data?.items.find((c) => c.id === calendarId)?.data ?? null;
    try {
      return auditDdInvoice({ invoice, tariff, calendar });
    } catch {
      return null;
    }
  }, [parsed, tariffs.data, calendars.data]);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      existing === null ? api.post('/api/v1/dd/invoices', body, DdInvoiceDetail) : api.put(`/api/v1/dd/invoices/${encodeURIComponent(existing.id)}`, { version: existing.version, invoice: body }, DdInvoiceDetail),
    onSuccess: async (d) => {
      setError(null);
      toast('Invoice saved.', 'success');
      await qc.invalidateQueries({ queryKey: ['dd', 'invoices'] });
      onDone(d);
    },
    onError: (e) => setError(ddErrorText(e)),
  });

  const submit = () => {
    if (!parsed.ok) {
      setInvalid(parsed.paths);
      return;
    }
    setInvalid([]);
    save.mutate(parsed.body);
  };

  return (
    <form
      aria-label={existing ? 'Edit invoice' : DD_TEXT.newInvoice}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {error ? <p role="alert">{error}</p> : null}
      {invalid.length > 0 ? (
        <div role="alert">
          <p>Check these values:</p>
          <ul>
            {invalid.slice(0, 20).map((p) => (
              <li key={p} className="num">
                {p}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Section title="Invoice">
        <TextField label="Invoice number" value={f.invoiceNumber} onChange={(v) => set('invoiceNumber', v)} />
        <TextField label="Billing party" value={f.billingPartyName} onChange={(v) => set('billingPartyName', v)} />
        <SelectField label="Billing party type" value={f.billingPartyType} options={PARTY_TYPES} onChange={(v) => set('billingPartyType', v)} />
        <TextField label="Billed party" value={f.billedPartyName} onChange={(v) => set('billedPartyName', v)} />
        <SelectField label="Direction" value={f.direction} options={DIRECTIONS} onChange={(v) => set('direction', v)} />
        <TextField label="Invoice date" value={f.invoiceDate} onChange={(v) => set('invoiceDate', v)} />
        <TextField label="Due date" value={f.dueDate} onChange={(v) => set('dueDate', v)} />
        <TextField label="Upstream invoice date (NVOCC)" value={f.upstreamInvoiceDate} onChange={(v) => set('upstreamInvoiceDate', v)} />
        <TextField label="Bill of lading numbers (; separated)" value={f.billOfLadingNumbers} onChange={(v) => set('billOfLadingNumbers', v)} />
        <TextField label="Port of discharge" value={f.portOfDischarge} onChange={(v) => set('portOfDischarge', v)} />
        <TextField label="Basis of liability" value={f.liabilityBasis} onChange={(v) => set('liabilityBasis', v)} />
        <TextField label="Total due" value={f.totalDue} onChange={(v) => set('totalDue', v)} inputMode="decimal" />
        <TextField label="Tariff rule or contract" value={f.ruleReference} onChange={(v) => set('ruleReference', v)} />
        <TextField label="Dispute contact" value={f.disputeContact} onChange={(v) => set('disputeContact', v)} />
        <TextField label="Dispute link (URL or QR code)" value={f.disputeDigitalMeans} onChange={(v) => set('disputeDigitalMeans', v)} />
        <TextField label="Dispute request window (days)" value={f.disputeRequestDays} onChange={(v) => set('disputeRequestDays', v)} inputMode="numeric" />
        <TextField label="Dispute resolution time (days)" value={f.disputeResolutionDays} onChange={(v) => set('disputeResolutionDays', v)} inputMode="numeric" />
        <CheckField label="Certifies the charges comply with FMC rules" checked={f.certifiesFmcRules} onChange={(v) => set('certifiesFmcRules', v)} />
        <CheckField label="Certifies the billing party's performance did not cause the charges" checked={f.certifiesPerformance} onChange={(v) => set('certifiesPerformance', v)} />
        <SelectField
          label="Tariff"
          value={f.tariffId}
          options={[{ value: '', label: 'None' }, ...(tariffs.data?.items ?? []).map((t) => ({ value: t.id, label: t.data.name }))]}
          onChange={(v) => set('tariffId', v)}
        />
        <SelectField
          label="Calendar"
          value={f.calendarId}
          options={[{ value: '', label: 'None' }, ...(calendars.data?.items ?? []).map((c) => ({ value: c.id, label: c.data.name }))]}
          onChange={(v) => set('calendarId', v)}
        />
      </Section>
      {f.containers.map((c, i) => (
        <Section key={i} title={`Container ${i + 1}`}>
          <TextField label="Container number" value={c.containerNumber} onChange={(v) => setC(i, { containerNumber: v })} />
          <TextField label="Size type" value={c.sizeType} onChange={(v) => setC(i, { sizeType: v })} />
          <SelectField label="Charge type" value={c.chargeType} options={CHARGE_TYPES} onChange={(v) => setC(i, { chargeType: v })} />
          <TextField label="Free days" value={c.freeDays} onChange={(v) => setC(i, { freeDays: v })} inputMode="numeric" />
          <TextField label="Free time start" value={c.freeTimeStart} onChange={(v) => setC(i, { freeTimeStart: v })} />
          <TextField label="Free time end" value={c.freeTimeEnd} onChange={(v) => setC(i, { freeTimeEnd: v })} />
          <TextField label="Availability date" value={c.availabilityDate} onChange={(v) => setC(i, { availabilityDate: v })} />
          <TextField label="Earliest return date" value={c.earliestReturnDate} onChange={(v) => setC(i, { earliestReturnDate: v })} />
          <TextField label="Your clock start" value={c.clockStart} onChange={(v) => setC(i, { clockStart: v })} />
          <TextField label="Your clock stop" value={c.clockStop} onChange={(v) => setC(i, { clockStop: v })} />
          <TextField label="Cargo available" value={c.cargoAvailableDate} onChange={(v) => setC(i, { cargoAvailableDate: v })} />
          <AreaField label="Empty return refused (one date per line)" value={c.refusedDates} onChange={(v) => setC(i, { refusedDates: v })} rows={2} />
          {c.periods.map((p, k) => (
            <fieldset key={k} className="flex flex-wrap items-end gap-2">
              <legend className="text-sm">{`Charge line ${k + 1}`}</legend>
              <TextField label="From" value={p.from} onChange={(v) => setP(i, k, { from: v })} />
              <TextField label="To" value={p.to} onChange={(v) => setP(i, k, { to: v })} />
              <TextField label="Daily rate" value={p.rate} onChange={(v) => setP(i, k, { rate: v })} inputMode="decimal" />
              <TextField label="Amount" value={p.amount} onChange={(v) => setP(i, k, { amount: v })} inputMode="decimal" />
              <button type="button" className="btn" onClick={() => setC(i, { periods: c.periods.filter((_, q) => q !== k) })}>
                Remove line
              </button>
            </fieldset>
          ))}
          <button type="button" className="btn" onClick={() => setC(i, { periods: [...c.periods, { ...EMPTY_PERIOD }] })}>
            Add charge line
          </button>
          {f.containers.length > 1 ? (
            <button type="button" className="btn" onClick={() => set('containers', f.containers.filter((_, j) => j !== i))}>
              Remove container
            </button>
          ) : null}
        </Section>
      ))}
      <button type="button" className="btn" onClick={() => set('containers', [...f.containers, { ...EMPTY_CONTAINER, periods: [{ ...EMPTY_PERIOD }] }])}>
        Add container
      </button>
      <div className="my-3 flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {DD_TEXT.save}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <h3 className="font-semibold">Preview</h3>
      {preview ? <AuditView result={preview} labels={preview.containers.map((c) => c.label)} /> : <p className="muted text-sm">The preview appears when all values are valid.</p>}
    </form>
  );
}
