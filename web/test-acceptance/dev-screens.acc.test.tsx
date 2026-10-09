/* eslint-disable */
// T-WEB-02 pipeline, T-WEB-03 telemetry, T-WEB-04 logs.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, devStub, logRecord, logs, pipeline, telemetry, buckets } from './helpers/dev-stub.js';
import { renderApp, setupDom, signedIn } from './helpers/render.js';
import type { RoleName } from './helpers/stub.js';

setupDom();
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const WAIT = { timeout: 5000 };
const NOTES = {
  pipeline: 'Aggregates across all tenants. No customer data is shown. Files rejected before storage appear only in request telemetry.',
  telemetry: 'Counters cover this API instance since it started and reset on restart.',
  logs: 'Recent records from this API instance only. Messages and fields are filtered; customer data is never shown.',
};
const FORBIDDEN_TEXT = /neural mesh|hebbian|solved-problems cache|ai-powered|faster than|\d+(\.\d+)?\s*[x\u00d7]\s*(faster|speed)|\d+(\.\d+)?\s*%\s*accura|accuracy of \d/i;
async function open(role: RoleName, path: string, setup?: (s: ReturnType<typeof devStub>) => void) {
  const stub = devStub({ role });
  setup?.(stub);
  const r = await renderApp(stub, [path]);
  await signedIn().catch(() => undefined);
  return { stub, ...r };
}
const body = () => document.body.textContent ?? '';
const rowsOf = (table: HTMLElement) => within(table).getAllByRole('row').slice(1).map((r) => r.textContent ?? '');
const headers = (table: HTMLElement) => within(table).getAllByRole('columnheader').map((h) => h.textContent);
const err = (status: number, code: string) => json(status, { error: { code, message: 'SECRET-LEAK server message', requestId: 'r' } });

describe('T-WEB-02 pipeline screen', () => {
  it('shows the note, the counts, the parse time and the queue values', async () => {
    const { stub } = await open('PLATFORM_DEV', '/dev/pipeline');
    await screen.findByRole('heading', { name: 'Pipeline health' }, WAIT);
    expect(await screen.findByText(NOTES.pipeline, {}, WAIT)).toBeTruthy();
    const byStatus = screen.getByRole('table', { name: 'Documents by status' });
    const text = rowsOf(byStatus).join('|');
    for (const [re, n] of [[/received/i, 2], [/needs[ _]review/i, 1], [/accepted/i, 2], [/rejected/i, 3], [/failed/i, 0]] as Array<[RegExp, number]>) {
      const cellRows = within(byStatus).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent ?? ''));
      expect(cellRows.some((c) => re.test(c[0]!) && c[1] === String(n)), `${re} -> ${n} in ${text}`).toBe(true);
    }
    const reasons = rowsOf(screen.getByRole('table', { name: 'Rejected by reason' })).join('|');
    expect(reasons).toMatch(/malformed_pdf/);
    expect(reasons).toMatch(/trailing_data/);
    expect(body()).toMatch(/Upload-to-parse time\W{0,6}p50 120 ms, p95 480 ms \(5 documents\)/);
    expect(body()).toMatch(/Review queue depth\W{0,6}7/);
    expect(body()).toMatch(/Awaiting analysis\W{0,6}4/);
    expect(body()).toContain('Oldest waiting');
    expect(screen.getAllByRole('status').some((e) => e.textContent?.trim() === 'Database ok')).toBe(true);
    expect(stub.calls.filter((c) => /platform\/pipeline$/.test(c.path)).length).toBe(1);
  });
  it('empty states, zero rows and a down database', async () => {
    await open('PLATFORM_DEV', '/dev/pipeline', (s) => s.on('GET', /\/platform\/pipeline$/, () => json(200, pipeline({
      db: 'down', uploadToParseMs: { n: 0, p50: null, p95: null },
      documents: { total: 0, byStatus: { RECEIVED: 0, NEEDS_REVIEW: 0, ACCEPTED: 0, REJECTED: 0, FAILED: 0 }, byDetectedType: { PDF: 0, PNG: 0, JPEG: 0, CSV: 0, TXT: 0 }, rejectedByReason: [] },
      rates: { rejected: null, failed: null, needsReview: null },
    }))));
    await screen.findByRole('heading', { name: 'Pipeline health' }, WAIT);
    expect(await screen.findByText('No documents in this window', {}, WAIT)).toBeTruthy();
    expect(screen.getAllByRole('status').some((e) => e.textContent?.trim() === 'Database down')).toBe(true);
    for (const r of within(screen.getByRole('table', { name: 'Documents by status' })).getAllByRole('row').slice(1)) expect(within(r).getAllByRole('cell')[1]!.textContent).toBe('0');
    expect(screen.getByRole('table', { name: 'Rejected by reason' }).textContent).toMatch(/no |none|nothing/i);
  });
  it('the window selector and Refresh refetch; nothing refreshes by itself', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout', 'clearInterval', 'clearTimeout'], shouldAdvanceTime: true });
    const { stub, user } = await open('PLATFORM_DEV', '/dev/pipeline');
    await screen.findByRole('heading', { name: 'Pipeline health' }, WAIT);
    const calls = () => stub.calls.filter((c) => /platform\/pipeline$/.test(c.path));
    await waitFor(() => expect(calls().length).toBe(1), WAIT);
    const sel = screen.getByRole('combobox', { name: 'Time window' });
    expect([...within(sel).getAllByRole('option')].map((o) => o.textContent)).toEqual(['1 hour', '24 hours', '7 days']);
    await user.selectOptions(sel, '7 days');
    await waitFor(() => expect(calls().at(-1)!.query.get('window')).toBe('7d'), WAIT);
    const n = calls().length;
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(calls().length).toBe(n + 1), WAIT);
    const before = calls().length;
    await act(async () => { vi.advanceTimersByTime(10 * 60 * 1000); });
    expect(calls().length).toBe(before);
  });
});

