// @vitest-environment jsdom
/* eslint-disable */
// T-UI-01..05, T-UI-12
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDom, renderApp } from './helpers/render.js';
import { ACCESS_A, ACCESS_B, CSRF, createStub, json, mkUser } from './helpers/stub.js';

setupDom();
const WAIT = { timeout: 5000 };

async function fillLogin(user: any, email = 'manager@acme.test', password = 'Synthetic-Pass-2026!') {
  await user.type(await screen.findByRole('textbox', { name: 'Email' }, WAIT), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('T-UI-01 login page', () => {
  it('renders the contract controls', async () => {
    await renderApp(createStub({ refreshFails: true }), ['/login']);
    expect(await screen.findByRole('heading', { name: 'Sign in' }, WAIT)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toBeTruthy();
  });
  it('fetches CSRF before login and sends X-CSRF-Token equal to the cookie', async () => {
    const stub = createStub({ refreshFails: true });
    document.cookie = 'fr_csrf=; max-age=0; path=/'; // first visit: no CSRF cookie yet
    const { user } = await renderApp(stub, ['/login']);
    await fillLogin(user);
    expect(await screen.findByRole('heading', { name: 'Claims' }, WAIT)).toBeTruthy();
    const csrfIdx = stub.calls.findIndex((c) => c.method === 'GET' && c.path === '/api/v1/auth/csrf');
    const loginIdx = stub.calls.findIndex((c) => c.method === 'POST' && c.path === '/api/v1/auth/login');
    expect(csrfIdx).toBeGreaterThanOrEqual(0);
    expect(loginIdx).toBeGreaterThan(csrfIdx);
    expect(stub.calls[loginIdx]!.headers.get('x-csrf-token')).toBe(CSRF);
    expect(stub.calls[loginIdx]!.body).toEqual({ email: 'manager@acme.test', password: 'Synthetic-Pass-2026!' });
  });
  it('401 shows a fixed message without echoing server text', async () => {
    const stub = createStub({ refreshFails: true, login: () => json(401, { error: { code: 'invalid_credentials', message: 'SERVER-SECRET-TEXT-123', requestId: 'r' } }) });
    const { user } = await renderApp(stub, ['/login']);
    await fillLogin(user);
    const alert = await screen.findByRole('alert', {}, WAIT);
    expect(alert.textContent!.trim().length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('SERVER-SECRET-TEXT-123');
    expect(screen.queryByRole('heading', { name: 'Claims' })).toBeNull();
  });
  it('network error shows a fixed message', async () => {
    const stub = createStub({ refreshFails: true });
    stub.on('POST', /auth\/login$/, () => { throw new TypeError('NETWORK-EXPLOSION-XYZ'); });
    const { user } = await renderApp(stub, ['/login']);
    await fillLogin(user);
    const alert = await screen.findByRole('alert', {}, WAIT);
    expect(alert.textContent).not.toContain('NETWORK-EXPLOSION-XYZ');
    expect(alert.textContent!.trim().length).toBeGreaterThan(0);
  });
  it('429 shows a retry hint from Retry-After', async () => {
    const stub = createStub({ refreshFails: true, login: () => json(429, { error: { code: 'account_locked', message: 'Too many attempts SERVER-TEXT', requestId: 'r' } }, { 'Retry-After': '42' }) });
    const { user } = await renderApp(stub, ['/login']);
    await fillLogin(user);
    const alert = await screen.findByRole('alert', {}, WAIT);
    expect(alert.textContent).toMatch(/42/);
    expect(alert.textContent).not.toContain('SERVER-TEXT');
  });
});

describe('T-UI-02 MFA flows', () => {
  it('mfa_required -> /login/mfa -> wrong then correct code enters the app; recovery code option', async () => {
    let n = 0;
    const stub = createStub({ refreshFails: true, login: () => json(200, { status: 'mfa_required', mfaToken: 'MFA-TOKEN-1234567890abcdef', expiresIn: 300 }) });
    stub.on('POST', /auth\/mfa\/verify$/, () => (n++ === 0 ? json(401, { error: { code: 'invalid_code', message: 'SERVER-MFA-TEXT', requestId: 'r' } }) : json(200, { status: 'ok', accessToken: ACCESS_A, tokenType: 'Bearer', expiresIn: 600, user: stub.user })));
    const { user } = await renderApp(stub, ['/login']);
    await fillLogin(user, 'owner@acme.test');
    const code = await screen.findByRole('textbox', { name: 'Authentication code' }, WAIT);
    await user.type(code, '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    const alert = await screen.findByRole('alert', {}, WAIT);
    expect(alert.textContent).not.toContain('SERVER-MFA-TEXT');
    expect(stub.calls.find((c) => c.path.endsWith('/mfa/verify'))!.body).toMatchObject({ mfaToken: 'MFA-TOKEN-1234567890abcdef', code: '000000' });
    await user.click(screen.getByRole('button', { name: 'Use a recovery code' }));
    expect(screen.getByRole('textbox', { name: 'Recovery code' })).toBeTruthy();
    const c2 = screen.queryByRole('textbox', { name: 'Authentication code' });
    if (c2) { await user.clear(c2); await user.type(c2, '123456'); await user.click(screen.getByRole('button', { name: 'Verify' })); }
    else { await user.type(screen.getByRole('textbox', { name: 'Recovery code' }), 'AAAA-BBBB'); await user.click(screen.getByRole('button', { name: 'Verify' })); }
    expect(await screen.findByRole('heading', { name: 'Claims' }, WAIT)).toBeTruthy();
  });
  it('mfa_enrollment_required -> secret + SVG QR -> recovery codes only after verify -> acknowledge to continue', async () => {
    const SECRET = 'JBSWY3DPEHPK3PXP';
    const codes = Array.from({ length: 10 }, (_, i) => `RECOV-${i}${i}${i}${i}-CODE`);
    const stub = createStub({ refreshFails: true, login: () => json(200, { status: 'mfa_enrollment_required', enrollToken: 'ENROLL-TOKEN-1234567890abcdef', expiresIn: 300 }) });
    stub.on('POST', /mfa\/enroll\/start$/, () => json(200, { secret: SECRET, otpauthUri: `otpauth://totp/FreightRecovery:admin%40acme.test?secret=${SECRET}&issuer=FreightRecovery` }));
    stub.on('POST', /mfa\/enroll\/verify$/, () => json(200, { status: 'ok', accessToken: ACCESS_A, tokenType: 'Bearer', expiresIn: 600, user: stub.user, recoveryCodes: codes }));
    const { user } = await renderApp(stub, ['/login']);
    await fillLogin(user, 'newadmin@acme.test');
    const secretEl = await screen.findByLabelText('Authenticator secret', {}, WAIT);
    expect(secretEl.textContent).toContain(SECRET);
    const svg = document.body.querySelector('svg');
    expect(svg, 'SVG QR').toBeTruthy();
    expect(svg!.querySelectorAll('rect, path').length).toBeGreaterThan(3);
    expect(document.body.querySelector('img')).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/data:/);
    expect(screen.queryByRole('region', { name: 'Recovery codes' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Authentication code' }), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    const region = await screen.findByRole('region', { name: 'Recovery codes' }, WAIT);
    for (const c of codes) expect(region.textContent).toContain(c);
    expect(screen.queryByRole('heading', { name: 'Claims' })).toBeNull(); // must acknowledge first
    await user.click(screen.getByRole('button', { name: 'I have saved these codes' }));
    expect(await screen.findByRole('heading', { name: 'Claims' }, WAIT)).toBeTruthy();
  });
});

describe('T-UI-03 token handling', () => {
  it('access token lives only in memory and in the Authorization header; session restored by refresh on mount', async () => {
    const stub = createStub({ refreshFails: true });
    const { user } = await renderApp(stub, ['/login']);
    await fillLogin(user);
    await screen.findByRole('heading', { name: 'Claims' }, WAIT);
    await screen.findByRole('link', { name: 'CLM-0001' }, WAIT);
    const dump = JSON.stringify({ ls: { ...localStorage }, ss: { ...sessionStorage }, ck: document.cookie });
    expect(dump).not.toContain(ACCESS_A);
    expect(dump).not.toMatch(/ACCESS-TOKEN/);
    if (typeof indexedDB !== 'undefined' && (indexedDB as any).databases) expect((await (indexedDB as any).databases()).length).toBe(0);
    for (const c of stub.calls) {
      expect(c.url).not.toContain(ACCESS_A);
      expect(c.rawBody ?? '').not.toContain(ACCESS_A);
    }
    const protectedCalls = stub.calls.filter((c) => /\/api\/v1\/(claims|approvals|me)/.test(c.path));
    expect(protectedCalls.length).toBeGreaterThan(0);
    for (const c of protectedCalls) expect(c.headers.get('authorization')).toBe(`Bearer ${ACCESS_A}`);
  });
  it('on mount the app calls POST /auth/refresh to restore the session', async () => {
    const stub = createStub();
    await renderApp(stub, ['/claims']);
    await screen.findByRole('link', { name: 'CLM-0001' }, WAIT);
    const refreshIdx = stub.calls.findIndex((c) => c.method === 'POST' && c.path === '/api/v1/auth/refresh');
    const claimsIdx = stub.calls.findIndex((c) => c.method === 'GET' && c.path === '/api/v1/claims');
    expect(refreshIdx).toBeGreaterThanOrEqual(0);
    expect(claimsIdx).toBeGreaterThan(refreshIdx);
    expect(stub.calls[refreshIdx]!.headers.get('x-csrf-token')).toBe(CSRF);
  });
});

describe('T-UI-04 401 handling and open-redirect safety', () => {
  it('one refresh serves all concurrently failing calls, then the calls are retried', async () => {
    const stub = createStub({ refreshTokens: [ACCESS_A, ACCESS_B], rejectTokens: new Set([ACCESS_A]) });
    await renderApp(stub, ['/claims']);
    await screen.findByRole('link', { name: 'CLM-0001' }, WAIT);
    await new Promise((r) => setTimeout(r, 400));
    expect(stub.count('POST', /auth\/refresh$/), 'mount refresh + exactly one refresh after the 401s').toBe(2);
    const failed = stub.calls.filter((c) => c.headers.get('authorization') === `Bearer ${ACCESS_A}` && !/auth/.test(c.path));
    expect(failed.length).toBeGreaterThanOrEqual(1);
    const retried = stub.calls.filter((c) => c.headers.get('authorization') === `Bearer ${ACCESS_B}`);
    expect(retried.length).toBeGreaterThanOrEqual(failed.length);
  });
  it('failed refresh sends the user to /login; re-login returns to the same-origin path', async () => {
    let n = 0;
    const stub = createStub({ rejectTokens: new Set([ACCESS_A]) });
    stub.on('POST', /auth\/refresh$/, () => (n++ === 0 ? json(200, { accessToken: ACCESS_A, tokenType: 'Bearer', expiresIn: 600, user: stub.user }) : json(401, { error: { code: 'unauthenticated', message: 'x', requestId: 'r' } })));
    stub.on('POST', /auth\/login$/, () => json(200, { status: 'ok', accessToken: ACCESS_B, tokenType: 'Bearer', expiresIn: 600, user: stub.user }));
    const { user } = await renderApp(stub, ['/claims?status=APPROVED']);
    expect(await screen.findByRole('heading', { name: 'Sign in' }, WAIT)).toBeTruthy();
    await fillLogin(user);
    expect(await screen.findByRole('heading', { name: 'Claims' }, WAIT)).toBeTruthy();
    await waitFor(() => {
      const last = [...stub.calls].reverse().find((c) => c.method === 'GET' && c.path === '/api/v1/claims' && c.headers.get('authorization') === `Bearer ${ACCESS_B}`);
      expect(last?.query.get('status')).toBe('APPROVED');
    }, WAIT);
  });
  for (const bad of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', '\\\\evil.example', '/\\evil.example']) {
    it(`ignores hostile next=${bad}`, async () => {
      const stub = createStub({ refreshFails: true });
      const { user } = await renderApp(stub, [`/login?next=${encodeURIComponent(bad)}`]);
      await fillLogin(user);
      expect(await screen.findByRole('heading', { name: 'Claims' }, WAIT)).toBeTruthy();
      for (const c of stub.calls) expect(c.url).not.toMatch(/evil\.example/);
      cleanup();
    });
  }
  it('control: a same-origin relative next is honoured', async () => {
    const stub = createStub({ refreshFails: true });
    const { user } = await renderApp(stub, ['/login?next=%2Fapprovals']);
    await fillLogin(user);
    expect(await screen.findByRole('heading', { name: 'Approvals' }, WAIT)).toBeTruthy();
  });
});

describe('T-UI-05 reset/invite/forgot pages', () => {
  it('reset: token read from fragment, hash cleared, token only in the POST body', async () => {
    const stub = createStub({ refreshFails: true });
    stub.on('POST', /auth\/reset$/, () => new Response(null, { status: 204 }));
    const { user } = await renderApp(stub, ['/reset#token=RESET-TOKEN-abcdef0123456789']);
    await user.type(await screen.findByLabelText('New password', {}, WAIT), 'Another-Long-Pass-77!');
    await user.type(screen.getByLabelText('Confirm new password'), 'Another-Long-Pass-77!');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    await waitFor(() => expect(stub.count('POST', /auth\/reset$/)).toBe(1), WAIT);
    const call = stub.calls.find((c) => c.path.endsWith('/auth/reset'))!;
    expect(call.body.token).toBe('RESET-TOKEN-abcdef0123456789');
    for (const c of stub.calls) {
      expect(c.url).not.toContain('RESET-TOKEN');
      expect(c.url).not.toContain('?');
    }
  });
  it('invite: shows the invited email, token only in POST bodies, hash cleared', async () => {
    const stub = createStub({ refreshFails: true });
    stub.on('POST', /invites\/inspect$/, () => json(200, { email: 'invitee@acme.test', tenantName: 'Acme Logistics (synthetic)', role: 'MANAGER' }));
    stub.on('POST', /invites\/accept$/, () => new Response(null, { status: 204 }));
    const { user } = await renderApp(stub, ['/invite#token=INVITE-TOKEN-abcdef0123456789']);
    expect(await screen.findByText('invitee@acme.test', { exact: false }, WAIT)).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Ivy Invitee');
    await user.type(screen.getByLabelText('Password'), 'Another-Long-Pass-77!');
    await user.type(screen.getByLabelText('Confirm password'), 'Another-Long-Pass-77!');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(stub.count('POST', /invites\/accept$/)).toBe(1), WAIT);
    expect(stub.calls.find((c) => c.path.endsWith('/invites/accept'))!.body).toMatchObject({ token: 'INVITE-TOKEN-abcdef0123456789', name: 'Ivy Invitee' });
    for (const c of stub.calls) {
      expect(c.url).not.toContain('INVITE-TOKEN');
      expect(c.url).not.toContain('?');
    }
  });
  it('forgot: identical status text for any email', async () => {
    const texts: string[] = [];
    for (const email of ['known@acme.test', 'nobody@acme.test']) {
      const stub = createStub({ refreshFails: true });
      stub.on('POST', /auth\/forgot$/, () => json(202, { status: 'accepted' }));
      const { user } = await renderApp(stub, ['/forgot']);
      await user.type(await screen.findByRole('textbox', { name: 'Email' }, WAIT), email);
      await user.click(screen.getByRole('button', { name: 'Send reset link' }));
      const st = await screen.findByRole('status', {}, WAIT);
      texts.push(st.textContent!.trim());
      cleanup();
    }
    expect(texts[0]).toBe('If an account exists, a reset link has been sent.');
    expect(texts[1]).toBe(texts[0]);
  });
});

describe('T-UI-12 platform users', () => {
  it('SUPER_ADMIN (tenant null) sees "No tenant access" instead of claims', async () => {
    const stub = createStub({ role: 'SUPER_ADMIN' });
    await renderApp(stub, ['/claims']);
    expect(await screen.findByText(/No tenant access/i, {}, WAIT)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Claims' })).toBeNull();
    expect(stub.count('GET', /\/claims$/)).toBe(0);
    void mkUser; void fireEvent; void act; void within;
  });
});