/* eslint-disable */
// T-WEB-08 Intelligence page, T-WEB-09 claim sheet tabs (Similar, Provenance).
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { devStub, json, provenance, similar, simItem, wlItem, worklist } from './helpers/dev-stub.js';
import { renderApp, setupDom, signedIn } from './helpers/render.js';
import type { RoleName } from './helpers/stub.js';

setupDom();
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const WAIT = { timeout: 5000 };
const WL = (w: number) => `Ranked by a fixed formula over this tenant's own claim data: confirmed recoverable amount plus ${w}% of the amount still pending human review. This is a work-order aid, not a forecast of what will be recovered.`;
const NO_ACC = 'No accuracy figures are shown because none have been measured on real customer data.';
const SIM_NOTE = "Similar claims are matched by fixed rules on this tenant's own data. Final status shows how your team handled the claim, not whether the carrier paid.";
const PROV_NOTE = 'Confidence is a rule-based parse score, not an accuracy measure.';
const headers = (table: HTMLElement) => within(table).getAllByRole('columnheader').map((h) => h.textContent);
async function open(role: RoleName, path: string, setup?: (s: ReturnType<typeof devStub>) => void, o: Parameters<typeof devStub>[0] = {}) {
  const stub = devStub({ role, ...o });
  setup?.(stub);
  const r = await renderApp(stub, [path]);
  await signedIn().catch(() => undefined);
  return { stub, ...r };
}
const wl = (stub: ReturnType<typeof devStub>) => stub.calls.filter((c) => /intelligence\/worklist$/.test(c.path));

describe('T-WEB-08 Intelligence page', () => {
  it('explains the formula, lists claims with scores, reasons and next actions, and links claim numbers', async () => {
    const items = [
      wlItem(1, 'CLM-0001', { nextAction: 'RESOLVE_FINDINGS', why: ['Confirmed recoverable $1,234.56 (counted at 100%)', 'Pending human review $20.00 (counted at 40%)', '2 findings need human review before approval', 'Waiting 0 days (not part of the score)'] }),
      wlItem(2, 'CLM-0002', { nextAction: 'REVIEW_AND_APPROVE' }),
      wlItem(3, 'CLM-0003', { nextAction: 'MARK_SEND_READY' }),
    ];
    await open('MANAGER', '/intelligence', (s) => s.on('GET', /\/intelligence\/worklist$/, () => json(200, worklist(items, { formula: { version: 'priority-v1', pendingWeightPercent: 40 }, label: WL(40), notRanked: { awaitingAnalysis: 2 } }))));
    await screen.findByRole('heading', { name: 'Recovery intelligence' }, WAIT);
    const region = await screen.findByRole('region', { name: 'How this works' }, WAIT);
    expect(region.textContent).toContain(WL(40));
    expect(region.textContent).toContain(NO_ACC);
    const table = await screen.findByRole('table', { name: 'Prioritised worklist' }, WAIT);
    expect(headers(table)).toEqual(['Rank', 'Claim', 'Carrier', 'Priority score', 'Why', 'Next action', 'Waiting']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.length).toBe(3);
    const first = within(rows[0]!);
    const link = first.getByRole('link', { name: 'CLM-0001' });
    expect(link.getAttribute('href')).toContain('00000000-0000-4000-8000-000000700101');
    expect(rows[0]!.textContent).toContain('$1,234.56');
    for (const line of items[0]!.why) expect(rows[0]!.textContent).toContain(line);
    expect(first.getAllByRole('listitem').length).toBe(4);
    expect(rows[0]!.textContent).toContain('Resolve findings');
    expect(rows[1]!.textContent).toContain('Review and approve');
    expect(rows[2]!.textContent).toContain('Mark send-ready');
    expect(screen.getByText('Not ranked: 2 claims awaiting analysis')).toBeTruthy();
  });
  it('Not ranked wording for one claim and for none', async () => {
    await open('VIEWER', '/intelligence', (s) => s.on('GET', /\/intelligence\/worklist$/, () => json(200, worklist([wlItem(1, 'CLM-0001')], { notRanked: { awaitingAnalysis: 1 } }))));
    expect(await screen.findByText('Not ranked: 1 claim awaiting analysis', {}, WAIT)).toBeTruthy();
    cleanup();
    await open('VIEWER', '/intelligence');
    await screen.findByRole('table', { name: 'Prioritised worklist' }, WAIT);
    expect(document.body.textContent).not.toMatch(/Not ranked/);
  });
  it('perspective filter and pagination refetch with the right query; the empty state is fixed', async () => {
    const { stub, user } = await open('MANAGER', '/intelligence', (s) => s.on('GET', /\/intelligence\/worklist$/, (c) => json(200, worklist([wlItem(1, 'CLM-0001')], { total: 60, page: Number(c.query.get('page') ?? 1), pageSize: 25 }))));
    await screen.findByRole('table', { name: 'Prioritised worklist' }, WAIT);
    const sel = screen.getByRole('combobox', { name: 'Perspective' });
    expect([...within(sel).getAllByRole('option')].map((o) => o.textContent)).toEqual(['All', 'Shipper', 'Carrier']);
    await user.selectOptions(sel, 'Carrier');
    await waitFor(() => expect(wl(stub).at(-1)!.query.get('perspective')).toBe('CARRIER'), WAIT);
    const prev = screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    await user.click(next);
    await waitFor(() => expect(wl(stub).at(-1)!.query.get('page')).toBe('2'), WAIT);
    cleanup();
    await open('MANAGER', '/intelligence', (s) => s.on('GET', /\/intelligence\/worklist$/, () => json(200, worklist([]))));
    expect(await screen.findByText('Nothing to work on right now.', {}, WAIT)).toBeTruthy();
  });
  it('hostile claim numbers and carrier names are inert text', async () => {
    const evil = wlItem(1, '<img src=x onerror=alert(1)>', { claim: { ...wlItem(1, 'x').claim, claimNumber: '<img src=x onerror=alert(1)>', carrierName: '<script>window.__pwned2 = 1</script>' } });
    await open('MANAGER', '/intelligence', (s) => s.on('GET', /\/intelligence\/worklist$/, () => json(200, worklist([evil]))));
    const table = await screen.findByRole('table', { name: 'Prioritised worklist' }, WAIT);
    expect(table.querySelector('img, script')).toBeNull();
    expect(table.textContent).toContain('<script>window.__pwned2 = 1</script>');
    expect((window as any).__pwned2).toBeUndefined();
  });
});

