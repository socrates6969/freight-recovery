/**
 * Cost outlook page (REQ-20261011-fuel-outlook, Part C F15; route /outlook). Every number is the DTO string
 * or value as given by the API. Forecast horizons are labelled with the method and the gate reason, every
 * range with its measured backtest coverage, and every series with its data provenance. S2: a fuel-table
 * select adds the surcharge rate per diesel horizon. Backtested on public data; not a guarantee.
 */
import {
  METHOD_LABELS,
  OUTLOOK_NOTE,
  OUTLOOK_TEXT,
  OutlookResponse,
  FscTableList,
  REASON_LABELS,
  outlookBacktestText,
  rangeText,
  type OutlookSeriesDto,
} from '@fr/shared';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { step4ErrorText } from '../../api/client';
import { useApi } from '../../app-context';
import { SafeText } from '../../components/ui/SafeText';
import { useFeatures } from '../intelligence/use-features';

/** `Data: ${citation}. Retrieved ${retrievedAt}; last observation ${lastDate}; file sha256 ${sha12}.` */
export function provenanceText(s: OutlookSeriesDto): string | null {
  const p = s.provenance;
  if (p === null) return null;
  return `Data: ${s.citation}. Retrieved ${p.retrievedAt}; last observation ${p.lastDate}; file sha256 ${p.sha256.slice(0, 12)}.`;
}

function SeriesSection({ s, unitText }: { s: OutlookSeriesDto; unitText: (x: string) => string }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mb-6">
      <h2 id={headingId} className="text-lg font-semibold">
        {s.label}
      </h2>
      <p className="muted text-sm">{s.unit}</p>
      {s.status === 'no_data' ? (
        <p>{OUTLOOK_TEXT.noData}</p>
      ) : s.status === 'insufficient_history' ? (
        <p>{OUTLOOK_TEXT.insufficient}</p>
      ) : (
        <>
          {s.latest ? <p className="num">{`Latest: ${s.latest.value} (${s.latest.date})`}</p> : null}
          {s.backtestYears ? <p className="text-sm">{outlookBacktestText(s.backtestYears.from, s.backtestYears.to)}</p> : null}
          <table className="data-table my-2 text-sm" aria-label={`${s.label} outlook`}>
            <thead>
              <tr>
                <th scope="col">Target date</th>
                <th scope="col">Method</th>
                <th scope="col">Basis</th>
                <th scope="col">Point</th>
                <th scope="col">Range</th>
                <th scope="col">Backtest</th>
                {s.horizons.some((h) => h.fsc !== null) ? <th scope="col">{OUTLOOK_TEXT.fscTable}</th> : null}
              </tr>
            </thead>
            <tbody>
              {s.horizons.map((h) => (
                <tr key={h.h}>
                  <td className="num">{h.targetDate}</td>
                  <td>{METHOD_LABELS[h.method]}</td>
                  <td>{REASON_LABELS[h.reason]}</td>
                  <td className="num">{h.point}</td>
                  <td>
                    <span className="num">{`${h.low} - ${h.high}`}</span>
                    <br />
                    <span className="muted">{rangeText(h.backtest.coverage)}</span>
                  </td>
                  <td className="num">{`MASE vs no change ${h.backtest.maeRatio === null ? 'n/a' : h.backtest.maeRatio}, DM ${h.backtest.dm}`}</td>
                  {h.fsc !== null ? <td className="num">{`${unitText(h.fsc.point)} (${unitText(h.fsc.low)} - ${unitText(h.fsc.high)})`}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {provenanceText(s) !== null ? <p className="muted text-xs">{provenanceText(s)}</p> : null}
    </section>
  );
}

export function OutlookPage() {
  const api = useApi();
  const features = useFeatures();
  const selectId = useId();
  const [tableId, setTableId] = useState('');
  const q = useQuery({
    queryKey: ['outlook', tableId],
    queryFn: () => api.get(`/api/v1/outlook${tableId ? `?fscTableId=${encodeURIComponent(tableId)}` : ''}`, OutlookResponse),
    retry: false,
  });
  const tables = useQuery({
    queryKey: ['fuel-tables'],
    queryFn: () => api.get('/api/v1/fuel-tables', FscTableList),
    retry: false,
    enabled: features.fuel,
  });
  const fsc = q.data?.fscTable ?? null;
  const unitText = (x: string) => (fsc?.unit === 'percent' ? `${x}%` : `$${x} per mile`);
  return (
    <main className="p-6">
      <h1 className="mb-2 text-xl font-semibold">{OUTLOOK_TEXT.heading}</h1>
      <p className="muted mb-4 text-sm">{OUTLOOK_NOTE}</p>
      {features.fuel && tables.data && tables.data.items.length > 0 ? (
        <label className="mb-4 flex max-w-sm flex-col text-sm" htmlFor={selectId}>
          {OUTLOOK_TEXT.fscTable}
          <select id={selectId} className="input" value={tableId} onChange={(e) => setTableId(e.target.value)}>
            <option value="" />
            {tables.data.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {fsc ? (
        <p className="mb-3 text-sm">
          <SafeText value={fsc.name} />
          {`: ${unitText(fsc.current)} at the latest price.`}
        </p>
      ) : null}
      {q.isError ? (
        <p role="alert">{step4ErrorText(q.error)}</p>
      ) : !q.data ? (
        <div className="skeleton h-24" aria-hidden="true" />
      ) : (
        q.data.series.map((s) => <SeriesSection key={s.key} s={s} unitText={unitText} />)
      )}
    </main>
  );
}
