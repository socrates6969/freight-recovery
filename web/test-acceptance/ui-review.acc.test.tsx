/* eslint-disable */
// T-UI-IMP UI-05 details dialog, UI-07 review queue and resolution.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeXHR, json, mkBatch, mkDoc, mkField, mkFile } from './helpers/imp-stub.js';
import { loadAppRoot, setupDom, signedIn } from './helpers/render.js';
import { createStub, type RoleName } from './helpers/stub.js';

setupDom();
beforeEach(() => FakeXHR.reset());
afterEach(() => cleanup());

async function open(role: RoleName, path: string, setup: (s: ReturnType<typeof createStub>) => void) {
  const stub = createStub({ role });
  stub.on('POST', /\/imports$/, () => json(201, mkBatch()));
  setup(stub);
  const AppRoot = await loadAppRoot();
  const user = userEvent.setup();
  render(<AppRoot fetchImpl={stub.fetch} xhrImpl={FakeXHR as any} initialEntries={[path]} />);
  await signedIn().catch(() => undefined);
  return { stub, user };
}

describe('UI-05 details dialog', () => {
  it('table, confidence levels, source text, manual entries, money format, honesty sentence, Esc and focus return', async () => {
    const fields = [
      mkField('rate_confirmation.linehaul_rate', '1234.56', { kind: 'DECIMAL', confidence: 0.95, source: { page: 2, line: 14, start: 10, end: 18, row: null, excerpt: 'Linehaul Rate: 1234.56' } }),
      mkField('rate_confirmation.carrier', 'Acme', { confidence: 0.85, needsReview: true, reviewReasons: ['LOW_CONFIDENCE'], source: { page: null, line: 14, start: 10, end: 18, row: null, excerpt: 'Carrier: Acme' } }),
      mkField('rate_confirmation.load_number', 'LD-1', { confidence: 0.5, needsReview: true, reviewReasons: ['LOW_CONFIDENCE'], status: 'CONFIRMED' }),
      mkField('rate_confirmation.fuel_surcharge', '5.00', { kind: 'DECIMAL', confidence: 1, origin: 'MANUAL', source: null, status: 'CONFIRMED' }),
    ];
    const { user } = await open('ANALYST', '/import', () => undefined);
    await screen.findByRole('heading', { name: 'Import documents' });
    await user.upload(screen.getByLabelText('Choose files to import'), mkFile('a.pdf'));
    await waitFor(() => expect(FakeXHR.instances.length).toBe(1));
    FakeXHR.instances[0]!.respond(201, mkDoc({ displayName: 'a.pdf', status: 'NEEDS_REVIEW', fields }));
    await user.click(await screen.findByRole('button', { name: 'Details' }));
    const dlg = await screen.findByRole('dialog', { name: 'Document a.pdf' });
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const table = within(dlg).getByRole('table', { name: 'Extracted fields' });
    for (const h of ['Field', 'Value', 'Confidence', 'Source', 'Review']) expect(within(table).getByRole('columnheader', { name: h })).toBeTruthy();
    const t = table.textContent!;
    for (const s of ['Linehaul rate', '$1,234.56', 'p.2 line 14 chars 10-18', 'line 14 chars 10-18', 'Manual entry', 'Needs review', 'Confirmed']) expect(t).toContain(s);
    expect(t).toMatch(/95%\s*High/);
    expect(t).toMatch(/85%\s*Medium/);
    expect(t).toMatch(/50%\s*Low/);
    expect(dlg.textContent).toContain('Confidence is a rule-based parse score, not an accuracy measure.');
    expect((dlg.textContent!.match(/accura/gi) ?? []).length).toBe(1);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Details' }));
  });
});

