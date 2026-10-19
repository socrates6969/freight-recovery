import { DD_NOTE, DD_PRESET_NOTE, DD_TARIFF_PRESETS } from '@fr/shared';
import { useState } from 'react';

import { Checkbox, ErrorList, Field, SafeText, Section, Select } from '../ui';

import { DdResults } from './DdResults';
import {
  MAX_CONTAINERS,
  MAX_PERIODS,
  emptyContainer,
  emptyDdForm,
  emptyPeriod,
  exampleDdForm,
  importDdCsv,
  presetById,
  runDdAudit,
  type DdContainerForm,
  type DdForm,
  type DdOutcome,
} from './model';

const PARTY_TYPES = [
  { value: 'OCEAN_CARRIER', label: 'Ocean carrier (VOCC)' },
  { value: 'MARINE_TERMINAL_OPERATOR', label: 'Marine terminal operator' },
  { value: 'NVOCC', label: 'NVOCC' },
] as const;
const DIRECTIONS = [
  { value: 'IMPORT', label: 'Import' },
  { value: 'EXPORT', label: 'Export' },
] as const;
const CHARGE_TYPES = [
  { value: 'DETENTION', label: 'Detention (container out of the terminal)' },
  { value: 'DEMURRAGE', label: 'Demurrage (container in the terminal)' },
] as const;
const PRESET_OPTIONS = [{ value: '', label: 'No tariff attached (content, timing and arithmetic checks only)' }, ...DD_TARIFF_PRESETS.map((p) => ({ value: p.id, label: p.data.name }))];
const CSV_MAX_BYTES = 4_000_000;

