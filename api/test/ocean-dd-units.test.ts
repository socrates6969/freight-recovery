/**
 * Step 8 (REQ-20261011-ocean-dd) API units without a database: `buildDdPacket` (sources and sha256, citations,
 * CFR clauses, timeline, letter, persistability, content-hash stability, snapshot hash) and route
 * registration (every D&D route needs authentication before anything else).
 */
import { createHash } from 'node:crypto';

import { AnalysisInputError, DD_PACKET_DISCLAIMER, DD_REGULATION_TEXT, DD_TARIFF_PRESETS, DdInvoiceData, DdTariffData, canonicalJson, type DdInvoiceDataDto } from '@fr/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { ROUTE_BODY_LIMIT_MAX, defineRoute } from '../src/http/route.js';
import { buildDdPacket } from '../src/ocean-dd/audit-run.js';
import { ddSha256 } from '../src/ocean-dd/service.js';

const MAERSK = DdTariffData.parse(DD_TARIFF_PRESETS[0]?.data);
const NOW = new Date('2026-10-11T08:00:00.000Z');
const ACTOR = '22222222-2222-4222-8222-222222222222';
const sha = (v: unknown): string => createHash('sha256').update(canonicalJson(v), 'utf8').digest('hex');

/** A synthetic invoice: Maersk 40DV detention 2026-03-06..03-20 charged at $290/day. */
function invoice(over: Record<string, unknown> = {}, periods?: unknown[]): DdInvoiceDataDto {
  return DdInvoiceData.parse({
    invoiceNumber: 'SYN-DD-0001',
    billingPartyName: 'Synthetic Ocean Line',
    billingPartyType: 'OCEAN_CARRIER',
    billedPartyName: 'Example Importer LLC',
    direction: 'IMPORT',
    invoiceDate: '2026-03-25',
    dueDate: '2026-04-24',
    upstreamInvoiceDate: null,
    billOfLadingNumbers: ['SYNBL0001'],
    portOfDischarge: 'Port of Example',
    liabilityBasis: 'Consignee named on the bill of lading',
    totalDue: '4350.00',
    ruleReference: 'Synthetic tariff rule 1',
    disputeContact: 'disputes@example.test',
    disputeDigitalMeans: 'https://example.test/dd-disputes',
    disputeRequestDays: 30,
    disputeResolutionDays: 30,
    certifiesFmcRules: true,
    certifiesPerformance: true,
    containers: [
      {
        containerNumber: 'SYNU0000001',
        sizeType: '40DV',
        chargeType: 'DETENTION',
        freeDays: 4,
        freeTimeStart: '2026-03-02',
        freeTimeEnd: '2026-03-05',
        availabilityDate: '2026-03-01',
        earliestReturnDate: null,
        periods: periods ?? [{ from: '2026-03-06', to: '2026-03-20', rate: '290', amount: '4350' }],
        evidence: { clockStart: null, clockStop: null, cargoAvailableDate: null, emptyReturnRefusedDates: [] },
      },
    ],
    ...over,
  });
}

