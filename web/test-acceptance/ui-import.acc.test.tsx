/* eslint-disable */
// T-UI-IMP UI-01 navigation, UI-02 upload, UI-03 prefilter, UI-04 error mapping, UI-06 commit.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeXHR, err, json, mkBatch, mkDoc, mkFile } from './helpers/imp-stub.js';
import { loadAppRoot, setupDom, signedIn } from './helpers/render.js';
import { createStub, type RoleName } from './helpers/stub.js';

setupDom();
beforeEach(() => FakeXHR.reset());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function open(role: RoleName, path = '/import', stub = createStub({ role })) {
  stub.on('POST', /\/imports$/, (c) => json(201, mkBatch({ label: c.body?.label ?? null })));
  stub.on('GET', /\/imports$/, () => json(200, { items: [], page: 1, pageSize: 25, total: 0 }));
  stub.on('GET', /\/reviews$/, () => json(200, { items: [], page: 1, pageSize: 25, total: 0 }));
  const AppRoot = await loadAppRoot();
  const user = userEvent.setup();
  render(<AppRoot fetchImpl={stub.fetch} xhrImpl={FakeXHR as any} initialEntries={[path]} />);
  await signedIn().catch(() => undefined);
  return { stub, user };
}
const nav = () => screen.queryByRole('navigation', { name: 'Main' });

