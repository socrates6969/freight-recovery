// REQ-20261011-ocean-dd Tier H (written now; run after the owner's go-ahead): T11 routes (DD-A01..A07; Part C C12, C13,
// C14, C16, C19) and T13 audit events of the CRUD routes (DD-E01 for dd_tariff.*, dd_calendar.*, dd_invoice.created/
// updated/deleted). Black-box over HTTP; audit rows over SQL. Expected values restated from test-spec and Part C.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, ALL_ROLES, Client, type RoleName, type Session, buildTestApp, closeApps, expectError, sessionFor } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import * as D from './helpers/dd.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import * as K from './helpers/keys.js';
import { reseed } from './helpers/seed.js';

interface Schema { parse(v: unknown): unknown; safeParse(v: unknown): { success: boolean } }
interface Shared { [k: string]: unknown; DD_TARIFF_PRESETS: { id: string; data: Record<string, unknown> }[]; auditDdInvoice(a: unknown): unknown }
let app: FastifyInstance;
let SS: Record<RoleName, Session>;
let gxo: Session;
let R: Shared;
let tid = '';
let gtid = '';
let maersk = '';
let gxTariff = '';
let gxCalendar = '';
const S = (name: string): Schema => R[name] as Schema;

beforeAll(async () => {
  reseed();
  R = (await import('@fr/shared')) as unknown as Shared;
  app = await buildTestApp({ LOCKOUT_THRESHOLD: '50', FLAGS_CACHE_TTL_MS: '0' });
  SS = {} as Record<RoleName, Session>;
  for (const r of ALL_ROLES) SS[r] = await sessionFor(app, ACCOUNTS[r]);
  gxo = await sessionFor(app, I.GLOBEX.OWNER);
  tid = SS.OWNER.user.tenant.id;
  gtid = gxo.user.tenant.id;
  gxTariff = await D.newTariff(gxo, { ...D.MAERSK, name: 'Globex Maersk copy' });
  gxCalendar = await D.newCalendar(gxo, { ...D.HAPAG_CAL, name: 'Globex calendar' });
}, 180000);
afterAll(async () => { try { await K.revokeActive(SS.OWNER); } finally { await closeApps(); reseed(); } });

