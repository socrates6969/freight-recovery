// @vitest-environment jsdom
/* eslint-disable */
// REQ-20261012-hardening web (jsdom, Tier L): T7 HD-W01..HD-W05 and HD-W11 (Part C C6, C7.1-C7.4, C7.9). AppRoot with
// a scripted fetch serving Part C shapes; queries by role and accessible name. Expected strings restated from C6.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, setupDom } from './helpers/render.js';
import { PERMS, createStub, json, mkClaim, mkPacket, type RoleName } from './helpers/stub.js';

const WAIT = { timeout: 5000 };
const BASIS = {
  revision_author: 'You created a revision of this claim (by editing, analyzing or running the D&D audit). Another approver must approve it.',
  dd_invoice_editor: 'You entered or edited the D&D invoice of this claim. Another approver must approve it.',
  label_author: 'You set a team charge label that influenced this analysis. Another approver must approve it.',
} as const;
const FAIL = {
  input_values: 'The extracted values of this claim cannot be analysed automatically. Accepted documents cannot be changed, so the claim stays awaiting analysis.',
  amount_out_of_range: 'The computed amounts are negative or larger than the product can store, so nothing was saved.',
  fuel_check: 'The fuel check produced amounts that cannot be stored. Clear the fuel inputs or choose another fuel table, then analyze again.',
} as const;
const INVALID = 'The extracted values of this claim cannot be analysed automatically.';
const INTRO = 'Analyzes up to 10 claims awaiting analysis, oldest first. Claims whose analysis failed before are tried after the others.';
const STOPPED = { limit: 'Stopped after the batch limit.', budget: 'Stopped early: your analysis budget is used up for now. Try again later.', candidates: 'All candidate claims in this run were tried.' } as const;
const CONF = (c: string) => `rule setting ${c} (fixed per rule; not a measured probability)`;
const SERVER = 'SERVER-422-TEXT-MUST-NOT-RENDER';

setupDom();

function analyzeStub(role: RoleName, claims: any[], withAnalyze = true) {
  const stub = createStub({ role, claims });
  const perms = withAnalyze ? [...PERMS[role], 'claims:analyze'] : PERMS[role].filter((p) => p !== 'claims:analyze');
  stub.on('GET', /\/api\/v1\/me$/, () => json(200, { user: stub.user, permissions: perms }));
  stub.on('GET', /\/claims\/[^/]+\/packet$/, (c) => {
    const cl = claims.find((x) => x.id === c.path.split('/').at(-2));
    return cl && cl.status === 'AWAITING_ANALYSIS' ? json(404, { error: { code: 'not_found', message: 'Not found.', requestId: 'r' } }) : undefined;
  });
  return stub;
}
const awaiting = (i = 1, over: any = {}) => mkClaim(i, { status: 'AWAITING_ANALYSIS', latestPacket: null, amountClaimedCents: 0, recoverableCents: 0, pendingReviewCents: 0, ...over });
async function openSheet(stub: any, num = 'CLM-0001') {
  const r = await renderApp(stub, ['/claims']);
  await r.user.click(await screen.findByRole('link', { name: num }, WAIT));
  const dlg = await screen.findByRole('dialog', { name: `Claim ${num}` }, WAIT);
  return { ...r, dlg };
}
const alertExactly = (text: string) => waitFor(() => {
  const hit = screen.queryAllByRole('alert').find((a) => (a.textContent ?? '').trim() === text);
  expect(hit, `alert "${text}"; alerts: ${JSON.stringify(screen.queryAllByRole('alert').map((a) => a.textContent))}`).toBeTruthy();
}, WAIT);

describe('HD-W01 approvals page shows the basis text (C7.1)', () => {
  it('three self-authored items show exactly their basis text and no Approve/Reject; the other shows both', async () => {
    const a = mkClaim(1), b = mkClaim(2), c = mkClaim(3), d = mkClaim(4);
    const stub = createStub({ role: 'MANAGER', claims: [a, b, c, d], selfAuthored: new Set([a.id, b.id, c.id]), selfAuthoredBasis: { [a.id]: 'revision_author', [b.id]: 'dd_invoice_editor', [c.id]: 'label_author' } });
    await renderApp(stub, ['/approvals']);
    await screen.findByRole('heading', { name: 'Approvals' }, WAIT);
    await screen.findByText('CLM-0004', { exact: false }, WAIT);
    const row = (n: string) => screen.getByText(n, { exact: false }).closest('tr') as HTMLElement;
    const btn = (r: HTMLElement, name: string) => within(r).queryByRole('button', { name });
    for (const [num, basis] of [['CLM-0001', 'revision_author'], ['CLM-0002', 'dd_invoice_editor'], ['CLM-0003', 'label_author']] as const) {
      const r = row(num);
      expect(r.textContent, num).toContain(BASIS[basis]);
      for (const other of Object.keys(BASIS) as (keyof typeof BASIS)[]) if (other !== basis) expect(r.textContent, `${num} only its own basis`).not.toContain(BASIS[other]);
      expect(btn(r, 'Approve'), num).toBeNull();
      expect(btn(r, 'Reject'), num).toBeNull();
      expect(btn(r, 'Edit'), `${num} Edit visibility unchanged`).toBeTruthy();
    }
    const r4 = row('CLM-0004');
    expect(btn(r4, 'Approve')).toBeTruthy();
    expect(btn(r4, 'Reject')).toBeTruthy();
    for (const t of Object.values(BASIS)) expect(r4.textContent).not.toContain(t);
    for (const t of Object.values(BASIS)) expect(screen.getAllByText(t, { exact: false })).toHaveLength(1);
  });
});