describe('T-WEB-03 telemetry screen', () => {
  it('documented tables; absent bounds are never rendered as null, undefined, Infinity or NaN; components are labelled fixed rules with no learned model', async () => {
    await open('PLATFORM_DEV', '/dev/telemetry');
    await screen.findByRole('heading', { name: 'Request telemetry' }, WAIT);
    expect(await screen.findByText(NOTES.telemetry, {}, WAIT)).toBeTruthy();
    const routes = screen.getByRole('table', { name: 'Routes' });
    expect(headers(routes)).toEqual(['Method', 'Route', 'Requests', '2xx', '4xx', '5xx', 'p50 bound (ms)', 'p95 bound (ms)']);
    expect(routes.textContent).toContain('/api/v1/claims/:id');
    expect(routes.textContent).toContain('/healthz');
    expect(screen.getByRole('table', { name: 'Parser' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Intelligence components' })).toBeTruthy();
    const comps = screen.getByRole('table', { name: 'Intelligence components' });
    expect(headers(comps)).toEqual(['Component', 'Method', 'Learned model', 'Enabled', 'Calls', 'Errors', 'p50 bound (ms)', 'p95 bound (ms)']);
    const rows = within(comps).getAllByRole('row').slice(1);
    expect(rows.length).toBe(2);
    for (const r of rows) {
      const cells = within(r).getAllByRole('cell').map((c) => c.textContent);
      expect(cells[1]).toBe('Fixed rules');
      expect(cells[2]).toBe('None');
      expect(cells[3]).toMatch(/^(yes|no)$/i);
    }
    expect(rows[0]!.textContent).toMatch(/priority-v1/);
    expect(rows[1]!.textContent).toMatch(/similar-v1/);
    expect(document.body.textContent).not.toMatch(/\b(null|undefined|Infinity|NaN)\b/);
    expect(FORBIDDEN_TEXT.test(body())).toBe(false);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  });
});

describe('T-WEB-04 logs screen', () => {
  const HOSTILE = ['<img src=x onerror=alert(1)>', '<script>window.__pwned = 1</script>', 'E'.repeat(10000), 'bidi \u202eevil\u2066 text'];
  it('renders controls and records; hostile strings stay inert text', async () => {
    // Q5.3: a contract-valid event has at most 80 characters; it must always be shown in full.
    const MAX_VALID = 'abcd efgh:'.repeat(8);
    const items = [...HOSTILE, MAX_VALID].map((e, i) => logRecord(i, { event: e }));
    const { stub } = await open('PLATFORM_DEV', '/dev/logs', (s) => s.on('GET', /\/platform\/logs$/, () => json(200, logs(items))));
    await screen.findByRole('heading', { name: 'Recent logs' }, WAIT);
    expect(await screen.findByText(NOTES.logs, {}, WAIT)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Minimum level' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Request ID' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Log records' }, WAIT);
    expect(headers(table)).toEqual(['Time', 'Level', 'Request', 'Route', 'Status', 'Duration', 'Event']);
    expect(rowsOf(table).length).toBe(5);
    expect(table.querySelector('img, script, iframe, object')).toBeNull();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
    expect(table.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(table.textContent).toContain('<script>window.__pwned = 1</script>');
    expect(table.textContent).toContain(MAX_VALID);
    // The 10 000-character event (out of contract, Q5.3 caps events at 80 characters) must render as
    // inert text without breaking the screen. T-WEB-04 does not require the full value on screen, so a
    // display clip is accepted provided it is a plain prefix of the value and never shorter than the
    // longest contract-valid event (80 characters). Layout (wrapping, no horizontal scroll) is not
    // observable in jsdom.
    const longCell = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').at(-1)!.textContent ?? '').find((t) => t.startsWith('EEEE'));
    expect(longCell, 'the long event row is rendered').toBeTruthy();
    const run = /^E+/.exec(longCell!)![0].length;
    expect(run).toBeGreaterThanOrEqual(80);
    expect(run).toBeLessThanOrEqual(10000);
    expect(longCell!.slice(run).replace(/[….\s]/g, ''), 'only an ellipsis may follow the clipped value').toBe('');
    expect(stub.calls.filter((c) => /platform\/logs$/.test(c.path)).length).toBe(1);
  });
  it('level change refetches; an invalid request id is refused locally; a valid one is sent', async () => {
    const { stub, user } = await open('PLATFORM_DEV', '/dev/logs');
    await screen.findByRole('table', { name: 'Log records' }, WAIT);
    const calls = () => stub.calls.filter((c) => /platform\/logs$/.test(c.path));
    const n = calls().length;
    await user.selectOptions(screen.getByRole('combobox', { name: 'Minimum level' }), 'warn');
    await waitFor(() => expect(calls().length).toBeGreaterThan(n), WAIT);
    expect(calls().at(-1)!.query.get('level')).toBe('warn');
    const box = screen.getByRole('textbox', { name: 'Request ID' });
    const m = calls().length;
    await user.type(box, 'not-a-uuid');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect((await screen.findByRole('alert', {}, WAIT)).textContent).toBe('Enter a valid request ID.');
    expect(calls().length).toBe(m);
    expect(calls().some((c) => c.query.has('requestId'))).toBe(false);
    await user.clear(box);
    await user.type(box, '00000000-0000-4000-8000-000000000123');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(calls().at(-1)!.query.get('requestId')).toBe('00000000-0000-4000-8000-000000000123'), WAIT);
  });
  it('empty state and fixed error messages that never echo the server text', async () => {
    await open('PLATFORM_DEV', '/dev/logs', (s) => s.on('GET', /\/platform\/logs$/, () => json(200, logs([]))));
    expect(await screen.findByText('No records match.', {}, WAIT)).toBeTruthy();
    for (const [status, code] of [[403, 'forbidden'], [429, 'rate_limited'], [500, 'internal_error']] as Array<[number, string]>) {
      cleanup();
      await open('PLATFORM_DEV', '/dev/logs', (s) => s.on('GET', /\/platform\/logs$/, () => err(status, code)));
      const a = await screen.findByRole('alert', {}, WAIT);
      expect(a.textContent!.length).toBeGreaterThan(0);
      expect(a.textContent).not.toMatch(/SECRET-LEAK/);
    }
  });
});