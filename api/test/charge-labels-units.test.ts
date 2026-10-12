/**
 * Step 6 charge-label service (no database): outcomes created/changed/unchanged, the cap, the single
 * retry on a concurrent create, 404s, audit metadata (no description or normalized text) and paging.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const audits: { action: string; targetId: string | null; metadata: Record<string, unknown> }[] = [];
vi.mock('../src/audit/audit.js', () => ({
  appendAudit: vi.fn(async (_tx: unknown, e: { action: string; targetId: string | null; metadata: Record<string, unknown> }) => {
    audits.push({ action: e.action, targetId: e.targetId, metadata: e.metadata });
    return { id: 'a', seq: 1, hash: 'h' };
  }),
}));
const locks: string[] = [];
vi.mock('../src/db/charge-label-locks.js', () => ({
  lockChargeLabels: vi.fn(async (_tx: unknown, tenantId: string) => {
    locks.push(tenantId);
  }),
}));
vi.mock('../src/imports/bundle.js', () => ({
  loadAnalysisInput: vi.fn(async () => ({
    bundle: {
      invoice: { lines: [{ description: 'Lumper fee', amount: '75.00' }, { description: 'Linehaul', amount: '1000.00' }, { description: 'Lumper fee', amount: '75.00' }] },
      rate_confirmation: null,
      bol: null,
      warnings: [],
    },
    provenance: {},
    sources: [],
  })),
}));

// Hardening (C3): the influence ids come from the audit chain (raw SQL); faked per test.
let influenceIds: string[] | null = null;
vi.mock('../src/audit/label-influence.js', () => ({ learnedLabelIdsOfClaim: vi.fn(async () => influenceIds) }));

const { chargeLines, deleteLabel, influenceView, listLabels, setLabel } = await import('../src/intelligence/charges.js');
const { HttpError } = await import('../src/http/errors.js');

const T = '11111111-1111-4111-8111-111111111111';
const U = '22222222-2222-4222-8222-222222222222';
const CLAIM = '33333333-3333-4333-8333-333333333333';
const actor = { userId: U, role: 'REVIEWER' as const, ip: '127.0.0.1', requestId: 'r' };
const D = new Date('2026-10-11T00:00:00.000Z');

interface Row {
  id: string;
  normalizedText: string;
  description: string;
  category: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function fakeDb(rows: Row[], opts: { count?: number; uniqueFailures?: number } = {}) {
  let failures = opts.uniqueFailures ?? 0;
  const calls: string[] = [];
  const tx = {
    claim: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === CLAIM ? { id: CLAIM } : null)) },
    chargeLabel: {
      findFirst: vi.fn(async ({ where }: { where: { normalizedText?: string; id?: string } }) => rows.find((r) => r.normalizedText === where.normalizedText || r.id === where.id) ?? null),
      findMany: vi.fn(async (args: { skip?: number; take?: number }) => {
        calls.push(`findMany:${args.skip ?? '-'}:${args.take ?? '-'}`);
        return rows;
      }),
      count: vi.fn(async () => opts.count ?? rows.length),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (failures > 0) {
          failures -= 1;
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        calls.push(`create:${JSON.stringify(data)}`);
        const row = { id: '44444444-4444-4444-8444-444444444444', normalizedText: String(data['normalizedText']), description: String(data['description']), category: String(data['category']), version: 1, createdAt: D, updatedAt: D };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { description: string; category: string } }) => {
        const r = rows.find((x) => x.id === where.id);
        if (!r) throw new Error('missing');
        Object.assign(r, { description: data.description, category: data.category, version: r.version + 1 });
        return r;
      }),
      delete: vi.fn(async () => {
        calls.push('delete');
        return {};
      }),
    },
  };
  return { db: { tenantId: T, tx: <R>(fn: (t: never) => Promise<R>) => fn(tx as never) }, calls };
}

const row = (over: Partial<Row> = {}): Row => ({ id: '55555555-5555-4555-8555-555555555555', normalizedText: 'lumper fee', description: 'Lumper fee', category: 'accessorial', version: 1, createdAt: D, updatedAt: D, ...over });

beforeEach(() => {
  audits.length = 0;
  locks.length = 0;
});

/** sha256 of a normalized text (S4). */
const sha = async (t: string) => (await import('node:crypto')).createHash('sha256').update(t).digest('hex');

