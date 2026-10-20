// @vitest-environment jsdom
/* eslint-disable */
// REQ-20261011-charge-intelligence Tier H web, SHOULD-HAVE S1: T15 Charges tab (CI-W01..W08; Part C C13).
// AppRoot with a scripted fetch serving contract-shaped DTOs. Set ACC_SKIP_CHARGES_UI=1 when the leader reports that
// S1 was cut (recorded note).
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, setupDom } from './helpers/render.js';
import { PERMS, createStub, json, mkClaim, mkPacket, type RoleName } from './helpers/stub.js';

const SKIP = process.env.ACC_SKIP_CHARGES_UI === '1';
const WAIT = { timeout: 5000 };
const NOTE = "Suggestions compare each charge name with labelled examples: public carrier tariff charge names and your team's labels. They are not verified. A suggestion only adds items for human review; it never confirms an amount.";
const TXT = { saved: 'Label saved. It applies to future analyses.', empty: 'No invoice charge lines on the accepted documents of this claim.', forbidden: 'You do not have permission to label charges.', limit: 'This organization has reached the maximum number of charge labels.', rateLimited: 'Too many requests. Try again later.', failed: 'Could not save the label. Try again.' };
const FEATS = { 'intelligence.charge_suggestions': true, 'intelligence.provenance': true, 'intelligence.similar_claims': true, 'intelligence.worklist': true };
const MANAGE = new Set<RoleName>(['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER']);
const DOHRN = 'Dohrn Rules Tariff DHRN 100 (2025)';
const LID = '00000000-0000-4000-8000-00000000c0de';

setupDom();

const sug = (category: string | null, similarity: number, nearest: any, reason: string | null = null) => ({ category, similarity, abstained: category === null, reason: category === null ? reason ?? 'below_threshold' : null, nearest });
const seedNearest = (text: string, category: string, source: string, sourceLabel: string) => ({ text, category, origin: 'seed', source, sourceLabel, labelId: null });
function chargeLines(claimId: string, labelled = false, hostile = false) {
  return {
    claimId, classifierVersion: 'charge-knn-v1', seedVersion: 'tariff-seed-v2', threshold: 0.3,
    influence: null, // REQ-20261012-hardening C3 (additive; the strict client schema requires the key)
    lines: [
      { index: 0, description: 'Linehaul', amount: '1500.00', ruleCategory: 'linehaul', suggestion: sug(null, 0.043, seedNearest('HYDRAULIC LIFTGATE SERVICE', 'accessorial', 'dohrn_2025', DOHRN)), label: null },
      { index: 1, description: 'Sort and segregate', amount: '85.00', ruleCategory: 'other', suggestion: labelled ? sug('accessorial', 1, { text: 'Sort and segregate', category: 'accessorial', origin: 'tenant', source: null, sourceLabel: "Your team's label", labelId: LID }) : sug('accessorial', 0.836, seedNearest('SORT AND SEGREGATE SERVICE', 'accessorial', 'dohrn_2025', DOHRN)), label: labelled ? { id: LID, category: 'accessorial' } : null },
      { index: 2, description: hostile ? '<img src=x onerror=alert(1)>' : 'Scale ticket', amount: '12.00', ruleCategory: 'other', suggestion: sug(null, 0.02, seedNearest('DANGEROUS ARTICLES', 'accessorial', 'estes_2025', 'Estes accessorial charges (2025)')), label: null },
    ],
  };
}
function mkStub(role: RoleName, o: { features?: any; lines?: (id: string) => Response; put?: () => Response } = {}) {
  const c = mkClaim(1, { status: 'PENDING_REVIEW', latestPacket: { revision: 1, status: 'PENDING_REVIEW' } });
  const stub = createStub({ role, claims: [c] });
  const perms = MANAGE.has(role) ? [...PERMS[role], 'charge_labels:manage'] : PERMS[role];
  stub.on('GET', /\/api\/v1\/me$/, () => json(200, { user: stub.user, permissions: perms }));
  stub.on('GET', /\/features$/, () => (o.features === 'fail' ? json(500, { error: { code: 'internal', message: 'x', requestId: 'r' } }) : json(200, { flags: o.features ?? FEATS })));
  let labelled = false;
  stub.on('GET', /\/claims\/[^/]+\/charge-lines$/, (call) => (o.lines ? o.lines(c.id) : json(200, chargeLines(call.path.split('/').at(-2)!, labelled))));
  stub.on('PUT', /\/charge-labels$/, () => {
    if (o.put) return o.put();
    labelled = true;
    return json(200, { label: { id: LID, description: 'Sort and segregate', normalizedText: 'sort and segregate', category: 'accessorial', version: 1, createdAt: '2026-10-11T10:00:00.000Z', updatedAt: '2026-10-11T10:00:00.000Z' }, outcome: 'created' });
  });
  return { stub, c };
}
async function openSheet(stub: any) {
  const r = await renderApp(stub, ['/claims']);
  await r.user.click(await screen.findByRole('link', { name: 'CLM-0001' }, WAIT));
  const dlg = await screen.findByRole('dialog', { name: 'Claim CLM-0001' }, WAIT);
  return { ...r, dlg };
}
async function openCharges(stub: any) {
  const s = await openSheet(stub);
  const tab = await within(s.dlg).findByRole('tab', { name: 'Charges' }, WAIT);
  await s.user.click(tab);
  await within(s.dlg).findByText(NOTE, { exact: false }, WAIT);
  return s;
}
const rowOf = (dlg: HTMLElement, text: string) => {
  const el = within(dlg).getAllByText(text, { exact: false })[0]!;
  return (el.closest('tr, li, [role="row"], article, section') ?? el.parentElement!) as HTMLElement;
};
const alertWith = (text: string) => waitFor(() => {
  const hit = screen.queryAllByRole('alert').find((a) => (a.textContent ?? '').includes(text));
  expect(hit, `alert "${text}": ${JSON.stringify(screen.queryAllByRole('alert').map((a) => a.textContent))}`).toBeTruthy();
}, WAIT);

