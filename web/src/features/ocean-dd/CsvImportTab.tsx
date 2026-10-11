/**
 * Import CSV tab (Part B, decision D9): the file is read as text in the browser, refused above 1,000,000
 * characters before parsing, parsed with the shared `parseDdCsv`, previewed (invoices and row errors), then
 * each invoice is posted one by one with the chosen tariff/calendar; per-invoice outcomes are listed.
 */
import { DD_CSV_MAX_CHARS, DD_TEXT, DdInvoiceDetail, parseDdCsv, type DdCsvResult } from '@fr/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { useApi, useCan } from '../../app-context';
import { SafeText } from '../../components/ui/SafeText';

import { SelectField, ddErrorText, useDdCatalogs } from './dd-common';

/** Largest file size read: 4 bytes per character at most (UTF-8). */
export const CSV_MAX_BYTES = 4 * DD_CSV_MAX_CHARS;

interface Outcome {
  key: string;
  label: string;
  text: string;
}

export function CsvImportTab() {
  const api = useApi();
  const qc = useQueryClient();
  const fileId = useId();
  const canManage = useCan('dd_invoices:manage');
  const { tariffs, calendars } = useDdCatalogs();
  const [parsed, setParsed] = useState<DdCsvResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tariffId, setTariffId] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    setParsed(null);
    setOutcomes([]);
    setError(null);
    if (!file) return;
    // Fix round 1 (S5): refuse oversized files before reading them (a character is at most 4 UTF-8 bytes).
    if (file.size > CSV_MAX_BYTES) {
      setError('The file is too large to import.');
      return;
    }
    const text = await file.text();
    if (text.length > DD_CSV_MAX_CHARS) {
      setError('The file is too large to import.');
      return;
    }
    setParsed(parseDdCsv(text));
  };

  const importAll = async () => {
    if (!parsed) return;
    setBusy(true);
    const out: Outcome[] = [];
    for (const [i, inv] of parsed.invoices.entries()) {
      const label = `${inv.invoiceNumber} (${inv.billingPartyName})`;
      try {
        await api.post('/api/v1/dd/invoices', { ...inv, tariffId: tariffId === '' ? null : tariffId, calendarId: calendarId === '' ? null : calendarId }, DdInvoiceDetail);
        out.push({ key: `${i}`, label, text: 'Imported' });
      } catch (e) {
        out.push({ key: `${i}`, label, text: ddErrorText(e) });
      }
      setOutcomes([...out]);
    }
    setBusy(false);
    await qc.invalidateQueries({ queryKey: ['dd', 'invoices'] });
  };

  return (
    <section aria-label={DD_TEXT.importCsv}>
      <label className="flex flex-col text-sm" htmlFor={fileId}>
        CSV file
        <input id={fileId} type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      {parsed ? (
        <>
          {parsed.errors.length > 0 ? (
            <div role="alert" className="my-2">
              <p>{DD_TEXT.csvErrors}</p>
              <ul className="text-sm">
                {parsed.errors.slice(0, 100).map((e, i) => (
                  <li key={i} className="num">
                    {`Row ${e.row}${e.column ? `, ${e.column}` : ''}: ${e.code}`}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <table className="data-table my-2 text-sm" aria-label="Invoices to import">
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Billing party</th>
                <th scope="col">Containers</th>
              </tr>
            </thead>
            <tbody>
              {parsed.invoices.map((inv, i) => (
                <tr key={i}>
                  <td>
                    <SafeText value={inv.invoiceNumber} />
                  </td>
                  <td>
                    <SafeText value={inv.billingPartyName} />
                  </td>
                  <td className="num">{inv.containers.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canManage && parsed.invoices.length > 0 ? (
            <div className="flex flex-wrap items-end gap-3">
              <SelectField label="Tariff" value={tariffId} options={[{ value: '', label: 'None' }, ...(tariffs.data?.items ?? []).map((t) => ({ value: t.id, label: t.data.name }))]} onChange={setTariffId} />
              <SelectField label="Calendar" value={calendarId} options={[{ value: '', label: 'None' }, ...(calendars.data?.items ?? []).map((c) => ({ value: c.id, label: c.data.name }))]} onChange={setCalendarId} />
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void importAll()}>
                Import invoices
              </button>
            </div>
          ) : null}
          {outcomes.length > 0 ? (
            <ul className="my-2 text-sm" aria-label="Import results">
              {outcomes.map((o) => (
                <li key={o.key}>
                  <SafeText value={o.label} />: {o.text}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