describe('T11 CRUD happy paths (C12)', () => {
  it('DD-A01 tariffs from every preset: 201 DdTariffView, data unchanged, version 1; list sorted by name; audit dd_tariff.created', async () => {
    const seq = await I.lastSeq(tid);
    const ids: string[] = [];
    for (const p of R.DD_TARIFF_PRESETS) {
      const r = await D.postTariff(SS.OWNER, p.data);
      expect(r.status, `${p.id} ${r.text}`).toBe(201);
      S('DdTariffView').parse(r.body);
      expect(r.body.version).toBe(1);
      expect(r.body.data, p.id).toEqual(p.data);
      ids.push(r.body.id);
    }
    maersk = ids[0] ?? '';
    const list = await D.tariffs(SS.VIEWER, '?page=1&pageSize=100');
    expect(list.status, list.text).toBe(200);
    S('DdTariffList').parse(list.body);
    const names = list.body.items.map((x: { data: { name: string } }) => x.data.name);
    expect(names).toEqual([...names].sort());
    expect([list.body.page, list.body.pageSize, list.body.total]).toEqual([1, 100, R.DD_TARIFF_PRESETS.length]);
    const evs = await I.eventsSince(tid, seq, 'dd_tariff.');
    expect(evs.map((e) => [e.action, e.target_type, e.target_id])).toEqual(ids.map((id) => ['dd_tariff.created', 'dd_tariff', id]));
    R.DD_TARIFF_PRESETS.forEach((p, k) => {
      const m = evs[k]?.metadata;
      expect(I.keysOf(m)).toEqual(D.AUDIT_KEYS.tariff);
      expect(m).toEqual({ tariffId: ids[k], version: 1, chargeType: p.data.chargeType, direction: p.data.direction, tierCount: (p.data.tiers as unknown[]).length, dataSha256: D.sha256Canon(p.data) });
    });
    D.noFreeText(evs, ['Maersk', 'Hapag', 'MSC', 'CMA']);
  });
  it('DD-A01 tariff PUT: version 2 + dd_tariff.updated; stale version -> 409 stale_revision; normalization (weekdays sorted, money two decimals)', async () => {
    const id = await D.newTariff(SS.ADMIN, { ...D.MAERSK, name: D.uniq('Maersk edit') });
    const seq = await I.lastSeq(tid);
    const data = { ...D.MAERSK, name: D.uniq('Maersk edited'), workingWeekdays: [6, 5, 4, 3, 2, 1], tiers: [{ days: 4, rates: { '40DV': '211' } }, { days: null, rates: { '40DV': '300' } }] };
    const r = await D.putTariff(SS.MANAGER, id, { version: 1, data });
    expect(r.status, r.text).toBe(200);
    S('DdTariffView').parse(r.body);
    expect(r.body.version).toBe(2);
    expect(r.body.data.workingWeekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.body.data.tiers).toEqual([{ days: 4, rates: { '40DV': '211.00' } }, { days: null, rates: { '40DV': '300.00' } }]);
    const evs = await I.eventsSince(tid, seq, 'dd_tariff.');
    expect(evs.map((e) => e.action)).toEqual(['dd_tariff.updated']);
    expect(evs[0]?.metadata).toEqual({ tariffId: id, version: 2, chargeType: 'DETENTION', direction: 'IMPORT', tierCount: 2, dataSha256: D.sha256Canon(r.body.data) });
    D.expectCode(await D.putTariff(SS.MANAGER, id, { version: 1, data }), 409, 'stale_revision');
    D.expectCode(await D.postTariff(SS.OWNER, { ...D.MAERSK, name: data.name }), 409, 'conflict', 'duplicate name');
  });
  it('DD-A01 calendars: POST normalizes, PUT increments version, audit keys', async () => {
    const seq = await I.lastSeq(tid);
    const r = await D.postCalendar(SS.REVIEWER, { name: D.uniq('Synthetic terminal'), closedDates: ['2026-07-03', '2026-01-01'], shutoutDates: ['2026-07-14'] });
    expect(r.status, r.text).toBe(201);
    S('DdCalendarView').parse(r.body);
    expect(r.body.data.closedDates).toEqual(['2026-01-01', '2026-07-03']);
    const u = await D.putCalendar(SS.REVIEWER, r.body.id, { version: 1, data: { ...r.body.data, shutoutDates: [] } });
    expect(u.status, u.text).toBe(200);
    expect(u.body.version).toBe(2);
    const evs = await I.eventsSince(tid, seq, 'dd_calendar.');
    expect(evs.map((e) => e.action)).toEqual(['dd_calendar.created', 'dd_calendar.updated']);
    expect(evs[0]?.metadata).toEqual({ calendarId: r.body.id, version: 1, closedCount: 2, shutoutCount: 1, dataSha256: D.sha256Canon(r.body.data) });
    expect(evs[1]?.metadata).toEqual({ calendarId: r.body.id, version: 2, closedCount: 2, shutoutCount: 0, dataSha256: D.sha256Canon(u.body.data) });
    const list = await D.calendars(SS.VIEWER);
    S('DdCalendarList').parse(list.body);
    expect([list.body.page, list.body.pageSize]).toEqual([1, 25]);
  });
  it('DD-A01 invoices: SI-1 with MAERSK -> 201 DdInvoiceDetail (DRAFT, v1, preview = auditDdInvoice), PUT v2, list item, DELETE 204; audit events', async () => {
    const seq = await I.lastSeq(tid);
    const inv = { ...D.si1(), invoiceNumber: 'SYN-DD-A001', totalDue: '3910' };
    const r = await D.postInvoice(SS.ANALYST, { ...inv, tariffId: maersk, calendarId: null });
    expect(r.status, r.text).toBe(201);
    S('DdInvoiceDetail').parse(r.body);
    expect([r.body.status, r.body.version, r.body.claimId, r.body.claimNumber, r.body.auditedAt]).toEqual(['DRAFT', 1, null, null, null]);
    expect(r.body.invoice.totalDue).toBe('3910.00');
    expect(r.body.invoice).toEqual({ ...inv, totalDue: '3910.00', tariffId: maersk, calendarId: null });
    expect(r.body.preview).toEqual(R.auditDdInvoice({ invoice: { ...inv, totalDue: '3910.00' }, tariff: D.MAERSK, calendar: null }));
    expect(r.body.preview.findings).toEqual([]);
    const u = await D.putInvoice(SS.ANALYST, r.body.id, { version: 1, invoice: { ...inv, totalDue: '3910.00', dueDate: '2026-04-27', tariffId: maersk, calendarId: null } });
    expect(u.status, u.text).toBe(200);
    expect(u.body.version).toBe(2);
    D.expectCode(await D.putInvoice(SS.ANALYST, r.body.id, { version: 1, invoice: { ...inv, tariffId: maersk, calendarId: null } }), 409, 'stale_revision');
    const list = await D.invoices(SS.VIEWER, '?status=DRAFT');
    S('DdInvoiceList').parse(list.body);
    const item = list.body.items.find((x: { id: string }) => x.id === r.body.id);
    expect(item).toMatchObject({ status: 'DRAFT', version: 2, invoiceNumber: 'SYN-DD-A001', billingPartyName: 'Synthetic Ocean Line A', direction: 'IMPORT', invoiceDate: '2026-03-27', totalDueCents: 391000, containerCount: 1, claimId: null, auditedAt: null });
    const d = await D.delInvoice(SS.ANALYST, r.body.id);
    expect(d.status, d.text).toBe(204);
    A.expectExact(await D.getInvoice(SS.VIEWER, r.body.id), 404, 'not_found');
    const evs = await I.eventsSince(tid, seq, 'dd_invoice.');
    expect(evs.map((e) => [e.action, e.target_type, e.target_id])).toEqual([['dd_invoice.created', 'dd_invoice', r.body.id], ['dd_invoice.updated', 'dd_invoice', r.body.id], ['dd_invoice.deleted', 'dd_invoice', r.body.id]]);
    expect(evs[0]?.metadata).toEqual({ invoiceId: r.body.id, version: 1, containerCount: 1, dataSha256: D.sha256Canon({ ...inv, totalDue: '3910.00' }) });
    expect(I.keysOf(evs[1]?.metadata)).toEqual(D.AUDIT_KEYS.invoice);
    expect(evs[2]?.metadata).toEqual({ invoiceId: r.body.id, version: 2 });
    D.noFreeText(evs, ['SYN-DD-A001', 'Synthetic Ocean Line A', 'Synthetic Importer Inc', 'SYNU0000001', 'SYNBL0001', 'example.com']);
  });
});