export function DdCheck() {
  const [form, setForm] = useState<DdForm>(() => emptyDdForm());
  const [errors, setErrors] = useState<string[]>([]);
  const [csvNote, setCsvNote] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<DdOutcome | null>(null);
  const reset = (next: DdForm) => {
    setForm(next);
    setOutcome(null);
    setErrors([]);
  };
  const set = <K extends keyof DdForm>(key: K) => (value: DdForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setOutcome(null);
  };
  const setContainer = (i: number, patch: Partial<DdContainerForm>) => {
    setForm((f) => ({ ...f, containers: f.containers.map((c, k) => (k === i ? { ...c, ...patch } : c)) }));
    setOutcome(null);
  };
  const preset = presetById(form.tariffPresetId);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > CSV_MAX_BYTES) {
      setCsvNote('The file is larger than 4 MB and was not read.');
      return;
    }
    const text = await file.text();
    const r = importDdCsv(text);
    const first = r.forms[0];
    if (first) {
      reset({ ...first, tariffPresetId: form.tariffPresetId });
      setCsvNote(`Loaded invoice 1 of ${r.forms.length} from the file${r.errors.length ? `; ${r.errors.length} row problem(s) were skipped` : ''}. The file was read in your browser only.`);
    } else {
      setCsvNote(r.errors.length ? `No invoice could be read: ${r.errors.slice(0, 3).map((e) => `row ${e.row}${e.column ? ` ${e.column}` : ''}: ${e.code}`).join('; ')}` : 'The file contained no invoice rows.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="note">{DD_NOTE}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={() => reset(exampleDdForm())}>Load synthetic example</button>
        <button type="button" className="btn" onClick={() => reset(emptyDdForm())}>Clear</button>
        <label className="btn cursor-pointer">
          Import CSV
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void importFile(e.target.files?.[0])} />
        </label>
      </div>
      {csvNote ? <p className="note" role="status"><SafeText value={csvNote} /></p> : null}

      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); const r = runDdAudit(form, new Date()); setErrors(r.errors); setOutcome(r.outcome); }}>
        <Section title="1. Invoice" intro="The fields 46 CFR 541.6 requires on a demurrage or detention invoice. Leave a field empty if the invoice does not state it; the audit reports what is missing.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Invoice number" value={form.invoiceNumber} onChange={set('invoiceNumber')} required />
            <Field label="Billing party" value={form.billingPartyName} onChange={set('billingPartyName')} required />
            <Select label="Billing party type" value={form.billingPartyType} onChange={set('billingPartyType')} options={PARTY_TYPES} />
            <Field label="Billed party" value={form.billedPartyName} onChange={set('billedPartyName')} required />
            <Select label="Direction" value={form.direction} onChange={set('direction')} options={DIRECTIONS} />
            <Field label="Invoice date" type="date" value={form.invoiceDate} onChange={set('invoiceDate')} />
            <Field label="Due date" type="date" value={form.dueDate} onChange={set('dueDate')} />
            {form.billingPartyType === 'NVOCC' ? <Field label="Date of the invoice the NVOCC received" type="date" value={form.upstreamInvoiceDate} onChange={set('upstreamInvoiceDate')} /> : null}
            <Field label="Bill of lading numbers" value={form.blNumbers} onChange={set('blNumbers')} hint="Comma-separated." />
            <Field label="Port of discharge" value={form.portOfDischarge} onChange={set('portOfDischarge')} />
            <Field label="Total due" value={form.totalDue} onChange={set('totalDue')} inputMode="decimal" mono placeholder="4350.00" />
            <Field label="Rule or tariff reference on the invoice" value={form.ruleReference} onChange={set('ruleReference')} />
            <Field label="Dispute contact" value={form.disputeContact} onChange={set('disputeContact')} />
            <Field label="Dispute web address (digital means)" value={form.disputeDigitalMeans} onChange={set('disputeDigitalMeans')} maxLength={500} />
            <Field label="Days allowed to request mitigation" value={form.disputeRequestDays} onChange={set('disputeRequestDays')} inputMode="numeric" mono />
            <Field label="Days to resolve a request" value={form.disputeResolutionDays} onChange={set('disputeResolutionDays')} inputMode="numeric" mono />
          </div>
          <Field label="Basis for why the billed party is liable" value={form.liabilityBasis} onChange={set('liabilityBasis')} maxLength={300} />
          <div className="flex flex-wrap gap-5">
            <Checkbox label="Invoice certifies the charges are consistent with FMC rules" checked={form.certifiesFmcRules} onChange={set('certifiesFmcRules')} />
            <Checkbox label="Invoice certifies the billing party's performance did not cause the charges" checked={form.certifiesPerformance} onChange={set('certifiesPerformance')} />
          </div>
        </Section>

        <Section title="2. Containers and charged periods" intro="One block per container on the invoice. Charged periods are the date ranges and amounts as billed.">
          {form.containers.map((c, i) => (
            <ContainerEditor key={i} index={i} container={c} onChange={(patch) => setContainer(i, patch)} onRemove={form.containers.length > 1 ? () => set('containers')(form.containers.filter((_, k) => k !== i)) : null} />
          ))}
          {form.containers.length < MAX_CONTAINERS ? (
            <div>
              <button type="button" className="btn" onClick={() => set('containers')([...form.containers, emptyContainer()])}>Add container</button>
            </div>
          ) : null}
        </Section>

        <Section title="3. Tariff to recompute against (optional)" intro={DD_PRESET_NOTE}>
          <Select label="Public tariff preset" value={form.tariffPresetId} onChange={set('tariffPresetId')} options={PRESET_OPTIONS} />
          {preset ? (
            <p className="muted text-sm">
              <SafeText value={preset.provenance.document} /> ({preset.provenance.carrier}; retrieved {preset.provenance.retrieved}; {preset.data.freeDays} free {preset.data.freeDayBasis} days, {preset.data.tiers.length} rate tier(s)).
              {preset.provenance.verification !== 'primary' ? ' Verification: not read from the carrier document itself; check before use.' : ''}
              {preset.provenance.assumptions.length ? ` Assumptions: ${preset.provenance.assumptions.join(' ')}` : ''}
            </p>
          ) : null}
        </Section>

        <ErrorList errors={errors} />
        <div>
          <button type="submit" className="btn btn-primary">Run the audit</button>
        </div>
      </form>

      {outcome ? <DdResults outcome={outcome} /> : null}
    </div>
  );
}