describe.skipIf(SKIP)('T15 Charges tab (C13, S1)', () => {
  it('CI-W01 tab after the existing tabs; note; one row per line with chips and nearest example', async () => {
    const { stub } = mkStub('VIEWER');
    const { dlg } = await openCharges(stub);
    const tabs = within(dlg).getAllByRole('tab').map((t) => t.textContent);
    expect(tabs.at(-1)).toBe('Charges');
    expect(dlg.textContent).toContain(NOTE);
    expect(dlg.textContent).toContain('Rules: Linehaul');
    expect(dlg.textContent).toContain('Rules: Other');
    expect(dlg.textContent).toContain('Suggested: Accessorial (0.836)');
    expect(dlg.textContent).toContain('No suggestion');
    expect(dlg.textContent).toContain(`Nearest example: 'SORT AND SEGREGATE SERVICE' (${DOHRN})`);
    expect(dlg.textContent).toContain('85.00');
    expect(dlg.textContent).not.toContain('Team label:');
  });
  it('CI-W01 team label shown when present', async () => {
    const { stub } = mkStub('VIEWER', { lines: (id) => json(200, chargeLines(id, true)) });
    const { dlg } = await openCharges(stub);
    expect(dlg.textContent).toContain('Team label: Accessorial');
    expect(dlg.textContent).toContain("(Your team's label)");
  });
  for (const [label, o] of [['flag off', { features: { ...FEATS, 'intelligence.charge_suggestions': false } }], ['features failing', { features: 'fail' }]] as const) {
    it(`CI-W02 ${label} -> no Charges tab`, async () => {
      const { stub } = mkStub('MANAGER', o as any);
      const { dlg } = await openSheet(stub);
      await waitFor(() => expect(within(dlg).getAllByRole('tab').length).toBeGreaterThan(0), WAIT);
      await new Promise((r) => setTimeout(r, 300));
      expect(within(dlg).queryByRole('tab', { name: 'Charges' })).toBeNull();
    });
  }
  it('CI-W02 charge-lines 404 -> selecting Charges loads the lines, then the tab disappears', async () => {
    const { stub } = mkStub('MANAGER', { lines: () => json(404, { error: { code: 'not_found', message: 'Not found.', requestId: 'r' } }) });
    const { dlg, user } = await openSheet(stub);
    const tab = await within(dlg).findByRole('tab', { name: 'Charges' }, WAIT);
    await user.click(tab);
    await waitFor(() => expect(stub.count('GET', /\/charge-lines$/)).toBeGreaterThan(0), WAIT);
    await waitFor(() => expect(within(dlg).queryByRole('tab', { name: 'Charges' })).toBeNull(), WAIT);
    expect(document.body.textContent).not.toContain('Not found.');
  });
  it('CI-W03 REVIEWER sees Confirm Accessorial and a 5-option Category select with Save label', async () => {
    const { stub } = mkStub('REVIEWER');
    const { dlg } = await openCharges(stub);
    const row = rowOf(dlg, 'Sort and segregate');
    expect(within(row).getByRole('button', { name: 'Confirm Accessorial' })).toBeTruthy();
    const sel = within(row).getByRole('combobox', { name: 'Category' }) as HTMLSelectElement;
    expect([...sel.options].map((x) => x.textContent)).toEqual(['Detention', 'Linehaul', 'Fuel', 'Accessorial', 'Other']);
    expect(within(row).getByRole('button', { name: 'Save label' })).toBeTruthy();
    // abstained line: no Confirm button
    expect(within(rowOf(dlg, 'Scale ticket')).queryByRole('button', { name: /^Confirm / })).toBeNull();
  });
  for (const role of ['VIEWER', 'ANALYST'] as const) {
    it(`CI-W03 ${role} sees no controls`, async () => {
      const { stub } = mkStub(role);
      const { dlg } = await openCharges(stub);
      expect(within(dlg).queryByRole('button', { name: /^Confirm / })).toBeNull();
      expect(within(dlg).queryByRole('button', { name: 'Save label' })).toBeNull();
      expect(within(dlg).queryByRole('combobox', { name: 'Category' })).toBeNull();
    });
  }
  it('CI-W04 Confirm sends exactly one PUT with the exact body; toast; rows reload with the team label', async () => {
    const { stub } = mkStub('REVIEWER');
    const { dlg, user } = await openCharges(stub);
    const gets0 = stub.count('GET', /\/charge-lines$/);
    await user.click(within(rowOf(dlg, 'Sort and segregate')).getByRole('button', { name: 'Confirm Accessorial' }));
    await waitFor(() => expect(stub.count('PUT', /\/charge-labels$/)).toBe(1), WAIT);
    const put = stub.calls.find((x) => x.method === 'PUT')!;
    expect(put.path).toBe('/api/v1/charge-labels');
    expect(put.body).toEqual({ description: 'Sort and segregate', category: 'accessorial' });
    expect(put.headers.get('x-csrf-token') ?? put.headers.get('X-CSRF-Token')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('status').some((s) => (s.textContent ?? '').includes(TXT.saved))).toBe(true), WAIT);
    await waitFor(() => expect(stub.count('GET', /\/charge-lines$/)).toBeGreaterThan(gets0), WAIT);
    await waitFor(() => expect(dlg.textContent).toContain('Team label: Accessorial'), WAIT);
    expect(stub.count('PUT', /\/charge-labels$/)).toBe(1);
  });
  it('CI-W04 Save label with a chosen category sends that category', async () => {
    const { stub } = mkStub('MANAGER');
    const { dlg, user } = await openCharges(stub);
    const row = rowOf(dlg, 'Scale ticket');
    await user.selectOptions(within(row).getByRole('combobox', { name: 'Category' }), within(row).getByRole('option', { name: 'Other' }));
    await user.click(within(row).getByRole('button', { name: 'Save label' }));
    await waitFor(() => expect(stub.count('PUT', /\/charge-labels$/)).toBe(1), WAIT);
    expect(stub.calls.find((x) => x.method === 'PUT')!.body).toEqual({ description: 'Scale ticket', category: 'other' });
  });
  for (const [status, code, key] of [[403, 'forbidden', 'forbidden'], [409, 'label_limit_reached', 'limit'], [429, 'rate_limited', 'rateLimited'], [500, 'internal', 'failed']] as const) {
    it(`CI-W05 ${status} -> role=alert "${(TXT as any)[key]}"; server text never shown`, async () => {
      const { stub } = mkStub('REVIEWER', { put: () => json(status, { error: { code, message: `SERVER ${status} TEXT`, requestId: 'r' } }, status === 429 ? { 'retry-after': '30' } : {}) });
      const { dlg, user } = await openCharges(stub);
      await user.click(within(rowOf(dlg, 'Sort and segregate')).getByRole('button', { name: 'Confirm Accessorial' }));
      await alertWith((TXT as any)[key]);
      expect(document.body.textContent).not.toContain(`SERVER ${status} TEXT`);
    });
  }
  it('CI-W06 hostile description renders as literal text', async () => {
    const { stub } = mkStub('REVIEWER', { lines: (id) => json(200, chargeLines(id, false, true)) });
    const { dlg } = await openCharges(stub);
    expect(dlg.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(dlg.querySelector('img[src="x"]')).toBeNull();
  });
  it('CI-W07 empty invoice -> empty text', async () => {
    const { stub } = mkStub('VIEWER', { lines: (id) => json(200, { ...chargeLines(id), lines: [] }) });
    const { dlg } = await openCharges(stub);
    expect(dlg.textContent).toContain(TXT.empty);
  });
  // REQ-20261012-hardening C7.3 (contract change): the confidence is shown as a fixed rule setting, not as "50%".
  it('CI-W08 LRN findings appear in the Evidence tab with rule id, the rule-setting text and the needs-review marker', async () => {
    const { stub, c } = mkStub('VIEWER');
    const base = mkPacket(c, { revision: 1, status: 'PENDING_REVIEW' });
    stub.packets[c.id] = { ...base, findings: [{ ...base.findings[0], id: '00000000-0000-4000-8000-0000000001aa', ruleId: 'LRN-ACCESSORIAL-REVIEW', title: 'Possible unauthorized accessorial (suggestion)', amountCents: 8500, confidence: 0.5, needsHumanReview: true }] };
    const { dlg, user } = await openSheet(stub);
    await user.click(within(dlg).getByRole('tab', { name: 'Evidence' }));
    await within(dlg).findByText('LRN-ACCESSORIAL-REVIEW', { exact: false }, WAIT);
    expect(dlg.textContent).toContain('Possible unauthorized accessorial (suggestion)');
    expect(dlg.textContent).toContain('rule setting 0.50 (fixed per rule; not a measured probability)');
    expect(dlg.textContent).not.toContain('50%');
    expect(dlg.textContent?.toLowerCase()).toContain('needs human review');
  });
});

