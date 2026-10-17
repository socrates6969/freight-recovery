/* eslint-disable */
// Scripted network for AppRoot. Serves DTOs shaped per Part 1 (C3/C4) and records every call.
export type RoleName = 'OWNER' | 'ADMIN' | 'MANAGER' | 'REVIEWER' | 'ANALYST' | 'VIEWER' | 'PLATFORM_DEV' | 'SUPER_ADMIN';
export const PERMS: Record<RoleName, string[]> = {
  OWNER: ['claims:read', 'claims:assign', 'packets:edit', 'packets:approve', 'demands:send', 'users:read', 'users:manage', 'admins:manage', 'audit:read', 'import:run', 'import:review', 'export:claims', 'export:packets', 'export:outcomes'],
  ADMIN: ['claims:read', 'claims:assign', 'packets:edit', 'packets:approve', 'demands:send', 'users:read', 'users:manage', 'audit:read', 'import:run', 'import:review', 'export:claims', 'export:packets', 'export:outcomes'],
  MANAGER: ['claims:read', 'claims:assign', 'packets:edit', 'packets:approve', 'demands:send', 'import:run', 'import:review', 'export:claims', 'export:packets', 'export:outcomes'],
  REVIEWER: ['claims:read', 'packets:edit', 'packets:approve', 'import:run', 'import:review', 'export:claims', 'export:packets', 'export:outcomes'],
  ANALYST: ['claims:read', 'import:run', 'export:claims'],
  VIEWER: ['claims:read'],
  PLATFORM_DEV: ['platform:health'],
  SUPER_ADMIN: ['platform:health', 'platform:tenants:list', 'platform:cross_tenant_read'],
};

export const ACCESS_A = 'ACCESS-TOKEN-AAAA-1111-aaaaBBBBccccDDDD';
export const ACCESS_B = 'ACCESS-TOKEN-BBBB-2222-eeeeFFFFggggHHHH';
export const CSRF = 'csrf-token-value-0123456789abcdef.sig';

export const mkUser = (role: RoleName, name = `Test ${role}`) => ({
  id: `00000000-0000-4000-8000-${role.length.toString().padStart(12, '0')}`,
  email: `${role.toLowerCase()}@acme.test`,
  name,
  role,
  tenant: role === 'PLATFORM_DEV' || role === 'SUPER_ADMIN' ? null : { id: '00000000-0000-4000-8000-0000000000a1', name: 'Acme Logistics (synthetic)' },
  mfaEnabled: false,
});

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

export function mkClaim(i: number, over: Record<string, any> = {}) {
  const n = String(i).padStart(4, '0');
  const status = over.status ?? 'PENDING_REVIEW';
  return {
    id: uuid(),
    claimNumber: `CLM-${n}`,
    loadNumber: `LD-${5000 + i}`,
    invoiceNumber: `INV-${1000 + i}`,
    carrierName: `Carrier ${n}`,
    shipperName: `Shipper ${n}`,
    perspective: 'SHIPPER',
    status,
    amountClaimedCents: 32500,
    recoverableCents: 32500,
    pendingReviewCents: 0,
    currency: 'USD',
    assignee: null,
    latestPacket: { revision: 1, status },
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    invoiceDate: '2026-09-30',
    ...over,
  };
}

