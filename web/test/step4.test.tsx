/**
 * Step 4 web units (B6, A8.7, A12.10): navigation per role, Dev dashboard sections (fixed texts, "Fixed
 * rules"/"None", flag dialog with stale handling, evaluation formatting), Recovery intelligence and claim
 * sheet tabs with hostile strings, API key secret handling, error mapping and a forbidden-string sweep.
 */
import { PERMISSION_MATRIX, ROLES, type Role } from '@fr/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ApiError, step4ErrorText } from '../src/api/client';
import { NEVER_USED_LABEL, NO_EXPIRY_LABEL } from '../src/features/apikeys/ApiKeysPage';
import { AppRoot } from '../src/app-root';
import { computeMsText } from '../src/features/intelligence/ClaimIntelligenceTabs';
import { LOG_CELL_MAX_CHARS, clipText } from '../src/features/dev/LogsPanel';
import { notRankedText } from '../src/features/intelligence/IntelligencePage';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HOSTILE = '<script>alert(1)</script><img src=x onerror=alert(1)> ‮evil‬';
const FORBIDDEN = [/neural mesh/iu, /hebbian/iu, /solved-problems cache/iu, /ai-powered/iu, /faster than/iu, /\d+(\.\d+)?\s*[x×]\s*faster/iu, /\d+(\.\d+)?\s*%\s*accura/iu];

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
const notFound = () => json(404, { error: { code: 'not_found', message: 'Not found.', requestId: 'r' } });

function userFor(role: Role) {
  const platform = role === 'PLATFORM_DEV' || role === 'SUPER_ADMIN';
  return { id: U(1), email: 'u@x.test', name: 'Test User', role, tenant: platform ? null : { id: U(90), name: 'Acme (synthetic)' }, mfaEnabled: true };
}

type Handler = (u: string, init?: RequestInit) => Response | undefined;
function appFor(role: Role, handler: Handler, flags = { 'intelligence.provenance': true, 'intelligence.similar_claims': true, 'intelligence.worklist': true }) {
  const user = userFor(role);
  const calls: { url: string; init?: RequestInit | undefined }[] = [];
  const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u === '/api/v1/auth/csrf') return json(200, { csrfToken: 'n.sig' });
    if (u === '/api/v1/auth/refresh') return json(200, { accessToken: 't', tokenType: 'Bearer', expiresIn: 600, user });
    if (u === '/api/v1/me') return json(200, { user, permissions: [...PERMISSION_MATRIX[role]] });
    if (u === '/api/v1/features') return json(200, { flags });
    if (u.startsWith('/api/v1/approvals')) return json(200, { items: [], page: 1, pageSize: 25, total: 0 });
    return handler(u, init) ?? notFound();
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

function sweep(text: string) {
  for (const re of FORBIDDEN) expect([re.source, re.test(text)]).toEqual([re.source, false]);
}

const buckets = (n: number) => [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, null].map((leMs, i) => ({ leMs, count: i === 0 ? n : 0 }));