function ContainerEditor({ index, container: c, onChange, onRemove }: { index: number; container: DdContainerForm; onChange: (patch: Partial<DdContainerForm>) => void; onRemove: (() => void) | null }) {
  const setPeriod = (k: number, patch: Partial<DdContainerForm['periods'][number]>) => onChange({ periods: c.periods.map((p, j) => (j === k ? { ...p, ...patch } : p)) });
  return (
    <fieldset className="card flex flex-col gap-3">
      <legend className="px-1 font-semibold">Container {index + 1}</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Container number" value={c.containerNumber} onChange={(v) => onChange({ containerNumber: v })} mono maxLength={20} />
        <Field label="Size/type" value={c.sizeType} onChange={(v) => onChange({ sizeType: v })} mono placeholder="40DV" hint="Two digits and two letters, e.g. 20DV, 40HC." />
        <Select label="Charge type" value={c.chargeType} onChange={(v) => onChange({ chargeType: v })} options={CHARGE_TYPES} />
        <Field label="Free days stated" value={c.freeDays} onChange={(v) => onChange({ freeDays: v })} inputMode="numeric" mono />
        <Field label="Free time start" type="date" value={c.freeTimeStart} onChange={(v) => onChange({ freeTimeStart: v })} />
        <Field label="Free time end" type="date" value={c.freeTimeEnd} onChange={(v) => onChange({ freeTimeEnd: v })} />
        <Field label="Availability date (imports)" type="date" value={c.availabilityDate} onChange={(v) => onChange({ availabilityDate: v })} />
        <Field label="Earliest return date (exports)" type="date" value={c.earliestReturnDate} onChange={(v) => onChange({ earliestReturnDate: v })} />
      </div>
      <h3 className="m-0 text-sm font-semibold">Charged periods</h3>
      {c.periods.map((p, k) => (
        <div key={k} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="From" type="date" value={p.from} onChange={(v) => setPeriod(k, { from: v })} />
          <Field label="To" type="date" value={p.to} onChange={(v) => setPeriod(k, { to: v })} />
          <Field label="Daily rate" value={p.rate} onChange={(v) => setPeriod(k, { rate: v })} inputMode="decimal" mono />
          <Field label="Amount charged" value={p.amount} onChange={(v) => setPeriod(k, { amount: v })} inputMode="decimal" mono />
          <div className="flex items-end">
            {c.periods.length > 1 ? <button type="button" className="btn-link" onClick={() => onChange({ periods: c.periods.filter((_, j) => j !== k) })}>Remove period</button> : null}
          </div>
        </div>
      ))}
      {c.periods.length < MAX_PERIODS ? (
        <div>
          <button type="button" className="btn-link" onClick={() => onChange({ periods: [...c.periods, emptyPeriod()] })}>Add period</button>
        </div>
      ) : null}
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Your evidence (optional): clock dates, cargo availability, refused returns</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Clock start (your records)" type="date" value={c.clockStart} onChange={(v) => onChange({ clockStart: v })} />
          <Field label="Clock stop (your records)" type="date" value={c.clockStop} onChange={(v) => onChange({ clockStop: v })} />
          <Field label="Cargo actually available on" type="date" value={c.cargoAvailableDate} onChange={(v) => onChange({ cargoAvailableDate: v })} />
          <Field label="Dates empty return was refused" value={c.refusedDates} onChange={(v) => onChange({ refusedDates: v })} mono placeholder="2026-03-12, 2026-03-13" maxLength={1000} />
        </div>
      </details>
      {onRemove ? (
        <div>
          <button type="button" className="btn-link" onClick={onRemove}>Remove container {index + 1}</button>
        </div>
      ) : null}
    </fieldset>
  );
}