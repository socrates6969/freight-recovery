/**
 * REQ-20261018-exec-dashboard: the executive insights page. Read-only aggregates over this tenant's own
 * claims for users holding `insights:read`. Filters live in the URL; every request includes them and the
 * default perspective is SHIPPER. Each section handles its own request state, so one failed request never
 * hides the others. Money is shown only as identified, pending review, approved, ready to demand or (for
 * the D&D invoice total) invoiced; recovery outcomes are not tracked and the page says so.
 */
import { INSIGHTS_LIMIT_DEFAULT, INSIGHTS_NOT_TRACKED, INSIGHTS_OUTCOME_DISCLAIMER, INSIGHTS_TEXT } from '@fr/shared';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useApi, useCan } from '../../app-context';
import { useFeatures } from '../intelligence/use-features';

import { AgeingSection, DisputeWindowSection, MoneySection, StagesSection } from './money-sections';
import { IntakeSection, ThroughputSection } from './activity-sections';
import { apiFilters, parseInsightsParams, periodValid } from './insights-params';
import { CarrierLeakageSection, RuleLeakageSection } from './leakage-sections';
import { RoutingShadowSection } from './routing-section';
import { Section } from './section';

export function InsightsPage() {
  const allowed = useCan('insights:read');
  if (!allowed) {
    return (
      <section className="card p-6">
        <h1 className="mb-2 text-lg font-semibold">{INSIGHTS_TEXT.title}</h1>
        <p className="muted">{INSIGHTS_TEXT.forbidden}</p>
      </section>
    );
  }
  return <InsightsContent />;
}

function InsightsContent() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const [now] = useState(() => new Date());
  const p = parseInsightsParams(params, now);
  const valid = periodValid(p);
  const { kind, perspective } = apiFilters(p);
  const period = { from: p.from, to: p.to };
  const ids = { perspective: useId(), kind: useId(), from: useId(), to: useId() };
  const common = { retry: false, enabled: valid } as const;

  const summary = useQuery({ ...common, queryKey: ['insights', 'summary', p.from, p.to, kind ?? 'ALL', perspective ?? 'ALL'], queryFn: () => api.insightsSummary({ ...period, kind, perspective }) });
  const stages = useQuery({ ...common, queryKey: ['insights', 'stages', p.from, p.to, kind ?? 'ALL', perspective ?? 'ALL'], queryFn: () => api.insightsStages({ ...period, kind, perspective }) });
  const windows = useQuery({ ...common, queryKey: ['insights', 'windows', kind ?? 'ALL', perspective ?? 'ALL'], queryFn: () => api.insightsDeadlines({ kind, perspective }) });
  const carriers = useQuery({
    ...common,
    queryKey: ['insights', 'leakage', 'carrier', p.from, p.to, kind ?? 'ALL', perspective ?? 'ALL', INSIGHTS_LIMIT_DEFAULT],
    queryFn: () => api.insightsLeakage({ ...period, kind, perspective, by: 'carrier', limit: INSIGHTS_LIMIT_DEFAULT }),
  });
  const rules = useQuery({
    ...common,
    queryKey: ['insights', 'leakage', 'rule', p.from, p.to, kind ?? 'ALL', perspective ?? 'ALL', p.carrier ?? ''],
    queryFn: () => api.insightsLeakage({ ...period, kind, perspective, by: 'rule', carrier: p.carrier }),
  });
  const throughput = useQuery({ ...common, queryKey: ['insights', 'throughput', p.from, p.to, kind ?? 'ALL', perspective ?? 'ALL'], queryFn: () => api.insightsThroughput({ ...period, kind, perspective }) });
  // REQ-20261020-dd-deadline: the routing shadow is requested only while its flag is on (fail closed; a 404 hides it).
  const features = useFeatures();
  const routing = useQuery({ ...common, enabled: valid && features.routingShadow, queryKey: ['insights', 'routing', p.from, p.to], queryFn: () => api.insightsRouting(period) });

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v === null || v === '') next.delete(k);
    else next.set(k, v);
    setParams(next);
  };

  return (
    <section>
      <h1 className="mb-3 text-lg font-semibold">{INSIGHTS_TEXT.title}</h1>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor={ids.perspective}>
            Perspective
          </label>
          <select id={ids.perspective} className="input" value={p.perspective} onChange={(e) => setParam('perspective', e.target.value)}>
            <option value="SHIPPER">Shipper</option>
            <option value="CARRIER">Carrier</option>
            <option value="ALL">Both</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor={ids.kind}>
            Claim type
          </label>
          <select id={ids.kind} className="input" value={p.kind ?? ''} onChange={(e) => setParam('kind', e.target.value)}>
            <option value="">All</option>
            <option value="FREIGHT">Freight</option>
            <option value="OCEAN_DD">Ocean D&amp;D</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor={ids.from}>
            From
          </label>
          <input id={ids.from} type="date" className="input" value={p.from} onChange={(e) => setParam('from', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor={ids.to}>
            To (not included)
          </label>
          <input id={ids.to} type="date" className="input" value={p.to} onChange={(e) => setParam('to', e.target.value)} />
        </div>
      </div>
      {!valid ? (
        <p role="alert" className="mb-4">
          The start date must be before the end date.
        </p>
      ) : (
        <>
          <MoneySection q={summary} />
          <StagesSection q={summary} />
          <AgeingSection q={stages} />
          <DisputeWindowSection q={windows} />
          <CarrierLeakageSection q={carriers} onShowRules={(key) => setParam('carrier', key)} />
          <RuleLeakageSection q={rules} carrier={p.carrier} onClear={() => setParam('carrier', null)} />
          <ThroughputSection q={throughput} />
          <IntakeSection q={stages} />
          {features.routingShadow ? <RoutingShadowSection q={routing} /> : null}
        </>
      )}
      <Section title={INSIGHTS_TEXT.notTrackedHeading}>
        <ul className="text-sm">
          {INSIGHTS_NOT_TRACKED.map((g) => (
            <li key={g.id} className="mb-1">
              <span className="font-medium">{g.title}</span>: <span className="muted">{g.reason}</span>
            </li>
          ))}
        </ul>
      </Section>
      <footer className="text-sm">
        <p role="note" className="mb-1">
          {INSIGHTS_OUTCOME_DISCLAIMER}
        </p>
        <p className="muted">{INSIGHTS_TEXT.periodNote}</p>
      </footer>
    </section>
  );
}