describe('UI-07 review', () => {
  const doc = () => mkDoc({ displayName: 'rc.pdf', status: 'NEEDS_REVIEW', batchId: '00000000-0000-4000-8000-0000000b0001', reviewReasons: ['FLAGGED_FIELDS'], fields: [mkField('rate_confirmation.carrier', 'Acme', { confidence: 0.85, needsReview: true, reviewReasons: ['LOW_CONFIDENCE'] })] });
  const setup = (d: any, calls: any[], resolveStatus = 200) => (s: ReturnType<typeof createStub>) => {
    s.on('GET', /\/reviews$/, () => json(200, { items: [{ documentId: d.id, batchId: '00000000-0000-4000-8000-0000000b0001', batchLabel: null, displayName: d.displayName, docType: d.docType, reviewReasons: d.reviewReasons, flaggedFieldCount: 1, unresolvedFlaggedCount: 1, uploadedBy: { id: '00000000-0000-4000-8000-0000000000e2', name: 'U' }, waitingSince: '2026-10-08T09:00:00.000Z' }], page: 1, pageSize: 25, total: 1 }));
    s.on('GET', /\/imports\/00000000-0000-4000-8000-0000000b0001\/documents\/[^/]+$/, () => json(200, d));
    s.on('POST', /\/resolve$/, (c) => { calls.push(c); return resolveStatus === 200 ? json(200, { ...d.fields[0], status: 'CONFIRMED' }) : json(resolveStatus, { error: { code: 'x', message: 'SECRET-LEAK', requestId: 'r' } }); });
    s.on('POST', /\/accept$/, (c) => { calls.push(c); return json(200, { ...d, status: 'ACCEPTED' }); });
  };
  it('queue table; Confirm sends the trimmed reason; the Confirm button is disabled until 10 trimmed characters', async () => {
    const d = doc(); const calls: any[] = [];
    const { user } = await open('REVIEWER', '/import/review', setup(d, calls));
    await screen.findByRole('heading', { name: 'Review queue' });
    const q = await screen.findByRole('table');
    for (const h of ['File', 'Reason', 'Waiting since']) expect(within(q).getByRole('columnheader', { name: h })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    const dlg = await screen.findByRole('dialog', { name: 'Review rc.pdf' });
    await user.click(within(dlg).getByRole('button', { name: 'Confirm Carrier' }));
    const reason = await screen.findByRole('textbox', { name: 'Reason' });
    const ok = screen.getByRole('button', { name: /^Save / }) as HTMLButtonElement;
    await user.type(reason, '   short  ');
    expect(ok.disabled).toBe(true);
    await user.clear(reason);
    await user.type(reason, '  checked against paper  ');
    expect(ok.disabled).toBe(false);
    await user.click(ok);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].body).toEqual({ action: 'CONFIRM', reason: 'checked against paper' });
  });
  it('a 409 shows the fixed changed-item message and never the server text', async () => {
    const d = doc(); const calls: any[] = [];
    const { user } = await open('REVIEWER', '/import/review', setup(d, calls, 409));
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    const dlg = await screen.findByRole('dialog', { name: 'Review rc.pdf' });
    await user.click(within(dlg).getByRole('button', { name: 'Reject Carrier' }));
    await user.type(await screen.findByRole('textbox', { name: 'Reason' }), 'not on the document');
    await user.click(screen.getByRole('button', { name: /^Save / }));
    await waitFor(() => expect(document.body.textContent).toContain('This item changed. Reload to continue.'));
    expect(document.body.textContent).not.toContain('SECRET-LEAK');
  });
  it('accept dialog offers Confirm all remaining flagged fields and sends confirmRemaining:true', async () => {
    const d = doc(); const calls: any[] = [];
    const { user } = await open('REVIEWER', '/import/review', setup(d, calls));
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    const dlg = await screen.findByRole('dialog', { name: 'Review rc.pdf' });
    await user.click(within(dlg).getByRole('button', { name: 'Accept document' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Confirm all remaining flagged fields' }));
    await user.type(await screen.findByRole('textbox', { name: 'Reason' }), 'accepting after review');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].body).toEqual({ reason: 'accepting after review', confirmRemaining: true });
  });
});