export function mkPacket(claim: any, over: Record<string, any> = {}) {
  const src = uuid();
  const src2 = uuid();
  return {
    id: uuid(),
    claimId: claim.id,
    revision: 1,
    status: claim.status,
    perspective: claim.perspective,
    loadNumber: claim.loadNumber,
    generatedAt: '2026-10-01T10:00:00.000Z',
    disclaimer: 'Unverified output. A person must review before any dispute is sent.',
    demandLetter: `DRAFT letter for ${claim.claimNumber}\nline two`,
    currency: 'USD',
    recoverableCents: claim.recoverableCents,
    pendingReviewCents: claim.pendingReviewCents,
    timeline: [
      { id: uuid(), occurredAt: '2026-03-03T08:00:00.000Z', kind: 'APPOINTMENT', label: 'Appointment', sourceId: src },
      { id: uuid(), occurredAt: '2026-03-03T08:05:00.000Z', kind: 'ARRIVAL', label: 'Arrival', sourceId: null },
      { id: uuid(), occurredAt: '2026-03-03T11:30:00.000Z', kind: 'DEPARTURE', label: 'Departure', sourceId: src2 },
    ],
    sources: [
      { id: src, filename: 'invoice.txt', docType: 'INVOICE', sha256: 'a'.repeat(64), sizeBytes: 1200 },
      { id: src2, filename: 'rate_confirmation.txt', docType: 'RATE_CONFIRMATION', sha256: 'b'.repeat(64), sizeBytes: 900 },
    ],
    findings: [
      {
        id: uuid(), ruleId: 'INV-LINEHAUL-RATE', title: 'Linehaul billed above rate confirmation', direction: 'OVERCHARGE', amountCents: 123456,
        explanation: 'Invoice linehaul exceeds the agreed rate.', calculation: ['Step one: $1,500.00 - $265.44', 'Step two: carry the difference', 'Step three: round to cents'],
        confidence: 0.95, needsHumanReview: false,
        citations: [{ sourceId: src, locator: 'line 4', excerpt: 'Linehaul 1500.00' }],
        governingClause: { sourceId: src2, label: 'Rate clause 2', excerpt: 'Linehaul is fixed at $1,400.00 all-in.', locator: 'section 2' },
      },
    ],
    verifier: { status: 'NOT_RUN', checkedAt: null, note: null },
    integrity: { contentHash: 'c'.repeat(64), recomputedHash: 'c'.repeat(64), valid: true },
    approvals: [
      { id: uuid(), action: 'APPROVE', reason: 'Checked all sources', packetRevision: 1, fromStatus: 'PENDING_REVIEW', toStatus: 'APPROVED', actor: { id: uuid(), name: 'Rita Reviewer', role: 'REVIEWER' }, createdAt: '2026-10-03T10:00:00.000Z' },
    ],
    createdAt: '2026-10-01T10:00:00.000Z',
    createdBy: null,
    ...over,
  };
}

export interface Call { method: string; url: string; path: string; query: URLSearchParams; headers: Headers; body: any; rawBody: string | null; t: number }
export type Handler = (c: Call) => Response | Promise<Response> | undefined;

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export interface StubOpts {
  role?: RoleName;
  claims?: any[];
  packets?: Record<string, any>;
  /** access token handed out by refresh() calls, in order (last one repeats) */
  refreshTokens?: string[];
  refreshFails?: boolean;
  login?: () => Response;
  /** access tokens that the stub rejects with 401 on protected routes */
  rejectTokens?: Set<string>;
}