describe('buildDdPacket', () => {
  it('sources: invoice, tariff, regulation with sha256 and UTF-8 size of the canonical JSON', () => {
    const inv = invoice();
    const b = buildDdPacket({ invoice: inv, tariff: MAERSK, calendar: null, now: NOW, actorId: ACTOR });
    expect(b.sources.map((s) => [s.ordinal, s.filename, s.docType])).toEqual([
      [1, 'dd-invoice.json', 'INVOICE'],
      [2, 'dd-tariff.json', 'OTHER'],
      [3, 'ecfr-46-cfr-541-545.5.json', 'OTHER'],
    ]);
    expect(b.sources[0]?.sha256).toBe(sha(inv));
    expect(b.sources[0]?.sizeBytes).toBe(Buffer.byteLength(canonicalJson(inv), 'utf8'));
    expect(b.sources[2]?.sha256).toBe(sha(DD_REGULATION_TEXT));
    expect(b.packet).toMatchObject({ revision: 1, status: 'PENDING_REVIEW', perspective: 'SHIPPER', loadNumber: null, disclaimer: DD_PACKET_DISCLAIMER, createdById: ACTOR, recoverableCents: 44000, pendingReviewCents: 0 });
    expect(b.packet.demandLetter.split('\n').slice(0, 3)).toEqual(['DRAFT - FOR HUMAN REVIEW. NOT SENT. NOT LEGAL ADVICE.', '', 'Date: 2026-10-11']);
  });

  it('findings carry citations into the source files and the tariff clause', () => {
    const b = buildDdPacket({ invoice: invoice(), tariff: MAERSK, calendar: null, now: NOW, actorId: ACTOR });
    const [inv, tariff] = b.sources;
    expect(b.findings).toHaveLength(1);
    const f = b.findings[0];
    expect(f).toMatchObject({ ordinal: 1, ruleId: 'DD-TARIFF-OVERCHARGE', direction: 'OVERCHARGE', amountCents: 44000, confidence: 0.9, needsHumanReview: false });
    expect(f?.citations).toEqual([
      { sourceId: inv?.id, locator: 'dd-invoice.json#/containers/0/periods/0/amount', excerpt: '4350.00' },
      { sourceId: inv?.id, locator: 'dd-invoice.json#/containers/0/freeTimeStart', excerpt: '2026-03-02' },
      { sourceId: tariff?.id, locator: 'dd-tariff.json#/tiers', excerpt: expect.stringMatching(/^\[\{"days":4,/u) as unknown as string },
    ]);
    expect(f?.clauseSourceId).toBe(tariff?.id);
    expect(f?.clauseLocator).toBe('dd-tariff.json#/tiers');
    expect(f?.clauseLabel).toBe('Attached tariff');
  });

  it('regulation clauses and the timeline of a late invoice', () => {
    const b = buildDdPacket({ invoice: invoice({ invoiceDate: '2026-04-25' }), tariff: null, calendar: null, now: NOW, actorId: ACTOR });
    expect(b.sources.map((s) => s.filename)).toEqual(['dd-invoice.json', 'ecfr-46-cfr-541-545.5.json']);
    const late = b.findings.find((f) => f.ruleId === 'DD-541-7-LATE');
    expect(late?.clauseLocator).toBe('ecfr-46-cfr-541-545.5.json#46 CFR 541.7(a)');
    expect(late?.clauseSourceId).toBe(b.sources[1]?.id);
    expect(late?.clauseLabel).toBe('46 CFR 541.7(a)');
    expect(b.timeline.map((t) => [t.ordinal, t.occurredAt.toISOString(), t.kind, t.label])).toEqual([
      [1, '2026-03-20T00:00:00.000Z', 'NOTE', 'Charges last incurred'],
      [2, '2026-04-19T00:00:00.000Z', 'NOTE', '30-day issuance limit (46 CFR 541.7)'],
      [3, '2026-04-25T00:00:00.000Z', 'INVOICE', 'Invoice SYN-DD-0001 issued'],
    ]);
    expect(b.timeline.every((t) => t.sourceId === b.sources[0]?.id)).toBe(true);
    const nvocc = buildDdPacket({ invoice: invoice({ billingPartyType: 'NVOCC' }), tariff: null, calendar: null, now: NOW, actorId: ACTOR });
    expect(nvocc.timeline.map((t) => t.label)).toEqual(['Charges last incurred', 'Invoice SYN-DD-0001 issued']);
  });

  it('content hash is stable across builds (ids differ), snapshot hash is over the snapshot', () => {
    const inv = invoice();
    const a = buildDdPacket({ invoice: inv, tariff: MAERSK, calendar: null, now: NOW, actorId: ACTOR });
    const b = buildDdPacket({ invoice: inv, tariff: MAERSK, calendar: null, now: NOW, actorId: ACTOR });
    expect(a.sources[0]?.id).not.toBe(b.sources[0]?.id);
    expect(a.packet.contentHash).toBe(b.packet.contentHash);
    expect(a.packet.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(a.snapshot).toEqual({ invoice: inv, tariff: MAERSK, calendar: null, rulesVersion: 'dd-rules-v1' });
    expect(a.snapshotSha256).toBe(sha(a.snapshot));
    expect(ddSha256(inv)).toBe(sha(inv));
  });

  it('refuses results that do not fit the int4 cents columns', () => {
    const huge = [
      { from: '2026-03-06', to: '2026-03-06', rate: '0.01', amount: '9999999.99' },
      { from: '2026-03-07', to: '2026-03-07', rate: '0.01', amount: '9999999.99' },
      { from: '2026-03-08', to: '2026-03-08', rate: '0.01', amount: '9999999.99' },
    ];
    expect(() => buildDdPacket({ invoice: invoice({ totalDue: null }, huge), tariff: null, calendar: null, now: NOW, actorId: ACTOR })).toThrow(AnalysisInputError);
  });
});

describe('per-route body limit (fix round 1, S4)', () => {
  it('accepts 1..262144 and refuses anything larger at registration', async () => {
    const { default: Fastify } = await import('fastify');
    const f = Fastify();
    const def = (bodyLimit: number, url: string) => ({ method: 'POST' as const, url, access: { kind: 'public' as const }, bodyLimit, handler: async () => ({}) });
    expect(ROUTE_BODY_LIMIT_MAX).toBe(262144);
    expect(() => defineRoute(f, def(262144, '/ok'))).not.toThrow();
    expect(() => defineRoute(f, def(262145, '/too-big'))).toThrow(/bodyLimit/u);
    expect(() => defineRoute(f, def(0, '/zero'))).toThrow(/bodyLimit/u);
    await f.close();
  });
});

describe('D&D routes (no database)', () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it('every route is registered and refuses unauthenticated requests before route logic', async () => {
    app = await buildApp({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/none',
      JWT_SECRET: 'unit-jwt-secret-0123456789abcdef0123456789abcdef',
      CSRF_SECRET: 'unit-csrf-secret-0123456789abcdef0123456789abcdef',
      REFRESH_PEPPER: 'unit-pepper-0123456789abcdef0123456789abcdef0123',
      MFA_ENC_KEY: Buffer.alloc(32, 3).toString('base64'),
      APP_ORIGIN: 'http://127.0.0.1:8080',
      COOKIE_SECURE: 'false',
      LOG_LEVEL: 'silent',
      ARGON2_MEMORY_KIB: '8',
      ARGON2_TIME_COST: '1',
      ENABLE_DEV_OUTBOX: 'false',
      RATE_LIMIT_ENABLED: 'false',
      REDIS_URL: '',
      TRUST_PROXY: '',
    });
    await app.ready();
    const id = '11111111-1111-4111-8111-111111111111';
    const routes: [string, string][] = [
      ['GET', '/api/v1/dd/tariffs'],
      ['GET', '/api/v1/dd/calendars'],
      ['GET', '/api/v1/dd/invoices'],
      ['GET', `/api/v1/dd/invoices/${id}`],
    ];
    for (const [method, url] of routes) {
      const r = await app.inject({ method: method as 'GET', url });
      expect([url, r.statusCode, (r.json() as { error: { code: string } }).error.code]).toEqual([url, 401, 'unauthenticated']);
    }
    for (const [method, url] of [
      ['POST', '/api/v1/dd/tariffs'],
      ['PUT', `/api/v1/dd/tariffs/${id}`],
      ['POST', '/api/v1/dd/calendars'],
      ['PUT', `/api/v1/dd/calendars/${id}`],
      ['POST', '/api/v1/dd/invoices'],
      ['PUT', `/api/v1/dd/invoices/${id}`],
      ['DELETE', `/api/v1/dd/invoices/${id}`],
      ['POST', `/api/v1/dd/invoices/${id}/audit`],
    ] as const) {
      // Mutating requests: the pipeline refuses them (CSRF/Origin 403 or 401) before any route logic; never 404.
      const r = await app.inject({ method, url, headers: { authorization: 'Bearer not-a-token', 'content-type': 'application/json' }, payload: '{}' });
      const code = (r.json() as { error: { code: string } }).error.code;
      expect([url, [401, 403].includes(r.statusCode), ['unauthenticated', 'csrf_failed', 'origin_not_allowed'].includes(code)]).toEqual([url, true, true]);
    }
  });
});