describe('T11 precedence and errors (C13)', () => {
  it('DD-A02 CSRF/origin 403 on mutating cookie requests; 401 without a session', async () => {
    for (const s of [SS.OWNER, SS.VIEWER]) {
      expectError(await D.postTariff(s, { ...D.MAERSK, name: D.uniq('csrf') }, { csrf: false }), 403, 'csrf_failed');
      expectError(await D.postInvoice(s, { bogus: true }, { headers: { origin: H.ORIGIN_BAD } }), 403, 'origin_not_allowed');
    }
    const anon = new Client(app);
    for (const [m, p] of [['GET', '/dd/tariffs'], ['GET', '/dd/calendars'], ['GET', '/dd/invoices'], ['GET', `/dd/invoices/${I.RAND_UUID}`], ['POST', '/dd/tariffs'], ['PUT', `/dd/tariffs/${I.RAND_UUID}`], ['POST', '/dd/calendars'], ['PUT', `/dd/calendars/${I.RAND_UUID}`], ['POST', '/dd/invoices'], ['PUT', `/dd/invoices/${I.RAND_UUID}`], ['DELETE', `/dd/invoices/${I.RAND_UUID}`], ['POST', `/dd/invoices/${I.RAND_UUID}/audit`]] as const) {
      expectError(await anon.send(m, p, m === 'GET' ? {} : { body: {} }), 401);
    }
  });
  it('DD-A02 429 after the bucket (intelligence for all but audit, analysis for audit), before 403/400, with Retry-After', async () => {
    const rl = await buildTestApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_INTELLIGENCE_MAX: '3', RATE_LIMIT_ANALYSIS_MAX: '2', RATE_LIMIT_GLOBAL_MAX: '100000', RATE_LIMIT_AUTH_MAX: '100000' });
    const v = I.onApp(rl, SS.VIEWER, '10.9.8.1');
    for (let k = 0; k < 3; k++) expect((await D.tariffs(v)).status).toBe(200);
    const r = await D.postTariff(v, { bogus: true });
    expectError(r, 429, 'rate_limited');
    expect(r.headers['retry-after']).toBeTruthy();
    const an = I.onApp(rl, SS.ANALYST, '10.9.8.2');
    for (let k = 0; k < 2; k++) expect((await D.audit(an, I.RAND_UUID)).status, 'audit of an unknown id').toBe(404);
    const third = await D.audit(an, I.RAND_UUID);
    expectError(third, 429, 'rate_limited');
    expect(third.headers['retry-after']).toBeTruthy();
    expect((await D.invoices(an)).status, 'intelligence bucket is separate from the analysis bucket').toBe(200);
  }, 60000);
  it('DD-A02 403 for VIEWER on writes and for ANALYST on tariff/calendar writes; 403 precedes 400', async () => {
    for (const [m, p] of [['POST', '/dd/tariffs'], ['PUT', `/dd/tariffs/${maersk}`], ['POST', '/dd/calendars'], ['PUT', `/dd/calendars/${I.RAND_UUID}`], ['POST', '/dd/invoices'], ['PUT', `/dd/invoices/${I.RAND_UUID}`], ['DELETE', `/dd/invoices/${I.RAND_UUID}`], ['POST', `/dd/invoices/${I.RAND_UUID}/audit`]] as const) {
      expectError(await SS.VIEWER.as(m, p, { body: { bogus: true } }), 403, 'forbidden');
    }
    for (const [m, p] of [['POST', '/dd/tariffs'], ['PUT', `/dd/tariffs/${maersk}`], ['POST', '/dd/calendars'], ['PUT', `/dd/calendars/${I.RAND_UUID}`]] as const) {
      expectError(await SS.ANALYST.as(m, p, { body: { bogus: true } }), 403, 'forbidden');
    }
    for (const r of ['PLATFORM_DEV', 'SUPER_ADMIN'] as const) expectError(await SS[r].get('/dd/invoices'), 403, 'forbidden');
  });
  it('DD-A02 400 validation_error on bad body, params and query', async () => {
    A.expectExact(await D.postInvoice(SS.ANALYST, { bogus: true }), 400, 'validation_error');
    A.expectExact(await D.postTariff(SS.OWNER, { ...D.MAERSK, name: D.uniq('bad'), workingWeekdays: [] }), 400, 'validation_error');
    A.expectExact(await D.postCalendar(SS.OWNER, { name: D.uniq('bad'), closedDates: ['2026-07-03'], shutoutDates: ['2026-07-03'] }), 400, 'validation_error');
    for (const q of ['?pageSize=101', '?page=0', '?pageSize=0', '?extra=1']) A.expectExact(await D.tariffs(SS.VIEWER, q), 400, 'validation_error', q);
    for (const q of ['?status=OPEN', '?status=draft']) A.expectExact(await D.invoices(SS.VIEWER, q), 400, 'validation_error', q);
    A.expectExact(await D.putTariff(SS.OWNER, maersk, { version: 0, data: D.MAERSK }), 400, 'validation_error');
    A.expectExact(await SS.ANALYST.post(`/dd/invoices/${I.RAND_UUID}/audit`, { extra: 1 }), 400, 'validation_error');
  });
  it('DD-A02 404 for unknown, non-UUID and other-tenant ids (byte-identical apart from requestId); 400 reference not_found', async () => {
    const own = await D.newInvoice(SS.ANALYST, { ...D.si1(), invoiceNumber: 'SYN-DD-A404' }, null);
    const gx = await D.newInvoice(gxo, { ...D.si1(), invoiceNumber: 'SYN-DD-G404' }, null);
    const unknown = await D.getInvoice(SS.VIEWER, I.RAND_UUID);
    A.expectExact(unknown, 404, 'not_found');
    I.expectIdentical404(unknown, await D.getInvoice(SS.VIEWER, 'not-a-uuid'));
    I.expectIdentical404(unknown, await D.getInvoice(SS.VIEWER, gx.id));
    I.expectIdentical404(unknown, await D.putInvoice(SS.ANALYST, gx.id, { version: 1, invoice: { ...D.si1(), tariffId: null, calendarId: null } }));
    I.expectIdentical404(unknown, await D.delInvoice(SS.ANALYST, gx.id));
    I.expectIdentical404(unknown, await D.audit(SS.ANALYST, gx.id));
    I.expectIdentical404(unknown, await D.putTariff(SS.OWNER, gxTariff, { version: 1, data: { ...D.MAERSK, name: D.uniq('x') } }));
    I.expectIdentical404(unknown, await D.putCalendar(SS.OWNER, gxCalendar, { version: 1, data: { ...D.HAPAG_CAL, name: D.uniq('x') } }));
    for (const [path, body] of [['tariffId', { tariffId: gxTariff, calendarId: null }], ['calendarId', { tariffId: null, calendarId: gxCalendar }], ['tariffId', { tariffId: I.RAND_UUID, calendarId: null }]] as const) {
      const r = await D.postInvoice(SS.ANALYST, { ...D.si1(), invoiceNumber: D.uniq('SYN-DD-REF'), ...body });
      A.expectExact(r, 400, 'validation_error', path);
      expect(r.body.error.details).toContainEqual(expect.objectContaining({ path, code: 'not_found' }));
      const u = await D.putInvoice(SS.ANALYST, own.id, { version: 1, invoice: { ...D.si1(), invoiceNumber: 'SYN-DD-A404', ...body } });
      A.expectExact(u, 400, 'validation_error', `PUT ${path}`);
      expect(u.body.error.details).toContainEqual(expect.objectContaining({ path, code: 'not_found' }));
    }
    D.expectCode(await D.postInvoice(SS.ANALYST, { ...D.si1(), invoiceNumber: 'SYN-DD-A404', tariffId: null, calendarId: null }), 409, 'conflict', 'duplicate (billing party, invoice number)');
    expect((await D.postInvoice(SS.ANALYST, { ...D.si1(), invoiceNumber: 'SYN-DD-A404', billingPartyName: 'Synthetic Ocean Line B', tariffId: null, calendarId: null })).status, 'same number, other billing party').toBe(201);
  });
  it('DD-A02 409 dd_limit_reached on the 201st tariff and calendar', async () => {
    const fx = await I.fixtureTenant(app, 'dd-limit', 'Synthetic Limit Org');
    const have = (await D.tariffs(fx.owner, '?pageSize=100')).body.total as number;
    for (let k = have; k < 200; k++) expect((await D.postTariff(fx.owner, { ...D.MAERSK, name: `Synthetic tariff ${k}` })).status).toBe(201);
    D.expectCode(await D.postTariff(fx.owner, { ...D.MAERSK, name: 'Synthetic tariff 201' }), 409, 'dd_limit_reached');
    for (let k = 0; k < 200; k++) expect((await D.postCalendar(fx.owner, { name: `Synthetic calendar ${k}`, closedDates: [], shutoutDates: [] })).status).toBe(201);
    D.expectCode(await D.postCalendar(fx.owner, { name: 'Synthetic calendar 201', closedDates: [], shutoutDates: [] }), 409, 'dd_limit_reached');
    expect((await D.tariffs(fx.owner, '?pageSize=1')).body.total).toBe(200);
  }, 300000);
  it('DD-A03 API keys get 403 forbidden on every D&D route; only apikey.use_denied may be written', async () => {
    const k = await K.mkKey(SS.OWNER, [...K.SCOPES]);
    const seq = await I.lastSeq(tid);
    const routes: [string, string, unknown][] = [
      ['GET', '/dd/tariffs', undefined], ['POST', '/dd/tariffs', { ...D.MAERSK, name: 'Key probe' }], ['PUT', `/dd/tariffs/${maersk}`, { version: 1, data: D.MAERSK }],
      ['GET', '/dd/calendars', undefined], ['POST', '/dd/calendars', D.HAPAG_CAL], ['PUT', `/dd/calendars/${I.RAND_UUID}`, { version: 1, data: D.HAPAG_CAL }],
      ['GET', '/dd/invoices', undefined], ['POST', '/dd/invoices', { ...D.si1(), tariffId: null, calendarId: null }], ['GET', `/dd/invoices/${I.RAND_UUID}`, undefined],
      ['PUT', `/dd/invoices/${I.RAND_UUID}`, { version: 1, invoice: { ...D.si1(), tariffId: null, calendarId: null } }], ['DELETE', `/dd/invoices/${I.RAND_UUID}`, undefined],
      ['POST', `/dd/invoices/${I.RAND_UUID}/audit`, {}],
    ];
    for (const [m, p, body] of routes) expectError(await K.keyReq(app, k.secret, m, p, body === undefined ? {} : { body }), 403, 'forbidden');
    expect((await I.eventsSince(tid, seq)).map((e) => e.action).filter((a) => a !== 'apikey.use_denied')).toEqual([]);
  });
  it('DD-A04 flag off: every D&D route 404 after 401/429/403/400; /features shows it off; back on restores', async () => {
    const dev = I.onApp(app, SS.PLATFORM_DEV);
    const draft = await D.newInvoice(SS.ANALYST, { ...D.si1(), invoiceNumber: D.uniq('SYN-DD-FLAG') }, null);
    await I.setFlag(dev, 'intelligence.ocean_dd', false, 'acceptance ocean_dd flag off');
    try {
      expect((await SS.VIEWER.get('/features')).body.flags['intelligence.ocean_dd']).toBe(false);
      expectError(await new Client(app).send('GET', '/dd/tariffs'), 401);
      expectError(await D.postTariff(SS.VIEWER, D.MAERSK), 403, 'forbidden');
      A.expectExact(await D.postInvoice(SS.ANALYST, { bogus: true }), 400, 'validation_error');
      for (const r of [await D.tariffs(SS.VIEWER), await D.calendars(SS.VIEWER), await D.invoices(SS.VIEWER), await D.getInvoice(SS.VIEWER, draft.id),
        await D.postTariff(SS.OWNER, { ...D.MAERSK, name: D.uniq('off') }), await D.putTariff(SS.OWNER, maersk, { version: 1, data: D.MAERSK }),
        await D.postCalendar(SS.OWNER, { ...D.HAPAG_CAL, name: D.uniq('off') }), await D.postInvoice(SS.ANALYST, { ...D.si1(), invoiceNumber: D.uniq('off'), tariffId: null, calendarId: null }),
        await D.putInvoice(SS.ANALYST, draft.id, { version: 1, invoice: { ...D.si1(), tariffId: null, calendarId: null } }), await D.delInvoice(SS.ANALYST, draft.id), await D.audit(SS.ANALYST, draft.id)]) A.expectExact(r, 404, 'not_found');
    } finally {
      await I.setFlag(dev, 'intelligence.ocean_dd', true, 'acceptance ocean_dd flag on');
    }
    expect((await D.getInvoice(SS.VIEWER, draft.id)).status).toBe(200);
    expect((await SS.VIEWER.get('/features')).body.flags['intelligence.ocean_dd']).toBe(true);
  }, 120000);
  it('DD-A05 /me lists dd_invoices:manage and dd_tariffs:manage exactly per C14', async () => {
    for (const role of ALL_ROLES) {
      const me = await SS[role].get('/me');
      expect(me.status, role).toBe(200);
      expect(me.body.permissions.includes('dd_invoices:manage'), `${role} dd_invoices:manage`).toBe(['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST'].includes(role));
      expect(me.body.permissions.includes('dd_tariffs:manage'), `${role} dd_tariffs:manage`).toBe(['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER'].includes(role));
    }
  });
  it('DD-A06 preview of SI-4 equals the T3 result; a tariff edit changes the DRAFT preview', async () => {
    const tId = await D.newTariff(SS.OWNER, { ...D.MAERSK, name: D.uniq('Maersk preview') });
    const inv = await D.newInvoice(SS.ANALYST, { ...D.si4(), invoiceNumber: D.uniq('SYN-DD-PRE') }, tId);
    const g = await D.getInvoice(SS.VIEWER, inv.id);
    expect(g.body.preview.findings.map((f: { ruleId: string; amountCents: number; needsHumanReview: boolean }) => [f.ruleId, f.amountCents, f.needsHumanReview])).toEqual([['DD-TARIFF-OVERCHARGE', 29000, false], ['DD-541-6-CONTENT', 391000, true]]);
    expect([g.body.preview.recoverableCents, g.body.preview.pendingReviewCents]).toEqual([29000, 391000]);
    const t = await D.putTariff(SS.OWNER, tId, { version: 1, data: { ...D.MAERSK, name: D.uniq('Maersk preview 2'), tiers: [{ days: 4, rates: { '40DV': '200.00' } }, { days: 4, rates: { '40DV': '260.00' } }, { days: null, rates: { '40DV': '290.00' } }] } });
    expect(t.status, t.text).toBe(200);
    const g2 = await D.getInvoice(SS.VIEWER, inv.id);
    expect(g2.body.preview.findings[0]).toMatchObject({ ruleId: 'DD-TARIFF-OVERCHARGE', amountCents: 33000 });
  });
  it('DD-A07 payload limits (fix round 1): 51 containers -> 400; maximal invoice 201/200; 262,145 bytes -> 413 on POST/PUT; other routes keep the global limit', async () => {
    const big = D.si1();
    big.containers = Array.from({ length: 51 }, () => D.clone(D.c0(D.si1())));
    A.expectExact(await D.postInvoice(SS.ANALYST, { ...big, invoiceNumber: D.uniq('SYN-DD-51'), tariffId: null, calendarId: null }), 400, 'validation_error');
    const body = { ...D.maximalInvoice('SYN-DD-MAX'), tariffId: null, calendarId: null };
    const bytes = Buffer.byteLength(JSON.stringify(body));
    // above the 65,536-byte global default, so it only fits under the per-route invoice limit
    expect(bytes, `maximal invoice is ${bytes} bytes`).toBeGreaterThan(65_536);
    expect(bytes).toBeLessThanOrEqual(262_144);
    const created = await D.postInvoice(SS.ANALYST, body);
    expect(created.status, created.text).toBe(201);
    const put = await D.putInvoice(SS.ANALYST, created.body.id, { version: 1, invoice: { ...body, dueDate: '2026-04-27' } });
    expect(put.status, put.text).toBe(200);
    const json = { 'content-type': 'application/json' };
    expect(Buffer.byteLength(D.paddedJson(262_145))).toBe(262_145);
    expectError(await SS.ANALYST.as('POST', '/dd/invoices', { raw: D.paddedJson(262_145), headers: json }), 413, 'payload_too_large');
    expectError(await SS.ANALYST.as('PUT', `/dd/invoices/${created.body.id}`, { raw: D.paddedJson(262_145), headers: json }), 413, 'payload_too_large');
    expectError(await SS.OWNER.as('POST', '/dd/tariffs', { raw: D.paddedJson(100_000), headers: json }), 413, 'payload_too_large');
    expectError(await SS.MANAGER.as('POST', `/claims/${I.RAND_UUID}/packet/revisions`, { raw: D.paddedJson(100_000), headers: json }), 413, 'payload_too_large');
  });
  it('DD-A08 invoice list paging: pageSize 50 ok, 51 -> 400; tariff/calendar lists 100 ok, 101 -> 400; list direction/containerCount match the detail', async () => {
    expect((await D.invoices(SS.VIEWER, '?pageSize=50')).status).toBe(200);
    A.expectExact(await D.invoices(SS.VIEWER, '?pageSize=51'), 400, 'validation_error');
    for (const f of [D.tariffs, D.calendars]) {
      expect((await f(SS.VIEWER, '?pageSize=100')).status).toBe(200);
      A.expectExact(await f(SS.VIEWER, '?pageSize=101'), 400, 'validation_error');
    }
    const exp = await D.newInvoice(SS.ANALYST, { ...D.si1(), invoiceNumber: D.uniq('SYN-DD-EXP'), direction: 'EXPORT', portOfDischarge: null }, null);
    const two = D.si1();
    two.containers.push({ ...D.clone(D.c0(D.si1())), containerNumber: 'SYNU0000002' });
    const drf = await D.newInvoice(SS.ANALYST, { ...two, invoiceNumber: D.uniq('SYN-DD-TWO') }, null);
    const aud = await D.newInvoice(SS.ANALYST, { ...D.si4(), invoiceNumber: D.uniq('SYN-DD-AUD') }, maersk);
    expect((await D.audit(SS.ANALYST, aud.id)).status).toBe(201);
    const items: { id: string; direction: string; containerCount: number; status: string }[] = [];
    for (let page = 1; ; page++) {
      const r = await D.invoices(SS.VIEWER, `?pageSize=50&page=${page}`);
      expect(r.status, r.text).toBe(200);
      S('DdInvoiceList').parse(r.body);
      items.push(...r.body.items);
      if (page * 50 >= r.body.total) break;
    }
    for (const id of [exp.id, drf.id, aud.id]) {
      const d = (await D.getInvoice(SS.VIEWER, id)).body;
      const row = items.find((x) => x.id === id);
      expect([row?.status, row?.direction, row?.containerCount], id).toEqual([d.status, d.invoice.direction, d.invoice.containers.length]);
    }
  });
  it('DD-A09 invoice cap 2,000 (DRAFT + AUDITED): 409 dd_limit_reached with the new text; precedence; other tenant unaffected; deleting one frees a slot', async () => {
    const fx = await I.fixtureTenant(app, 'dd-cap', 'Synthetic Cap Org');
    const fan = fx.analyst;
    const capT = await D.newTariff(fx.owner, { ...D.MAERSK, name: 'Synthetic cap tariff' });
    const audited = await D.newInvoice(fan, { ...D.si4(), invoiceNumber: 'SYN-DD-CAP-A' }, capT);
    expect((await D.audit(fan, audited.id)).status).toBe(201);
    const draft = await D.newInvoice(fan, { ...D.si1(), invoiceNumber: 'SYN-DD-CAP-D' }, null);
    await D.seedDraftInvoices(fx.id, fx.ownerId, 1998, 'SYN-DD-CAP-S');
    expect((await D.invoices(fan, '?pageSize=1')).body.total).toBe(2000);
    D.expectCode(await D.postInvoice(fan, { ...D.si1(), invoiceNumber: 'SYN-DD-CAP-X', tariffId: null, calendarId: null }), 409, 'dd_limit_reached');
    const unknownRef = await D.postInvoice(fan, { ...D.si1(), invoiceNumber: 'SYN-DD-CAP-Y', tariffId: I.RAND_UUID, calendarId: null });
    A.expectExact(unknownRef, 400, 'validation_error', 'reference not_found precedes the cap');
    expect(unknownRef.body.error.details).toContainEqual(expect.objectContaining({ path: 'tariffId', code: 'not_found' }));
    D.expectCode(await D.postInvoice(fan, { ...D.si1(), invoiceNumber: 'SYN-DD-CAP-D', tariffId: null, calendarId: null }), 409, 'dd_limit_reached', 'duplicate at the cap');
    expect((await D.postInvoice(SS.ANALYST, { ...D.si1(), invoiceNumber: D.uniq('SYN-DD-OTHER'), tariffId: null, calendarId: null })).status, 'tenant B unaffected').toBe(201);
    expect((await D.delInvoice(fan, draft.id)).status).toBe(204);
    D.expectCode(await D.postInvoice(fan, { ...D.si1(), invoiceNumber: 'SYN-DD-CAP-S-1', tariffId: null, calendarId: null }), 409, 'conflict', 'duplicate below the cap');
    expect((await D.postInvoice(fan, { ...D.si1(), invoiceNumber: 'SYN-DD-CAP-Z', tariffId: null, calendarId: null })).status, 'a freed slot').toBe(201);
  }, 300000);
  it('DD-A10 cross-tenant REAL ids: 400 not_found byte-identical to a random UUID; nothing written, no audit event', async () => {
    const own = await D.newInvoice(SS.ANALYST, { ...D.si1(), invoiceNumber: D.uniq('SYN-DD-A10') }, null);
    const noReq = (t: string) => t.replace(/"requestId":"[^"]*"/, '');
    for (const [path, real] of [['tariffId', gxTariff], ['calendarId', gxCalendar]] as const) {
      const refs = (id: string) => (path === 'tariffId' ? { tariffId: id, calendarId: null } : { tariffId: null, calendarId: id });
      const num = D.uniq('SYN-DD-A10X');
      const seq = await I.lastSeq(tid);
      const totalBefore = (await D.invoices(SS.VIEWER, '?pageSize=1')).body.total;
      const realPost = await D.postInvoice(SS.ANALYST, { ...D.si1(), invoiceNumber: num, ...refs(real) });
      const randPost = await D.postInvoice(SS.ANALYST, { ...D.si1(), invoiceNumber: num, ...refs(I.RAND_UUID) });
      A.expectExact(realPost, 400, 'validation_error', path);
      expect(realPost.body.error.details).toContainEqual(expect.objectContaining({ path, code: 'not_found' }));
      expect(noReq(realPost.text), `${path} POST byte-identical`).toBe(noReq(randPost.text));
      const realPut = await D.putInvoice(SS.ANALYST, own.id, { version: 1, invoice: { ...D.si1(), invoiceNumber: 'SYN-DD-A10P', ...refs(real) } });
      const randPut = await D.putInvoice(SS.ANALYST, own.id, { version: 1, invoice: { ...D.si1(), invoiceNumber: 'SYN-DD-A10P', ...refs(I.RAND_UUID) } });
      A.expectExact(realPut, 400, 'validation_error', `${path} PUT`);
      expect(noReq(realPut.text), `${path} PUT byte-identical`).toBe(noReq(randPut.text));
      expect((await D.invoices(SS.VIEWER, '?pageSize=1')).body.total).toBe(totalBefore);
      expect((await D.getInvoice(SS.VIEWER, own.id)).body.version).toBe(1);
      expect(await I.eventsSince(tid, seq)).toEqual([]);
    }
  });
});