export function createStub(o: StubOpts = {}) {
  const role = o.role ?? 'MANAGER';
  const claims = o.claims ?? Array.from({ length: 30 }, (_, i) => mkClaim(i + 1));
  const packets = o.packets ?? {};
  const calls: Call[] = [];
  const handlers: Array<{ m: string; re: RegExp; fn: Handler }> = [];
  let refreshN = 0;
  const reject = o.rejectTokens ?? new Set<string>();
  const user = mkUser(role);
  const stub = {
    calls,
    claims,
    packets,
    user,
    on(m: string, re: RegExp, fn: Handler) {
      handlers.unshift({ m, re, fn });
      return stub;
    },
    count(m: string, re: RegExp) {
      return calls.filter((c) => c.method === m && re.test(c.path)).length;
    },
    fetch: (async (input: any, init: any = {}) => {
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(rawUrl, 'http://localhost');
      const method = String(init.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
      const headers = new Headers(init.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined));
      const rawBody = typeof init.body === 'string' ? init.body : null;
      let body: any = null;
      try { body = rawBody ? JSON.parse(rawBody) : null; } catch { body = rawBody; }
      const call: Call = { method, url: rawUrl, path: u.pathname, query: u.searchParams, headers, body, rawBody, t: Date.now() };
      calls.push(call);
      for (const h of handlers) if (h.m === method && h.re.test(u.pathname)) { const r = await h.fn(call); if (r) return r; }
      const p = u.pathname.replace(/^\/api\/v1/, '');
      const auth = headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
      const protectedRoute = !/^\/(auth\/|healthz)/.test(p);
      if (protectedRoute && (!auth || reject.has(auth))) return json(401, { error: { code: 'unauthenticated', message: 'Authentication required.', requestId: 'r' } });
      if (method === 'GET' && p === '/auth/csrf') { document.cookie = `fr_csrf=${CSRF}; path=/`; return json(200, { csrfToken: CSRF }); }
      if (method === 'POST' && p === '/auth/refresh') {
        if (o.refreshFails) return json(401, { error: { code: 'unauthenticated', message: 'x', requestId: 'r' } });
        const toks = o.refreshTokens ?? [ACCESS_A];
        const tok = toks[Math.min(refreshN++, toks.length - 1)]!;
        return json(200, { accessToken: tok, tokenType: 'Bearer', expiresIn: 600, user });
      }
      if (method === 'POST' && p === '/auth/login') return o.login ? o.login() : json(200, { status: 'ok', accessToken: ACCESS_A, tokenType: 'Bearer', expiresIn: 600, user });
      if (method === 'POST' && p === '/auth/logout') return new Response(null, { status: 204 });
      if (method === 'GET' && p === '/me') return json(200, { user, permissions: PERMS[role] });
      if (method === 'GET' && p === '/claims') {
        let items = [...claims];
        const q = u.searchParams.get('q')?.toLowerCase();
        if (q) items = items.filter((c) => [c.claimNumber, c.loadNumber, c.invoiceNumber, c.carrierName, c.shipperName].some((f) => String(f).toLowerCase().includes(q)));
        const st = u.searchParams.get('status');
        if (st) items = items.filter((c) => st.split(',').includes(c.status));
        const pe = u.searchParams.get('perspective');
        if (pe) items = items.filter((c) => c.perspective === pe);
        const sort = u.searchParams.get('sort');
        if (sort) { const [f, d] = sort.split(':'); items.sort((a, b) => (String(a[f!]) < String(b[f!]) ? -1 : 1) * (d === 'desc' ? -1 : 1)); }
        const page = Number(u.searchParams.get('page') ?? 1);
        const pageSize = Number(u.searchParams.get('pageSize') ?? 25);
        return json(200, { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length });
      }
      let m = /^\/claims\/([^/]+)$/.exec(p);
      if (m && method === 'GET') { const c = claims.find((x) => x.id === m![1]); return c ? json(200, c) : json(404, { error: { code: 'not_found', message: 'Not found.', requestId: 'r' } }); }
      m = /^\/claims\/([^/]+)\/packet$/.exec(p);
      if (m && method === 'GET') { const c = claims.find((x) => x.id === m![1]); if (!c) return json(404, { error: { code: 'not_found', message: 'Not found.', requestId: 'r' } }); return json(200, packets[c.id] ?? (packets[c.id] = mkPacket(c))); }
      if (method === 'GET' && p === '/approvals') {
        const items = claims.filter((c) => ['PENDING_REVIEW', 'APPROVED'].includes(c.status)).map((c) => ({ ...c, packetRevision: 1, pendingFindingsCount: c.pendingReviewCents > 0 ? 1 : 0, waitingSince: c.updatedAt }));
        return json(200, { items, page: 1, pageSize: 25, total: items.length });
      }
      m = /^\/claims\/([^/]+)\/packet\/(approve|reject|send|revisions)$/.exec(p);
      if (m && method === 'POST') return json(200, { claim: { id: m[1], status: 'APPROVED' }, packet: { id: uuid(), revision: 1, status: 'APPROVED' } });
      return json(404, { error: { code: 'not_found', message: 'Not found.', requestId: 'r' } });
    }) as typeof fetch,
  };
  return stub;
}

export function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}