describe('HD-W02 analyze 422 reason text (C7.2)', () => {
  const cases: [string, any, string][] = [
    ['input_values', [{ path: 'analysis', code: 'input_values' }], FAIL.input_values],
    ['amount_out_of_range', [{ path: 'analysis', code: 'amount_out_of_range' }], FAIL.amount_out_of_range],
    ['fuel_check', [{ path: 'analysis', code: 'fuel_check' }], FAIL.fuel_check],
    ['no details', undefined, INVALID],
    ['unknown code', [{ path: 'analysis', code: 'zzz' }], INVALID],
  ];
  for (const [label, details, text] of cases) {
    it(`${label} -> role=alert "${text.slice(0, 40)}..."; server message never shown`, async () => {
      const c = awaiting();
      const stub = analyzeStub('ANALYST', [c]);
      stub.on('POST', /\/claims\/[^/]+\/analyze$/, () => json(422, { error: { code: 'analysis_input_invalid', message: SERVER, requestId: 'r', ...(details ? { details } : {}) } }));
      const { dlg, user } = await openSheet(stub);
      await user.click(await within(dlg).findByRole('button', { name: 'Analyze claim' }, WAIT));
      await alertExactly(text);
      expect(document.body.textContent).not.toContain(SERVER);
    });
  }
});

describe('HD-W03 failed-analysis note on the claim sheet (C7.2)', () => {
  for (const role of ['ANALYST', 'VIEWER'] as const) {
    for (const n of [1, 3]) {
      it(`${role}, failedAttempts ${n}: note with the formatted date, ${n === 1 ? 'singular' : 'plural'}`, async () => {
        const at = '2026-10-12T10:00:00.000Z';
        const c = awaiting(1, { analysisFailure: { lastFailedAt: at, reasonCode: 'amount_out_of_range', failedAttempts: n } });
        const stub = analyzeStub(role, [c], role === 'ANALYST');
        const { dlg } = await openSheet(stub);
        const tail = `(${n} failed attempt${n === 1 ? '' : 's'} so far). ${FAIL.amount_out_of_range}`;
        const p = await within(dlg).findByText((t) => t.startsWith('Last analysis attempt failed on ') && t.endsWith(tail), {}, WAIT);
        const date = (p.textContent ?? '').slice('Last analysis attempt failed on '.length, -(tail.length + 1));
        expect(date.length, 'a date is shown').toBeGreaterThan(4);
        expect(date, 'formatted by the app, not the raw ISO value').not.toBe(at);
        expect(p.tagName.toLowerCase(), 'plain paragraph').toBe('p');
        expect(p.getAttribute('role')).toBeNull();
      });
    }
  }
  it('no note when analysisFailure is null', async () => {
    const stub = analyzeStub('VIEWER', [awaiting()], false);
    const { dlg } = await openSheet(stub);
    await within(dlg).findAllByRole('tab', {}, WAIT);
    expect(dlg.textContent).not.toContain('Last analysis attempt failed');
  });
});

describe('HD-W04 finding confidence as a rule setting (C7.3)', () => {
  it('0.9 and 0.5 shown as rule settings; no NN% next to a finding', async () => {
    const c = mkClaim(1);
    const base = mkPacket(c);
    const f0 = { ...base.findings[0], confidence: 0.9 };
    const f1 = { ...base.findings[0], id: '00000000-0000-4000-8000-0000000002bb', ruleId: 'INV-DUP-LINE', title: 'Duplicate line', confidence: 0.5, needsHumanReview: true };
    const stub = createStub({ claims: [c], packets: { [c.id]: { ...base, findings: [f0, f1] } } });
    const { dlg, user } = await openSheet(stub);
    await user.click(within(dlg).getByRole('tab', { name: 'Evidence' }));
    await within(dlg).findByText(CONF('0.90'), { exact: false }, WAIT);
    const t = dlg.textContent ?? '';
    expect(t).toContain(`INV-LINEHAUL-RATE - ${CONF('0.90')}`);
    expect(t).toContain(`INV-DUP-LINE - ${CONF('0.50')}`);
    expect(t).not.toMatch(/confidence \d+\s?%/i);
    expect(t).not.toContain('90%');
    expect(t).not.toContain('50%');
  });
});