describe('T13 audit chain after the route tests (C15)', () => {
  it('DD-E01 refused calls write no event; DD-E02 /audit/verify stays valid', async () => {
    const seq = await I.lastSeq(tid);
    D.expectCode(await D.postTariff(SS.OWNER, R.DD_TARIFF_PRESETS[0]?.data), 409, 'conflict');
    A.expectExact(await D.postInvoice(SS.ANALYST, { bogus: true }), 400, 'validation_error');
    expectError(await D.postTariff(SS.ANALYST, D.MAERSK), 403, 'forbidden');
    // C15: refused calls write no dd_* event. The 403 writes only the platform's existing authz.denied event
    // (Tier H run a8a299a: the earlier "no event at all" assertion was test design).
    const evs = await I.eventsSince(tid, seq);
    expect(evs.filter((e) => e.action.startsWith('dd_'))).toEqual([]);
    expect(evs.map((e) => [e.action, e.actor_role, e.metadata])).toEqual([['authz.denied', 'ANALYST', { method: 'POST', permission: 'dd_tariffs:manage', route: '/api/v1/dd/tariffs' }]]);
    const v = await SS.OWNER.get('/audit/verify');
    expect(v.body.valid, v.text).toBe(true);
    expect((await I.eventsSince(gtid, 0, 'dd_')).length, 'Globex events stay in the Globex chain').toBeGreaterThan(0);
    expect((await gxo.get('/audit/verify')).body.valid).toBe(true);
  });
});