// REQ-20261012-hardening T7 HD-W06 / HD-W07 (Part C C6, C7.5): learned-label influence section and 409 texts.
describe.skipIf(SKIP)('HD-W06 / HD-W07 Charges tab influence and label conflicts (C7.5)', () => {
  const INF = { heading: 'Team labels that influenced this analysis', none: 'No team label influenced this analysis.', deleted: 'Deleted label', note: 'A team label can only move findings to human review or add review items. It never adds confirmed money.' };
  const CONFLICT = 'This label was changed at the same time by someone else. Reload and try again.';
  const HOSTILE = '<img src=x onerror=alert(1)>';
  const withInfluence = (influence: any) => (id: string) => json(200, { ...chargeLines(id), influence });
  it('HD-W06 influence null: section absent', async () => {
    const { stub } = mkStub('VIEWER', { lines: withInfluence(null) });
    const { dlg } = await openCharges(stub);
    expect(dlg.textContent).not.toContain(INF.heading);
    expect(dlg.textContent).not.toContain(INF.none);
  });
  it('HD-W06 influence {labels: []}: heading and the none text', async () => {
    const { stub } = mkStub('VIEWER', { lines: withInfluence({ labels: [] }) });
    const { dlg } = await openCharges(stub);
    await within(dlg).findByText(INF.none, { exact: false }, WAIT);
    expect(dlg.textContent).toContain(INF.heading);
  });
  it('HD-W06 present + deleted + hostile labels: description and category, Deleted label, note; hostile text stays text', async () => {
    const { stub } = mkStub('VIEWER', { lines: withInfluence({ labels: [
      { labelId: LID, description: 'Sort and segregate', category: 'accessorial' },
      { labelId: '00000000-0000-4000-8000-00000000c0df', description: null, category: null },
      { labelId: '00000000-0000-4000-8000-00000000c0e0', description: HOSTILE, category: 'detention' },
    ] }) });
    const { dlg } = await openCharges(stub);
    await within(dlg).findByText(INF.heading, { exact: false }, WAIT);
    const t = dlg.textContent ?? '';
    for (const s of [INF.heading, 'Sort and segregate', INF.deleted, INF.note, HOSTILE]) expect(t, s).toContain(s);
    expect(t).toMatch(/accessorial/i);
    expect(t).toMatch(/detention/i);
    expect(t.indexOf(INF.note), 'note after the list').toBeGreaterThan(t.indexOf(INF.deleted));
    expect(dlg.querySelector('img[src="x"]')).toBeNull();
    expect(dlg.querySelectorAll('img').length).toBe(0);
  });
  for (const [code, text] of [['conflict', CONFLICT], ['label_limit_reached', TXT.limit]] as const) {
    it(`HD-W07 label PUT 409 ${code} -> "${text}"; server text never shown`, async () => {
      const { stub } = mkStub('REVIEWER', { put: () => json(409, { error: { code, message: 'SERVER 409 TEXT', requestId: 'r' } }) });
      const { dlg, user } = await openCharges(stub);
      await user.click(within(rowOf(dlg, 'Sort and segregate')).getByRole('button', { name: 'Confirm Accessorial' }));
      await alertWith(text);
      if (code === 'conflict') expect(document.body.textContent).not.toContain(TXT.limit);
      expect(document.body.textContent).not.toContain('SERVER 409 TEXT');
    });
  }
});