describe('setLabel', () => {
  it('creates a label keyed by normText with an audit event (no text in metadata)', async () => {
    const { db, calls } = fakeDb([]);
    const r = await setLabel(db as never, actor, { description: 'Lumper-Fee!', category: 'accessorial' });
    expect(r.outcome).toBe('created');
    expect(r.label).toMatchObject({ normalizedText: 'lumper fee', description: 'Lumper-Fee!', category: 'accessorial', version: 1, createdAt: D.toISOString() });
    expect(calls.some((c) => c.includes('"createdById":"' + U + '"') && c.includes('"updatedById":"' + U + '"'))).toBe(true);
    expect(audits).toEqual([
      { action: 'charge_label.set', targetId: r.label.id, metadata: { labelId: r.label.id, category: 'accessorial', outcome: 'created', normalizedTextSha256: await sha('lumper fee') } },
    ]);
    // S2: the per-tenant advisory lock is taken in the write transaction.
    expect(locks).toEqual([T]);
  });

  it('same category: unchanged, no write and no audit; other category: changed with previousCategory', async () => {
    const { db } = fakeDb([row()]);
    expect((await setLabel(db as never, actor, { description: 'LUMPER FEE', category: 'accessorial' })).outcome).toBe('unchanged');
    expect(audits).toEqual([]);
    const ch = await setLabel(db as never, actor, { description: 'Lumper fee', category: 'detention' });
    expect(ch).toMatchObject({ outcome: 'changed', label: { category: 'detention', version: 2 } });
    expect(audits[0]?.metadata).toEqual({ labelId: ch.label.id, category: 'detention', previousCategory: 'accessorial', outcome: 'changed', normalizedTextSha256: await sha('lumper fee') });
  });

  it('refuses a new label at the cap (409) but still allows updates', async () => {
    const { db } = fakeDb([row()], { count: 2000 });
    await expect(setLabel(db as never, actor, { description: 'New charge', category: 'fuel' })).rejects.toMatchObject({ statusCode: 409, code: 'label_limit_reached' });
    expect((await setLabel(db as never, actor, { description: 'lumper fee', category: 'other' })).outcome).toBe('changed');
  });

  it('retries once on a concurrent create; a second unique violation is 409 conflict (hardening, SC-8)', async () => {
    const once = fakeDb([], { uniqueFailures: 1 });
    expect((await setLabel(once.db as never, actor, { description: 'Pallet fee', category: 'accessorial' })).outcome).toBe('created');
    const twice = fakeDb([], { uniqueFailures: 2 });
    const e = await setLabel(twice.db as never, actor, { description: 'Pallet fee', category: 'accessorial' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect(e).toMatchObject({ statusCode: 409, code: 'conflict', message: 'The request conflicts with the current state.' });
  });
});

describe('deleteLabel, listLabels, chargeLines', () => {
  it('deleteLabel: non-UUID or unknown -> 404; otherwise delete + audit', async () => {
    const { db, calls } = fakeDb([row()]);
    await expect(deleteLabel(db as never, actor, 'nope')).rejects.toMatchObject({ statusCode: 404 });
    await expect(deleteLabel(db as never, actor, '66666666-6666-4666-8666-666666666666')).rejects.toMatchObject({ statusCode: 404 });
    await deleteLabel(db as never, actor, row().id);
    expect(calls).toContain('delete');
    expect(audits).toEqual([{ action: 'charge_label.deleted', targetId: row().id, metadata: { labelId: row().id, category: 'accessorial', normalizedTextSha256: await sha('lumper fee') } }]);
  });

  it('listLabels pages with skip/take', async () => {
    const { db, calls } = fakeDb([row()]);
    const r = await listLabels(db as never, { page: 3, pageSize: 10 });
    expect(r).toMatchObject({ page: 3, pageSize: 10, total: 1 });
    expect(calls).toContain('findMany:20:10');
  });

  it('chargeLines: every invoice line in order (duplicates included) with rule class, suggestion and team label', async () => {
    const { db } = fakeDb([row({ category: 'other' })]);
    await expect(chargeLines(db as never, 'x')).rejects.toMatchObject({ statusCode: 404 });
    await expect(chargeLines(db as never, '77777777-7777-4777-8777-777777777777')).rejects.toMatchObject({ statusCode: 404 });
    const r = await chargeLines(db as never, CLAIM);
    expect(r).toMatchObject({ claimId: CLAIM, classifierVersion: 'charge-knn-v1', seedVersion: 'tariff-seed-v1', threshold: 0.3 });
    expect(r.lines.map((l) => [l.index, l.description, l.ruleCategory, l.label?.category ?? null])).toEqual([
      [0, 'Lumper fee', 'accessorial', 'other'],
      [1, 'Linehaul', 'linehaul', null],
      [2, 'Lumper fee', 'accessorial', 'other'],
    ]);
    // The tenant label overrides the seed for the same normalized text.
    expect(r.lines[0]?.suggestion).toMatchObject({ category: 'other', similarity: 1, nearest: { origin: 'tenant', labelId: row().id } });
    // Hardening (C3): not analysed -> influence null.
    expect(r.influence).toBeNull();
  });

  it('hardening (F11): the tenant labels are read once per charge-lines request (suggestion and chip agree)', async () => {
    const { db, calls } = fakeDb([row({ category: 'other' })]);
    await chargeLines(db as never, CLAIM);
    expect(calls.filter((c) => c.startsWith('findMany'))).toHaveLength(1);
  });

  it('hardening (C3): influence lists the recorded ids in order; a deleted label has null description and category', async () => {
    const gone = '99999999-9999-4999-8999-999999999999';
    influenceIds = [gone, row().id];
    try {
      const { db } = fakeDb([row({ category: 'other' })]);
      const r = await chargeLines(db as never, CLAIM);
      expect(r.influence).toEqual({
        labels: [
          { labelId: gone, description: null, category: null },
          { labelId: row().id, description: row().description, category: 'other' },
        ],
      });
      influenceIds = [];
      expect((await chargeLines(db as never, CLAIM)).influence).toEqual({ labels: [] });
    } finally {
      influenceIds = null;
    }
    expect(influenceView(null, [])).toBeNull();
  });
});