describe('UI-07 manual entry controls and Correct flow', () => {
  const BID = '00000000-0000-4000-8000-0000000b0001';
  const item = (x: any) => ({ documentId: x.id, batchId: BID, batchLabel: null, displayName: x.displayName, docType: x.docType, reviewReasons: x.reviewReasons, flaggedFieldCount: x.flaggedFieldCount, unresolvedFlaggedCount: x.unresolvedFlaggedCount, uploadedBy: { id: '00000000-0000-4000-8000-0000000000e2', name: 'U' }, waitingSince: '2026-10-08T09:00:00.000Z' });
  const img = () => mkDoc({ displayName: 'scan.png', docType: 'OTHER', docTypeBasis: 'NONE', status: 'NEEDS_REVIEW', batchId: BID, reviewReasons: ['IMAGE_NO_TEXT_LAYER', 'UNKNOWN_DOC_TYPE'], fields: [] });
  const pdf = () => mkDoc({ displayName: 'rc.pdf', status: 'NEEDS_REVIEW', batchId: BID, reviewReasons: ['FLAGGED_FIELDS'], fields: [mkField('rate_confirmation.linehaul_rate', '5.00', { kind: 'DECIMAL', confidence: 0.85, needsReview: true, reviewReasons: ['LOW_CONFIDENCE'] })] });
  const setup = (docs: any[], calls: any[], resolveStatus = 200) => (s: ReturnType<typeof createStub>) => {
    s.on('GET', /\/reviews$/, () => json(200, { items: docs.map(item), page: 1, pageSize: 25, total: docs.length }));
    for (const d of docs) s.on('GET', new RegExp('/imports/' + BID + '/documents/' + d.id + '$'), () => json(200, d));
    s.on('PATCH', /\/documents\/[^/]+$/, (c) => { calls.push(c); return json(200, { ...docs[0], docType: c.body.docType, docTypeBasis: 'MANUAL' }); });
    s.on('POST', /\/resolve$/, (c) => { calls.push(c); return resolveStatus === 200 ? json(200, { ...docs[docs.length - 1].fields[0], status: 'CORRECTED' }) : json(resolveStatus, { error: { code: 'validation_error', message: 'SECRET-LEAK', requestId: 'r' } }); });
  };
  it('document-type control appears only for image/no-field documents and sends the PATCH body', async () => {
    const calls: any[] = [];
    const { user } = await open('REVIEWER', '/import/review', setup([img(), pdf()], calls));
    const reviews = await screen.findAllByRole('button', { name: 'Review' });
    await user.click(reviews[0]!);
    const dlg = await screen.findByRole('dialog', { name: 'Review scan.png' });
    await user.selectOptions(within(dlg).getByLabelText('Document type'), 'RATE_CONFIRMATION');
    await user.click(within(dlg).getByRole('button', { name: 'Set type' }));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].body).toEqual({ docType: 'RATE_CONFIRMATION' });
    await user.keyboard('{Escape}');
    await user.click((await screen.findAllByRole('button', { name: 'Review' }))[1]!);
    const dlg2 = await screen.findByRole('dialog', { name: 'Review rc.pdf' });
    expect(within(dlg2).queryByLabelText('Document type')).toBeNull();
    expect(within(dlg2).queryByRole('button', { name: 'Set type' })).toBeNull();
  });
  it('Correct requires a non-empty corrected value; a 400 shows the fixed message without server text', async () => {
    const calls: any[] = [];
    const { user } = await open('REVIEWER', '/import/review', setup([pdf()], calls, 400));
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    await user.click(await screen.findByRole('button', { name: 'Correct Linehaul rate' }));
    const save = screen.getByRole('button', { name: 'Save correction' }) as HTMLButtonElement;
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'value read from the scan');
    expect(save.disabled, 'empty corrected value').toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Corrected value' }), '  6.00  ');
    expect(save.disabled).toBe(false);
    await user.click(save);
    await waitFor(() => expect(document.body.textContent).toContain('That value is not valid for this field.'));
    expect(document.body.textContent).not.toContain('SECRET-LEAK');
    expect(calls[0].body).toMatchObject({ action: 'CORRECT', reason: 'value read from the scan' });
    expect(String(calls[0].body.correctedValue).trim()).toBe('6.00');
  });
});