describe('T-WEB-09 claim sheet tabs', () => {
  const openSheet = async (features: any, setup?: (s: ReturnType<typeof devStub>) => void) => {
    const r = await open('MANAGER', '/claims', setup, { features });
    const link = await screen.findByRole('link', { name: 'CLM-0001' }, WAIT);
    await r.user.click(link);
    const dlg = await screen.findByRole('dialog', { name: 'Claim CLM-0001' }, WAIT);
    return { ...r, dlg };
  };
  const ALL = { 'intelligence.provenance': true, 'intelligence.similar_claims': true, 'intelligence.worklist': true };
  it('the tabs appear only for their own flag', async () => {
    let s = await openSheet(ALL);
    expect(within(s.dlg).getByRole('tab', { name: 'Similar' })).toBeTruthy();
    expect(within(s.dlg).getByRole('tab', { name: 'Provenance' })).toBeTruthy();
    cleanup();
    s = await openSheet({ ...ALL, 'intelligence.similar_claims': false });
    expect(within(s.dlg).queryByRole('tab', { name: 'Similar' })).toBeNull();
    expect(within(s.dlg).getByRole('tab', { name: 'Provenance' })).toBeTruthy();
    cleanup();
    s = await openSheet({ ...ALL, 'intelligence.provenance': false });
    expect(within(s.dlg).getByRole('tab', { name: 'Similar' })).toBeTruthy();
    expect(within(s.dlg).queryByRole('tab', { name: 'Provenance' })).toBeNull();
  });
  it('Similar: note, items with percentages and reasons, handling, and the computation line', async () => {
    const { dlg, user } = await openSheet(ALL, (s) => s.on('GET', /\/claims\/[^/]+\/similar$/, (c) => json(200, similar('c', [simItem('CLM-0042', 92), simItem('CLM-0043', 70, { handling: { finalStatus: 'REJECTED', ruleIds: [], sourceDocTypes: [], findingCount: 0, decidedAt: null } })]))));
    await user.click(within(dlg).getByRole('tab', { name: 'Similar' }));
    expect(await within(dlg).findByRole('heading', { name: 'Similar past claims' }, WAIT)).toBeTruthy();
    expect(dlg.textContent).toContain(SIM_NOTE);
    const items = within(dlg).getAllByRole('listitem').filter((li) => /CLM-004/.test(li.textContent ?? ''));
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(dlg.textContent).toContain('92% similar');
    expect(dlg.textContent).toContain('70% similar');
    expect(dlg.textContent).toContain('Why similar');
    expect(dlg.textContent).toContain('Shared rules: TST-ALPHA, TST-BETA');
    expect(dlg.textContent).toContain('Handled as APPROVED');
    expect(dlg.textContent).toContain('Handled as REJECTED');
    expect(dlg.textContent).toContain('Computed in 3.2 ms over 19 claims');
    expect(dlg.textContent).not.toMatch(/faster|speed|cache/i);
  });
  it('Similar: zero milliseconds and the two empty states', async () => {
    let s = await openSheet(ALL, (st) => st.on('GET', /\/claims\/[^/]+\/similar$/, () => json(200, similar('c', [simItem('CLM-0042', 92)], { computeMs: 0, candidatesConsidered: 7 }))));
    await s.user.click(within(s.dlg).getByRole('tab', { name: 'Similar' }));
    expect(await within(s.dlg).findByText('Computed in 0 ms over 7 claims', {}, WAIT)).toBeTruthy();
    cleanup();
    s = await openSheet(ALL, (st) => st.on('GET', /\/claims\/[^/]+\/similar$/, () => json(200, similar('c', []))));
    await s.user.click(within(s.dlg).getByRole('tab', { name: 'Similar' }));
    expect(await within(s.dlg).findByText('No similar past claims found.', {}, WAIT)).toBeTruthy();
    cleanup();
    s = await openSheet(ALL, (st) => st.on('GET', /\/claims\/[^/]+\/similar$/, () => json(200, similar('c', [], { reason: 'no_packet', candidatesConsidered: 0 }))));
    await s.user.click(within(s.dlg).getByRole('tab', { name: 'Similar' }));
    expect(await within(s.dlg).findByText('No evidence packet yet, so nothing to compare.', {}, WAIT)).toBeTruthy();
  });
  it('Provenance: note, documents table, totals row, one-decimal lowest confidence, empty state', async () => {
    let s = await openSheet(ALL);
    await s.user.click(within(s.dlg).getByRole('tab', { name: 'Provenance' }));
    expect(await within(s.dlg).findByRole('heading', { name: 'Provenance' }, WAIT)).toBeTruthy();
    expect(s.dlg.textContent).toContain(PROV_NOTE);
    const table = await within(s.dlg).findByRole('table', { name: 'Source documents' }, WAIT);
    expect(headers(table)).toEqual(['Document', 'Type', 'Fields', 'Confirmed', 'Corrected', 'Rejected', 'Needs review', 'Lowest confidence']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.length).toBe(3);
    expect(rows[0]!.textContent).toContain('85.0%');
    expect(rows[2]!.textContent).toMatch(/total/i);
    expect(s.dlg.textContent).not.toMatch(/\b(null|undefined|NaN)\b/);
    cleanup();
    s = await openSheet(ALL, (st) => st.on('GET', /\/claims\/[^/]+\/provenance$/, () => json(200, provenance('c', { documents: [], totals: { documents: 0, fields: 0, manualFields: 0, proposed: 0, confirmed: 0, corrected: 0, rejected: 0, unresolvedFlagged: 0 } }))));
    await s.user.click(within(s.dlg).getByRole('tab', { name: 'Provenance' }));
    expect(await within(s.dlg).findByText('No source documents are linked to this claim.', {}, WAIT)).toBeTruthy();
  });
});