describe('navigation per role (all 8 roles)', () => {
  it('shows tenant links to tenant roles, Dev dashboard to platform:health holders, API keys to OWNER/ADMIN', async () => {
    for (const role of ROLES) {
      const { fetchImpl } = appFor(role, (u) => (u.startsWith('/api/v1/claims') ? json(200, { items: [], page: 1, pageSize: 25, total: 0 }) : undefined));
      const { unmount } = render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/claims']} />);
      const nav = await screen.findByRole('navigation', { name: 'Main' });
      const platform = role === 'PLATFORM_DEV' || role === 'SUPER_ADMIN';
      if (!platform) await within(nav).findByRole('link', { name: 'Intelligence' });
      const names = within(nav)
        .queryAllByRole('link')
        .map((l) => l.textContent?.trim() ?? '');
      expect([role, names.includes('Dev dashboard')]).toEqual([role, platform]);
      expect([role, names.some((n) => n.startsWith('Claims'))]).toEqual([role, !platform]);
      expect([role, names.includes('Intelligence')]).toEqual([role, !platform]);
      expect([role, names.includes('API keys')]).toEqual([role, role === 'OWNER' || role === 'ADMIN']);
      unmount();
    }
  });

  it('hides Intelligence when the worklist flag is off and when /features fails (fail closed)', async () => {
    const off = appFor('VIEWER', () => undefined, { 'intelligence.provenance': true, 'intelligence.similar_claims': true, 'intelligence.worklist': false });
    const a = render(<AppRoot fetchImpl={off.fetchImpl} initialEntries={['/approvals']} />);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    await screen.findByText('Nothing is waiting for review.');
    expect(within(nav).queryByRole('link', { name: 'Intelligence' })).toBeNull();
    a.unmount();
    const failing = appFor('VIEWER', () => undefined);
    const wrapped = (async (url: RequestInfo | URL, init?: RequestInit) => (String(url) === '/api/v1/features' ? json(500, {}) : failing.fetchImpl(url, init))) as typeof fetch;
    render(<AppRoot fetchImpl={wrapped} initialEntries={['/approvals']} />);
    const nav2 = await screen.findByRole('navigation', { name: 'Main' });
    await screen.findByText('Nothing is waiting for review.');
    expect(within(nav2).queryByRole('link', { name: 'Intelligence' })).toBeNull();
  });

  it('redirects tenant users away from /dev', async () => {
    const { fetchImpl } = appFor('OWNER', (u) => (u.startsWith('/api/v1/claims') ? json(200, { items: [], page: 1, pageSize: 25, total: 0 }) : undefined));
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/dev/pipeline']} />);
    await screen.findByRole('navigation', { name: 'Main' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Dev dashboard' })).toBeNull());
  });
});

const telemetry = {
  scope: 'this_instance_since_start',
  generatedAt: '2026-10-09T12:00:00.000Z',
  instance: { startedAt: '2026-10-09T11:00:00.000Z', uptimeSeconds: 3600, version: '0.1.0', nodeVersion: 'v22' },
  requests: { total: 3, byStatusClass: { '2xx': 3, '3xx': 0, '4xx': 0, '5xx': 0 }, unauthenticated401: 0, forbidden403: 0, rateLimited429: 0 },
  routes: [{ method: 'GET', route: '/api/v1/claims', count: 3, byStatusClass: { '2xx': 3, '3xx': 0, '4xx': 0, '5xx': 0 }, durationBuckets: buckets(3), p50UpperBoundMs: 5, p95UpperBoundMs: 5 }],
  parser: { jobs: 0, succeeded: 0, rejected: 0, timeouts: 0, memoryKills: 0, failures: 0, busyRejections: 0, avgQueueWaitMs: null },
  components: [
    { id: 'priority-v1', method: 'fixed_rules', learnedModel: false, enabled: true, calls: 0, errors: 0, durationBuckets: buckets(0), p50UpperBoundMs: null, p95UpperBoundMs: null, avgCandidatesConsidered: null },
    { id: 'similar-v1', method: 'fixed_rules', learnedModel: false, enabled: true, calls: 0, errors: 0, durationBuckets: buckets(0), p50UpperBoundMs: null, p95UpperBoundMs: null, avgCandidatesConsidered: null },
  ],
};

const flag = (version: number, enabled: boolean) => ({
  key: 'intelligence.worklist',
  description: 'Prioritised worklist page',
  enabled,
  defaultEnabled: true,
  tenantVisible: true,
  version,
  updatedAt: null,
  updatedBy: null,
  lastReason: null,
});

const run = {
  id: U(77),
  basis: 'synthetic_fixtures',
  evalSetId: 'mini',
  evalSetVersion: '1',
  evalSetSha256: 'a'.repeat(64),
  stage: 'extraction',
  k: 3,
  startedAt: '2026-10-09T12:00:00.000Z',
  finishedAt: '2026-10-09T12:01:00.000Z',
  gitSha: null,
  providerName: 'deterministic',
  providerVersion: '1',
  parserVersion: '1',
  cases: 12,
  runsTotal: 36,
  runsPassed: 15,
  perRunPassRate: 0.416667,
  passHatKCount: 5,
  passHatK: 0.416667,
  passAtLeastOneCount: 5,
  flakyCaseCount: 0,
  alwaysFailCount: 7,
  deterministicCases: 12,
  wilson95: { low: 0.19326, high: 0.680489 },
  passPowCurve: [0.416667, 0.416667, 0.416667],
  durationMs: { p50: 1, p95: 2 },
};

describe('Dev dashboard', () => {
  it('telemetry renders fixed rules / no learned model and the instance note', async () => {
    const { fetchImpl } = appFor('PLATFORM_DEV', (u) => (u === '/api/v1/platform/telemetry' ? json(200, telemetry) : undefined));
    const { container } = render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/dev/telemetry']} />);
    expect(await screen.findByRole('heading', { name: 'Request telemetry' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Intelligence components' });
    expect(within(table).getAllByText('Fixed rules')).toHaveLength(2);
    expect(within(table).getAllByText('None')).toHaveLength(2);
    expect(screen.getByText('Counters cover this API instance since it started and reset on restart.')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Dev sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Telemetry' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Audit' })).toBeNull();
    sweep(container.textContent ?? '');
  });

  it('/dev redirects to the first permitted tab; SUPER_ADMIN sees pipeline, telemetry and audit only', async () => {
    const { fetchImpl } = appFor('SUPER_ADMIN', () => undefined);
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/dev']} />);
    expect(await screen.findByRole('tab', { name: 'Pipeline health' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Pipeline health', 'Telemetry', 'Audit']);
  });

  it('logs: invalid request id shows the fixed alert and sends no request', async () => {
    const { fetchImpl, calls } = appFor('PLATFORM_DEV', (u) =>
      u.startsWith('/api/v1/platform/logs') ? json(200, { scope: 'this_instance_recent_window', bufferCapacity: 500, returned: 0, oldestTime: null, items: [] }) : undefined,
    );
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/dev/logs']} />);
    expect(await screen.findByText('No records match.')).toBeInTheDocument();
    const before = calls.filter((c) => c.url.startsWith('/api/v1/platform/logs')).length;
    await user.type(screen.getByRole('textbox', { name: 'Request ID' }), 'not-a-uuid');
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid request ID.');
    expect(calls.filter((c) => c.url.startsWith('/api/v1/platform/logs')).length).toBe(before);
  });

  it('logs: a 10,000-character event (and long route/request values) render clipped as inert text, never crash', async () => {
    const longEvent = `<script>alert(1)</script><img src=x onerror=alert(1)>${'E'.repeat(10_000)}`;
    const rec = (event: string, extra: Record<string, unknown> = {}) => ({
      time: '2026-10-09T12:00:00.000Z',
      level: 'info',
      requestId: null,
      method: 'GET',
      route: '/api/v1/claims',
      statusCode: 200,
      durationMs: 1.5,
      event,
      ...extra,
    });
    const items = [rec(longEvent), rec('request completed', { requestId: 'R'.repeat(5000), route: `/${'p'.repeat(5000)}` })];
    const { fetchImpl } = appFor('PLATFORM_DEV', (u) =>
      u.startsWith('/api/v1/platform/logs') ? json(200, { scope: 'this_instance_recent_window', bufferCapacity: 500, returned: 2, oldestTime: items[0]?.time, items }) : undefined,
    );
    const { container } = render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/dev/logs']} />);
    const table = await screen.findByRole('table', { name: 'Log records' });
    expect(screen.queryByText(/Reload the page to continue/u)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    const cells = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell'));
    const eventText = cells[0]?.[6]?.textContent ?? '';
    expect(Array.from(eventText).length).toBe(LOG_CELL_MAX_CHARS + 1);
    expect(eventText.endsWith('…')).toBe(true);
    expect(eventText.startsWith('<script>alert(1)</script>')).toBe(true);
    expect(container.querySelector('script, img')).toBeNull();
    expect(Array.from(cells[1]?.[2]?.textContent ?? '').length).toBeLessThanOrEqual(65);
    expect(Array.from(cells[1]?.[3]?.textContent ?? '').length).toBe(LOG_CELL_MAX_CHARS + 1);
    expect(clipText('abc', 3)).toBe('abc');
    expect(clipText('abcd', 3)).toBe('abc…');
  });

  it('flags: confirm needs a 10-character reason, stale version shows the fixed alert, success toasts', async () => {
    let version = 3;
    let mode: 'stale' | 'ok' = 'stale';
    const { fetchImpl, calls } = appFor('PLATFORM_DEV', (u, init) => {
      if (u === '/api/v1/platform/flags') return json(200, { items: [flag(version, true)] });
      if (u === '/api/v1/platform/flags/intelligence.worklist' && init?.method === 'PUT') {
        if (mode === 'stale') {
          version = 4;
          return json(409, { error: { code: 'stale_revision', message: 'x', requestId: 'r' } });
        }
        version += 1;
        return json(200, flag(version, false));
      }
      return undefined;
    });
    const user = userEvent.setup();
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/dev/flags']} />);
    const sw = await screen.findByRole('switch', { name: 'intelligence.worklist' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await user.click(sw);
    const dialog = await screen.findByRole('dialog', { name: 'Change intelligence.worklist' });
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), '   short   ');
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Incident 42 mitigation');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This flag changed. Reload to continue.');
    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(JSON.parse(String(put?.init?.body))).toEqual({ enabled: false, expectedVersion: 3, reason: 'short   Incident 42 mitigation' });
    expect((put?.init?.headers as Record<string, string>)['x-csrf-token']).toBeTruthy();
    // No optimistic update: the switch still shows the server state.
    expect(screen.getByRole('switch', { name: 'intelligence.worklist' })).toHaveAttribute('aria-checked', 'true');
    mode = 'ok';
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('switch', { name: 'intelligence.worklist' }));
    const d2 = await screen.findByRole('dialog', { name: 'Change intelligence.worklist' });
    await user.type(within(d2).getByRole('textbox', { name: 'Reason' }), 'Incident 42 mitigation');
    await user.click(within(d2).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Flag updated')).toBeInTheDocument();
  });

  it('evaluation: percentages with one decimal, Wilson interval, deterministic note iff all cases deterministic', async () => {
    const detail = { ...run, results: [{ caseId: 'a', category: 'c', runsPassed: 3, k: 3, passedAll: true, distinctOutputs: 1, firstFailureCode: null, medianDurationMs: 1 }] };
    const { fetchImpl } = appFor('PLATFORM_DEV', (u) => {
      if (u === '/api/v1/platform/eval/runs') return json(200, { items: [run] });
      if (u === `/api/v1/platform/eval/runs/${run.id}`) return json(200, detail);
      return undefined;
    });
    const user = userEvent.setup();
    const { container } = render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/dev/evaluation']} />);
    const table = await screen.findByRole('table', { name: 'Runs' });
    expect(within(table).getByText('41.7%')).toBeInTheDocument();
    await user.click(within(table).getByRole('button', { name: 'Details' }));
    const dialog = await screen.findByRole('dialog', { name: `Run ${run.id.slice(0, 8)}` });
    expect(within(dialog).getByText('19.3% - 68.0%')).toBeInTheDocument();
    expect(within(dialog).getByText('Every case produced identical output on all runs, so pass^k equals pass^1 for this deterministic pipeline.')).toBeInTheDocument();
    expect(within(dialog).getByRole('table', { name: 'Case results' })).toBeInTheDocument();
    sweep(container.textContent ?? '');
  });
});

const worklistItem = (n: number, extra: Record<string, unknown> = {}) => ({
  rank: n,
  claim: {
    id: U(100 + n),
    claimNumber: `CLM-${n} ${HOSTILE}`,
    loadNumber: null,
    carrierName: HOSTILE,
    perspective: 'SHIPPER',
    status: 'PENDING_REVIEW',
    recoverableCents: 123456,
    pendingReviewCents: 5000,
    currency: 'USD',
    assignee: null,
    latestPacket: { revision: 1, status: 'PENDING_REVIEW' },
  },
  score: {
    version: 'priority-v1',
    valueCents: 124706,
    parts: [
      { key: 'confirmed_recoverable', inputCents: 123456, weightPercent: 100, contributionCents: 123456 },
      { key: 'pending_review', inputCents: 5000, weightPercent: 25, contributionCents: 1250 },
    ],
  },
  why: ['Confirmed recoverable $1,234.56 (counted at 100%)', 'Waiting 1 day (not part of the score)'],
  nextAction: 'RESOLVE_FINDINGS',
  pendingFindingsCount: 1,
  waitingSince: '2026-10-08T12:00:00.000Z',
  waitingDays: 1,
  ...extra,
});

describe('Recovery intelligence', () => {
  it('renders the worklist with fixed notes, the formula W, hostile strings as text and the not-ranked line', async () => {
    const { fetchImpl } = appFor('VIEWER', (u) =>
      u.startsWith('/api/v1/intelligence/worklist')
        ? json(200, {
            generatedAt: '2026-10-09T12:00:00.000Z',
            formula: { version: 'priority-v1', pendingWeightPercent: 30 },
            label: 'x',
            notRanked: { awaitingAnalysis: 1 },
            items: [worklistItem(1)],
            page: 1,
            pageSize: 25,
            total: 1,
          })
        : undefined,
    );
    const { container } = render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/intelligence']} />);
    expect(await screen.findByRole('heading', { name: 'Recovery intelligence' })).toBeInTheDocument();
    const how = screen.getByRole('region', { name: 'How this works' });
    expect(await within(how).findByText(/plus 30% of the amount still pending human review/u)).toBeInTheDocument();
    expect(within(how).getByText('No accuracy figures are shown because none have been measured on real customer data.')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Prioritised worklist' });
    expect(within(table).getByText('$1,247.06')).toBeInTheDocument();
    expect(within(table).getByText('Resolve findings')).toBeInTheDocument();
    expect(within(table).getByText('1 day')).toBeInTheDocument();
    expect(screen.getByText('Not ranked: 1 claim awaiting analysis')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).not.toContain('‮');
    sweep(container.textContent ?? '');
  });

  it('empty state and fixed error texts', async () => {
    const { fetchImpl } = appFor('VIEWER', (u) => (u.startsWith('/api/v1/intelligence/worklist') ? json(429, { error: { code: 'rate_limited', message: 'server text', requestId: 'r' } }, { 'retry-after': '5' }) : undefined));
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/intelligence']} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Try again shortly.');
    expect(screen.queryByText('server text')).toBeNull();
  });

  it('helpers', () => {
    expect(notRankedText(0)).toBeNull();
    expect(notRankedText(2)).toBe('Not ranked: 2 claims awaiting analysis');
    expect(computeMsText(3.456)).toBe('3.5');
    expect(computeMsText(2)).toBe('2');
    expect(step4ErrorText(new ApiError(404, 'not_found', 'x'))).toBe('Not available.');
    expect(step4ErrorText(new ApiError(403, 'forbidden', 'x'))).toBe('Not available.');
    expect(step4ErrorText(new ApiError(500, 'internal_error', 'x'))).toBe('Something went wrong.');
    expect(step4ErrorText(new Error('boom'))).toBe('Something went wrong.');
  });
});

describe('claim sheet Similar and Provenance tabs', () => {
  const claim = {
    id: U(500),
    claimNumber: 'CLM-0500',
    loadNumber: null,
    invoiceNumber: null,
    carrierName: 'Carrier',
    shipperName: 'Shipper',
    perspective: 'SHIPPER',
    status: 'PENDING_REVIEW',
    amountClaimedCents: 1,
    recoverableCents: 1,
    pendingReviewCents: 0,
    currency: 'USD',
    assignee: null,
    latestPacket: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    invoiceDate: null,
  };
  const handler: Handler = (u) => {
    if (u.startsWith('/api/v1/claims?')) return json(200, { items: [claim], page: 1, pageSize: 25, total: 1 });
    if (u === `/api/v1/claims/${claim.id}`) return json(200, claim);
    if (u.startsWith(`/api/v1/claims/${claim.id}/similar`))
      return json(200, {
        claimId: claim.id,
        version: 'similar-v1',
        weights: { sameCarrier: 35, sharedRules: 40, similarAmount: 15, samePerspective: 10 },
        minPercent: 30,
        label: 'x',
        reason: null,
        candidatesConsidered: 17,
        computeMs: 3.456,
        items: [
          {
            claim: { id: U(501), claimNumber: `CLM-0501 ${HOSTILE}`, carrierName: HOSTILE, perspective: 'SHIPPER', status: 'APPROVED', recoverableCents: 1, pendingReviewCents: 0, updatedAt: '2026-10-01T00:00:00.000Z' },
            similarityPercent: 92,
            matches: [
              { key: 'same_carrier', points: 35, detail: 'Same carrier' },
              { key: 'shared_rules', points: 40, detail: `Shared rules: ${HOSTILE}` },
            ],
            handling: { finalStatus: 'APPROVED', ruleIds: [], sourceDocTypes: [], findingCount: 1, decidedAt: null },
          },
        ],
      });
    if (u === `/api/v1/claims/${claim.id}/provenance`)
      return json(200, {
        claimId: claim.id,
        basis: 'rule_based_parse_score',
        label: 'x',
        documents: [
          {
            documentId: U(600),
            displayName: `${HOSTILE}.csv`,
            docType: 'INVOICE',
            status: 'ACCEPTED',
            extractedFieldCount: 3,
            manualFieldCount: 1,
            byFieldStatus: { PROPOSED: 1, CONFIRMED: 1, CORRECTED: 1, REJECTED: 1 },
            unresolvedFlaggedCount: 1,
            minConfidence: 0.62,
          },
        ],
        totals: { documents: 1, fields: 4, manualFields: 1, proposed: 1, confirmed: 1, corrected: 1, rejected: 1, unresolvedFlagged: 1 },
      });
    return undefined;
  };

  it('renders similar items, the compute line and the provenance table', async () => {
    const { fetchImpl } = appFor('VIEWER', handler);
    const user = userEvent.setup();
    const { container } = render(<AppRoot fetchImpl={fetchImpl} initialEntries={[`/claims/${claim.id}`]} />);
    await user.click(await screen.findByRole('tab', { name: 'Similar' }));
    expect(await screen.findByRole('heading', { name: 'Similar past claims' })).toBeInTheDocument();
    expect(screen.getByText('92% similar')).toBeInTheDocument();
    expect(screen.getByText('Handled as APPROVED')).toBeInTheDocument();
    expect(screen.getByText('Computed in 3.5 ms over 17 claims')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Why similar' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Provenance' }));
    const table = await screen.findByRole('table', { name: 'Source documents' });
    expect(within(table).getByText('62.0%')).toBeInTheDocument();
    expect(screen.getByText('Confidence is a rule-based parse score, not an accuracy measure.')).toBeInTheDocument();
    expect(container.ownerDocument.querySelector('script')).toBeNull();
    sweep(container.ownerDocument.body.textContent ?? '');
  });

  it('hides the tabs when the flags are off', async () => {
    const { fetchImpl } = appFor('VIEWER', handler, { 'intelligence.provenance': false, 'intelligence.similar_claims': false, 'intelligence.worklist': true });
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={[`/claims/${claim.id}`]} />);
    expect(await screen.findByRole('tab', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Similar' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Provenance' })).toBeNull();
  });
});

describe('API keys page', () => {
  it('Last used shows "Never" for a never-used key; Expires has its own label for a non-expiring key', async () => {
    const base = {
      scopes: ['claims.read'],
      createdBy: { id: U(1), name: 'Test User' },
      createdAt: '2026-10-09T12:00:00.000Z',
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
      status: 'ACTIVE',
    };
    const items = [
      { ...base, id: U(710), keyId: `fr_live_${'b'.repeat(16)}`, name: 'unused', expiresAt: null, lastUsedAt: null },
      { ...base, id: U(711), keyId: `fr_live_${'c'.repeat(16)}`, name: 'used', expiresAt: '2027-01-07T12:00:00.000Z', lastUsedAt: '2026-10-09T13:00:00.000Z' },
    ];
    const { fetchImpl } = appFor('OWNER', (u) => (u === '/api/v1/api-keys' ? json(200, { items }) : undefined));
    render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/settings/api-keys']} />);
    const table = await screen.findByRole('table', { name: 'API keys' });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    const col = (name: string) => headers.indexOf(name);
    const rows = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));
    expect(rows[0]?.[col('Last used')]).toBe(NEVER_USED_LABEL);
    expect(NEVER_USED_LABEL).toBe('Never');
    expect(rows[0]?.[col('Expires')]).toBe(NO_EXPIRY_LABEL);
    expect(rows[1]?.[col('Last used')]).toMatch(/2026.*UTC/u);
    expect(rows[1]?.[col('Expires')]).toMatch(/2027.*UTC/u);
    expect(rows.flat().some((t) => t === '—')).toBe(false);
  });

  it('shows the secret once, never in storage or cache, and clears it on Done', async () => {
    const secret = `fr_live_${'a'.repeat(16)}_${'S'.repeat(43)}`;
    const view = {
      id: U(700),
      keyId: `fr_live_${'a'.repeat(16)}`,
      name: 'ci',
      scopes: ['claims.read'],
      createdBy: { id: U(1), name: 'Test User' },
      createdAt: '2026-10-09T12:00:00.000Z',
      expiresAt: '2027-01-07T12:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
      status: 'ACTIVE',
    };
    let items: unknown[] = [];
    const { fetchImpl, calls } = appFor('OWNER', (u, init) => {
      if (u === '/api/v1/api-keys' && init?.method === 'POST') {
        items = [view];
        return json(201, { key: view, secret });
      }
      if (u === '/api/v1/api-keys') return json(200, { items });
      return undefined;
    });
    const user = userEvent.setup();
    const { container } = render(<AppRoot fetchImpl={fetchImpl} initialEntries={['/settings/api-keys']} />);
    expect(await screen.findByText('No API keys yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create API key' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create API key' });
    const create = within(dialog).getByRole('button', { name: 'Create key' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'ci');
    expect(create).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Read claims' }));
    expect(within(dialog).getByRole('combobox', { name: 'Expires' })).toHaveValue('90');
    await user.click(create);
    const shown = await screen.findByRole('dialog', { name: 'API key created' });
    expect(within(shown).getByRole('textbox', { name: 'API key secret' })).toHaveValue(secret);
    expect(within(shown).getByText('This key will not be shown again.')).toBeInTheDocument();
    await user.click(within(shown).getByRole('button', { name: 'Copy' }));
    expect(await within(shown).findByRole('status')).toHaveTextContent(/Copied|Copy is not available/u);
    await user.click(within(shown).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('table', { name: 'API keys' })).toBeInTheDocument();
    expect(container.ownerDocument.body.textContent ?? '').not.toContain('S'.repeat(43));
    expect([...container.ownerDocument.querySelectorAll('input')].some((i) => i.value.includes('fr_live_'))).toBe(false);
    expect(window.location.href).not.toContain('fr_live_');
    expect(JSON.stringify(window.localStorage)).not.toContain('fr_live_');
    expect(JSON.stringify(window.sessionStorage)).not.toContain('fr_live_');
    const post = calls.find((c) => c.init?.method === 'POST' && c.url === '/api/v1/api-keys');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ name: 'ci', scopes: ['claims.read'], expiresInDays: 90 });
    // Revoke requires a 10-character reason.
    await user.click(screen.getByRole('button', { name: 'Revoke ci' }));
    const rv = await screen.findByRole('dialog', { name: 'Revoke ci' });
    expect(within(rv).getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await user.type(within(rv).getByRole('textbox', { name: 'Reason' }), 'rotation now');
    expect(within(rv).getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });
});