describe('UI-01 navigation', () => {
  it('ANALYST sees Import (no Review queue); VIEWER sees neither and no Choose files; REVIEWER sees Review queue; platform users see No tenant access', async () => {
    await open('ANALYST');
    await screen.findByRole('heading', { name: 'Import documents' });
    expect(within(nav()!).getByRole('link', { name: 'Import' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Review queue' })).toBeNull();
    cleanup();
    await open('VIEWER');
    await waitFor(() => expect(nav()).toBeTruthy());
    expect(within(nav()!).queryByRole('link', { name: 'Import' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose files' })).toBeNull();
    cleanup();
    await open('REVIEWER');
    expect((await screen.findAllByRole('link', { name: 'Review queue' })).length).toBeGreaterThan(0);
    cleanup();
    await open('ANALYST', '/import/review');
    await waitFor(() => expect(nav()).toBeTruthy());
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
    cleanup();
    await open('PLATFORM_DEV', '/import');
    expect(await screen.findByRole('heading', { name: 'Dev dashboard' })).toBeTruthy(); // step 4: platform users land on the Dev dashboard
  });
});

describe('UI-02 upload', () => {
  it('file input and drop start uploads with progress, headers and body; results table; display names rendered as text', async () => {
    const { stub, user } = await open('ANALYST');
    await screen.findByRole('heading', { name: 'Import documents' });
    await user.type(screen.getByRole('textbox', { name: 'Batch label' }), 'March load');
    const input = screen.getByLabelText('Choose files to import') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    const evil = mkFile('<script>x</script>\u202egnp.pdf');
    await user.upload(input, [mkFile('a.pdf'), evil]);
    await waitFor(() => expect(FakeXHR.instances.length).toBe(2));
    expect(stub.calls.filter((c) => c.method === 'POST' && /\/imports$/.test(c.path))).toHaveLength(1);
    expect(stub.calls.find((c) => c.method === 'POST' && /\/imports$/.test(c.path))!.body).toEqual({ label: 'March load' });
    const x = FakeXHR.instances[0]!;
    expect(x.method).toBe('POST');
    expect(x.url).toMatch(/\/api\/v1\/imports\/00000000-0000-4000-8000-0000000b0001\/documents\?filename=/);
    expect(x.headers['content-type']).toBe('application/octet-stream');
    expect(x.headers['authorization']).toMatch(/^Bearer /);
    expect(x.headers['x-csrf-token']).toBeTruthy();
    expect(x.body).toBeInstanceOf(File);
    const bar = await screen.findByRole('progressbar', { name: 'Uploading a.pdf' });
    const seen: number[] = [];
    for (const p of [0, 40, 100]) { x.progress(p, 100); await waitFor(() => expect(Number(bar.getAttribute('aria-valuenow'))).toBe(p)); seen.push(Number(bar.getAttribute('aria-valuenow'))); }
    expect(seen).toEqual([0, 40, 100]);
    x.respond(201, mkDoc({ displayName: 'a.pdf', status: 'ACCEPTED' }));
    FakeXHR.instances[1]!.respond(201, mkDoc({ displayName: '<script>x</script>gnp.pdf', status: 'NEEDS_REVIEW', reviewReasons: ['FLAGGED_FIELDS'] }));
    const table = await screen.findByRole('table', { name: 'Import results' });
    for (const h of ['File', 'Type', 'Status', 'Fields', 'Needs review']) expect(within(table).getByRole('columnheader', { name: h })).toBeTruthy();
    expect(table.innerHTML).not.toMatch(/<script/i);
    expect(table.textContent).toContain('<script>x</script>');
    expect(table.textContent).not.toMatch(/[\u202a-\u202e]/);
    const drop = screen.getByRole('region', { name: 'Drop files here' });
    fireEvent.drop(drop, { dataTransfer: { files: [mkFile('c.pdf')], types: ['Files'] } });
    await waitFor(() => expect(FakeXHR.instances.length).toBe(3));
  });
});

describe('UI-03 client prefilter', () => {
  const refuse = async (files: File[], text: RegExp) => {
    const { stub } = await open('ANALYST');
    await screen.findByRole('heading', { name: 'Import documents' });
    const before = stub.calls.length;
    fireEvent.change(screen.getByLabelText('Choose files to import'), { target: { files } });
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(text), { timeout: 4000 });
    expect(FakeXHR.instances).toHaveLength(0);
    expect(stub.calls.length).toBe(before);
  };
  it('a .exe file is refused without any network call', async () => { await refuse([mkFile('evil.exe', 10, 'application/x-msdownload')], /File type not supported./); });
  it('more than 10 files are refused without any network call', async () => { await refuse(Array.from({ length: 11 }, (_, i) => mkFile('f' + i + '.pdf')), /./); });
  it('a 12 MB file is refused without any network call', async () => { await refuse([mkFile('big.pdf', 12 * 1024 * 1024)], /File is too large./); });
});

describe('UI-04 error mapping', () => {
  const CASES: [number, string, string, Record<string, string>?][] = [
    [413, 'payload_too_large', 'File is too large.'], [415, 'unsupported_media_type', 'File type not supported.'], [422, 'quota_exceeded', 'Storage quota reached.'],
    [503, 'parser_busy', 'The parser is busy. Try again shortly.', { 'retry-after': '5' }], [500, 'internal_error', 'Upload failed.'],
  ];
  for (const [status, code, text, hdr] of CASES) {
    it(`${status} ${code} -> "${text}" and the server message never reaches the DOM`, async () => {
      const { user } = await open('ANALYST');
      await screen.findByRole('heading', { name: 'Import documents' });
      await user.upload(screen.getByLabelText('Choose files to import'), mkFile('a.pdf'));
      await waitFor(() => expect(FakeXHR.instances.length).toBe(1));
      FakeXHR.instances[0]!.respond(status, { error: { code, message: 'SECRET-LEAK message', requestId: 'r' } }, hdr);
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(text);
      expect(document.body.textContent).not.toContain('SECRET-LEAK');
    });
  }
  it('a 401 triggers one refresh and one retry of the upload', async () => {
    const { stub, user } = await open('ANALYST');
    await screen.findByRole('heading', { name: 'Import documents' });
    const refreshBefore = stub.count('POST', /\/auth\/refresh$/);
    await user.upload(screen.getByLabelText('Choose files to import'), mkFile('a.pdf'));
    await waitFor(() => expect(FakeXHR.instances.length).toBe(1));
    FakeXHR.instances[0]!.respond(401, { error: { code: 'unauthenticated', message: 'SECRET-LEAK', requestId: 'r' } });
    await waitFor(() => expect(FakeXHR.instances.length).toBe(2));
    expect(stub.count('POST', /\/auth\/refresh$/) - refreshBefore).toBe(1);
    expect(FakeXHR.instances[1]!.url).toBe(FakeXHR.instances[0]!.url);
    FakeXHR.instances[1]!.respond(201, mkDoc({ displayName: 'a.pdf' }));
    expect(document.body.textContent).not.toContain('SECRET-LEAK');
  });
});

describe('UI-06 commit', () => {
  it('Perspective starts unselected, the button is disabled until a perspective and an ACCEPTED document exist; click posts SHIPPER; status announced; nothing automatic', async () => {
    const { stub, user } = await open('ANALYST');
    stub.on('POST', /\/imports\/00000000-0000-4000-8000-0000000b0001\/commit$/, () => json(200, { created: [{ claimId: '00000000-0000-4000-8000-0000000c0001', claimNumber: 'CLM-0100', loadNumber: 'LD-9001' }], updated: [], skipped: [] }));
    await screen.findByRole('heading', { name: 'Import documents' });
    const btn = screen.getByRole('button', { name: 'Create claims from accepted documents' });
    const sel = screen.getByRole('combobox', { name: 'Perspective' }) as HTMLSelectElement;
    expect(sel.value).toBe('');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    await user.upload(screen.getByLabelText('Choose files to import'), mkFile('a.pdf'));
    await waitFor(() => expect(FakeXHR.instances.length).toBe(1));
    FakeXHR.instances[0]!.respond(201, mkDoc({ displayName: 'a.pdf', status: 'NEEDS_REVIEW', reviewReasons: ['FLAGGED_FIELDS'] }));
    await screen.findByRole('table', { name: 'Import results' });
    await user.selectOptions(sel, 'Shipper');
    expect((btn as HTMLButtonElement).disabled, 'no ACCEPTED document yet').toBe(true);
    await user.upload(screen.getByLabelText('Choose files to import'), mkFile('b.pdf'));
    await waitFor(() => expect(FakeXHR.instances.length).toBe(2));
    FakeXHR.instances[1]!.respond(201, mkDoc({ displayName: 'b.pdf', status: 'ACCEPTED' }));
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    expect(stub.count('POST', /\/commit$/)).toBe(0);
    await user.click(btn);
    await waitFor(() => expect(stub.count('POST', /\/commit$/)).toBe(1));
    expect(stub.calls.find((c) => /\/commit$/.test(c.path))!.body).toEqual({ perspective: 'SHIPPER' });
    await waitFor(() => expect(screen.getAllByRole('status').map((e) => e.textContent).join(' ')).toContain('Created 1 claim, updated 0.'));
  });
});
