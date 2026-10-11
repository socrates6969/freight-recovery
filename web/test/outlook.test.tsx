/**
 * Step 7 web units (REQ-20261011-fuel-outlook, F15): the Outlook page renders the note once, per series the
 * label, latest value, backtest years, one row per horizon (target date, method and reason labels, point,
 * range with its measured coverage, MASE/DM) and the provenance line; the fuel-table select (S2) re-queries
 * with `fscTableId` and shows the rate per horizon. Nav link only with the flag.
 */
import { OUTLOOK_NOTE, OUTLOOK_TEXT, PERMISSION_MATRIX, PRICE_SERIES, REASON_LABELS, outlookBacktestText, rangeText, type Role } from '@fr/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AppRoot } from '../src/app-root';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FLAGS_ON = {
  'intelligence.charge_suggestions': true,
  'intelligence.cost_outlook': true,
  'intelligence.fuel_check': true,
  'intelligence.provenance': true,
  'intelligence.similar_claims': true,
  'intelligence.worklist': true,
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const horizon = (h: number, method: 'ar2' | 'naive', reason: 'model_beats_naive' | 'naive_by_design', point: string, low: string, high: string, fsc: unknown = null) => ({
  h,
  unit: 'week',
  targetDate: h === 1 ? '2026-10-12' : '2027-01-04',
  method,
  reason,
  point,
  low,
  high,
  backtest: { candidate: method, origins: 779, maeRatio: method === 'ar2' ? 0.85 : 1, dm: method === 'ar2' ? 5.64 : 0, coverage: 0.779, coverageHits: 526, coverageCases: 675 },
  fsc,
});

function outlook(withTable: boolean) {
  const d = PRICE_SERIES.diesel_us;
  const p = PRICE_SERIES.ppi_tl;
  return {
    outlookVersion: 'outlook-v1',
    note: OUTLOOK_NOTE,
    series: [
      {
        key: 'diesel_us',
        label: d.label,
        unit: d.unit,
        frequency: 'weekly',
        citation: d.citation,
        status: 'ok',
        provenance: { importId: U(10), sourceUrl: d.sourceUrl, retrievedAt: '2026-10-11', sha256: 'aca8fefdbb54'.padEnd(64, '0'), rowCount: 1699, firstDate: '1994-03-21', lastDate: '2026-10-05' },
        latest: { date: '2026-10-05', value: '6.199' },
        backtestYears: { from: 2011, to: 2026 },
        horizons: [
          horizon(1, 'ar2', 'model_beats_naive', '6.124', '5.903', '6.392', withTable ? { point: '0.83', low: '0.79', high: '0.87' } : null),
          horizon(13, 'naive', 'naive_by_design', '6.199', '4.384', '9.395', withTable ? { point: '0.84', low: '0.53', high: '1.37' } : null),
        ],
      },
      { key: 'ppi_tl', label: p.label, unit: p.unit, frequency: 'monthly', citation: p.citation, status: 'no_data', provenance: null, latest: null, backtestYears: null, horizons: [] },
    ],
    fscTable: withTable ? { id: U(600), name: 'Acme FSC', version: 1, unit: 'per_mile', current: '0.84' } : null,
  };
}

function setup(role: Role, flags: Record<string, boolean> = FLAGS_ON) {
  const user = { id: U(1), email: 'u@x.test', name: 'Test User', role, tenant: { id: U(90), name: 'Acme (synthetic)' }, mfaEnabled: true };
  const calls: string[] = [];
  const fetchImpl = async (url: RequestInfo | URL) => {
    const u = String(url);
    calls.push(u);
    if (u === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
    if (u === '/api/v1/auth/refresh') return json(200, { accessToken: 't', tokenType: 'Bearer', expiresIn: 600, user });
    if (u === '/api/v1/me') return json(200, { user, permissions: [...PERMISSION_MATRIX[role]] });
    if (u === '/api/v1/features') return json(200, { flags });
    if (u.startsWith('/api/v1/approvals')) return json(200, { items: [], page: 1, pageSize: 25, total: 0 });
    if (u === '/api/v1/outlook') return json(200, outlook(false));
    if (u === `/api/v1/outlook?fscTableId=${U(600)}`) return json(200, outlook(true));
    if (u === '/api/v1/fuel-tables')
      return json(200, {
        items: [
          {
            id: U(600),
            name: 'Acme FSC',
            kind: 'step',
            unit: 'per_mile',
            priceSeries: 'diesel_us',
            effectiveOffsetDays: 2,
            params: { basePrice: '1.20', stepSize: '0.06', ratePerStep: '0.01', bracket: 'above_base' },
            version: 1,
            archived: false,
            createdAt: '2026-10-11T00:00:00.000Z',
            updatedAt: '2026-10-11T00:00:00.000Z',
          },
        ],
      });
    return json(404, { error: { code: 'not_found', message: 'SERVER TEXT', requestId: 'r' } });
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

describe('Outlook page', () => {
  it('renders the F15 texts, horizons, ranges with coverage and provenance; S2 select adds the rates', async () => {
    const { fetchImpl, calls } = setup('VIEWER');
    const u = userEvent.setup();
    const { container } = render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/outlook']} />);
    expect(await screen.findByRole('heading', { name: OUTLOOK_TEXT.heading })).toBeInTheDocument();
    expect(screen.getAllByText(OUTLOOK_NOTE)).toHaveLength(1);
    expect(await screen.findByText(outlookBacktestText(2011, 2026))).toBeInTheDocument();
    const t = screen.getByRole('table', { name: `${PRICE_SERIES.diesel_us.label} outlook` });
    const rows = within(t).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('2026-10-12');
    expect(rows[1]).toHaveTextContent('Trend model');
    expect(rows[1]).toHaveTextContent(REASON_LABELS.model_beats_naive);
    expect(rows[1]).toHaveTextContent('5.903 - 6.392');
    expect(rows[1]).toHaveTextContent(rangeText(0.779));
    expect(rows[1]).toHaveTextContent('MASE vs no change 0.85, DM 5.64');
    expect(rows[2]).toHaveTextContent('No change');
    expect(container.textContent).toContain(`Data: ${PRICE_SERIES.diesel_us.citation}. Retrieved 2026-10-11; last observation 2026-10-05; file sha256 aca8fefdbb54.`);
    expect(screen.getByText(OUTLOOK_TEXT.noData)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/accura|guarantee[ds]? (that|future)|predicts/iu);
    expect(screen.getByRole('link', { name: OUTLOOK_TEXT.nav })).toBeInTheDocument();

    await u.selectOptions(await screen.findByLabelText(OUTLOOK_TEXT.fscTable), U(600));
    expect(await screen.findByText('$0.83 per mile ($0.79 per mile - $0.87 per mile)')).toBeInTheDocument();
    expect(container.textContent).toContain('Acme FSC: $0.84 per mile at the latest price.');
    expect(calls).toContain(`/api/v1/outlook?fscTableId=${U(600)}`);
  });

  it('flags off: no Outlook or Fuel tables link', async () => {
    const { fetchImpl } = setup('VIEWER', { ...FLAGS_ON, 'intelligence.cost_outlook': false, 'intelligence.fuel_check': false });
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/claims']} />);
    expect(await screen.findByRole('link', { name: 'Claims' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: OUTLOOK_TEXT.nav })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Fuel tables' })).toBeNull();
  });
});