describe('HD-W05 bulk dialog intro and stop reason (C7.4)', () => {
  for (const stoppedBy of ['limit', 'budget', 'candidates'] as const) {
    it(`stoppedBy ${stoppedBy}: intro, then summary, stop text and failed list in that order`, async () => {
      const claims = [awaiting(1), awaiting(2), mkClaim(3)];
      const stub = analyzeStub('MANAGER', claims);
      stub.on('POST', /\/claims\/analyze-awaiting$/, () => json(200, { limit: 10, examined: 2, analyzed: [{ claimId: '00000000-0000-4000-8000-0000000c0001', claimNumber: 'CLM-0001', packetId: '00000000-0000-4000-8000-0000000d0001', findingsCount: 1, recoverableCents: 100, pendingReviewCents: 0 }], skipped: [], failed: [{ claimId: '00000000-0000-4000-8000-0000000c0004', claimNumber: 'CLM-0099', code: 'analysis_input_invalid', reasonCode: 'amount_out_of_range' }], remaining: 1, stoppedBy }));
      const r = await renderApp(stub, ['/claims']);
      await screen.findByRole('link', { name: 'CLM-0001' }, WAIT);
      await r.user.click(screen.getByRole('button', { name: 'Analyze awaiting claims' }));
      const dlg = await screen.findByRole('dialog', { name: 'Analyze awaiting claims' }, WAIT);
      expect(dlg.textContent).toContain(INTRO);
      await r.user.click(within(dlg).getByRole('button', { name: 'Analyze' }));
      const summary = 'Analyzed 1. Skipped 0. Could not analyze 1. 1 still awaiting analysis.';
      const status = await waitFor(() => {
        const s = within(dlg).getAllByRole('status').find((x) => (x.textContent ?? '').includes(summary));
        expect(s).toBeTruthy();
        return s!;
      }, WAIT);
      const t = status.textContent ?? '';
      const i = t.indexOf(summary), j = t.indexOf(STOPPED[stoppedBy]), k = t.indexOf('Could not analyze: CLM-0099');
      expect(j, 'stop text in the status region').toBeGreaterThan(i);
      expect(k, 'failed list after the stop text').toBeGreaterThan(j);
      for (const other of Object.keys(STOPPED) as (keyof typeof STOPPED)[]) if (other !== stoppedBy) expect(t).not.toContain(STOPPED[other]);
    });
  }
});

describe('HD-W11 accessible table names (C7.9)', () => {
  it('Claims (claims page), Packet sources and Linked documents (claim sheet)', async () => {
    const c = mkClaim(1);
    const stub = createStub({ claims: [c, mkClaim(2)] });
    stub.on('GET', /\/claims\/[^/]+\/documents$/, () => json(200, { items: [{ id: '00000000-0000-4000-8000-0000000e0001', displayName: 'invoice.txt', docType: 'INVOICE', detectedType: 'TXT', sizeBytes: 100, sha256: 'a'.repeat(64), status: 'ACCEPTED', linkedAt: '2026-10-01T10:00:00.000Z' }] }));
    const r = await renderApp(stub, ['/claims']);
    expect(await screen.findByRole('table', { name: 'Claims' }, WAIT)).toBeTruthy();
    await r.user.click(await screen.findByRole('link', { name: 'CLM-0001' }, WAIT));
    const dlg = await screen.findByRole('dialog', { name: 'Claim CLM-0001' }, WAIT);
    await r.user.click(within(dlg).getByRole('tab', { name: 'Evidence' }));
    expect(await within(dlg).findByRole('table', { name: 'Packet sources' }, WAIT)).toBeTruthy();
    await r.user.click(within(dlg).getByRole('tab', { name: 'Documents' }));
    expect(await within(dlg).findByRole('table', { name: 'Linked documents' }, WAIT)).toBeTruthy();
  });
  it('Review queue (review page); Extracted fields is covered by ui-review.acc (unchanged assertion)', async () => {
    const stub = createStub({ role: 'REVIEWER' });
    stub.on('GET', /\/reviews$/, () => json(200, { items: [{ documentId: '00000000-0000-4000-8000-0000000e0002', batchId: '00000000-0000-4000-8000-0000000b0001', batchLabel: null, displayName: 'rc.pdf', docType: 'RATE_CONFIRMATION', reviewReasons: ['FLAGGED_FIELDS'], flaggedFieldCount: 1, unresolvedFlaggedCount: 1, uploadedBy: null, waitingSince: '2026-10-08T09:00:00.000Z' }], page: 1, pageSize: 25, total: 1 }));
    await renderApp(stub, ['/import/review']);
    expect(await screen.findByRole('table', { name: 'Review queue' }, WAIT)).toBeTruthy();
  });
});
