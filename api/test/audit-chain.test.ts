import { GENESIS_HASH } from '@fr/shared';
import { describe, expect, it } from 'vitest';

import {
  ChainVerifier,
  chainKeyFor,
  computeEventHash,
  sanitizeMetadata,
  type ChainEvent,
  type StoredChainRow,
} from '../src/audit/chain.js';

const T = '11111111-1111-4111-8111-111111111111';

function buildChain(n: number): StoredChainRow[] {
  const rows: StoredChainRow[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i += 1) {
    const e: ChainEvent = {
      chainKey: chainKeyFor(T),
      seq: i,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      tenantId: T,
      actorId: null,
      actorRole: null,
      action: 'packet.viewed',
      targetType: 'claim',
      targetId: 'c1',
      metadata: { revision: i, reason: 'r' },
      ip: '127.0.0.1',
      requestId: `req-${i}`,
      createdAt: new Date(1_700_000_000_000 + i).toISOString(),
    };
    const hash = computeEventHash(prev, e);
    rows.push({ ...e, prevHash: prev, hash });
    prev = hash;
  }
  return rows;
}

function verify(rows: StoredChainRow[]) {
  const v = new ChainVerifier();
  for (const r of rows) if (!v.push(r)) break;
  return v.result();
}

describe('audit hash chain', () => {
  it('uses the platform/tenant chain keys', () => {
    expect(chainKeyFor(null)).toBe('platform');
    expect(chainKeyFor(T)).toBe(`t:${T}`);
  });

  it('hash depends on prevHash and every field (fixed vector)', () => {
    const [first] = buildChain(1);
    expect(first?.prevHash).toBe(GENESIS_HASH);
    expect(first?.hash).toMatch(/^[0-9a-f]{64}$/u);
    if (!first) throw new Error('missing');
    expect(computeEventHash(GENESIS_HASH, { ...first, action: 'x' })).not.toBe(first.hash);
    expect(computeEventHash('1'.repeat(64), first)).not.toBe(first.hash);
    expect(computeEventHash(GENESIS_HASH, { ...first, metadata: { reason: 'r', revision: 1 } })).toBe(first.hash);
  });

  it('verifies an intact chain', () => {
    expect(verify(buildChain(5))).toEqual({ valid: true, eventsChecked: 5, brokenAtSeq: null });
    expect(verify([])).toEqual({ valid: true, eventsChecked: 0, brokenAtSeq: null });
  });

  it('detects an edited row, including the last one', () => {
    const rows = buildChain(5);
    rows[2] = { ...(rows[2] as StoredChainRow), metadata: { revision: 99 } };
    expect(verify(rows)).toMatchObject({ valid: false, brokenAtSeq: 3 });
    const rows2 = buildChain(5);
    rows2[4] = { ...(rows2[4] as StoredChainRow), action: 'auth.logout' };
    expect(verify(rows2)).toMatchObject({ valid: false, brokenAtSeq: 5 });
  });

  it('detects deletions, gaps and reordering', () => {
    const rows = buildChain(5);
    expect(verify([...rows.slice(0, 2), ...rows.slice(3)])).toMatchObject({ valid: false, brokenAtSeq: 4 });
    const swapped = buildChain(4);
    const tmp = swapped[1] as StoredChainRow;
    swapped[1] = swapped[2] as StoredChainRow;
    swapped[2] = tmp;
    expect(verify(swapped)).toMatchObject({ valid: false, brokenAtSeq: 3 });
    expect(verify(buildChain(3).slice(1))).toMatchObject({ valid: false, brokenAtSeq: 2 });
  });

  it('detects a recomputed (re-hashed) edit via the next row', () => {
    const rows = buildChain(4);
    const r2 = { ...(rows[1] as StoredChainRow), metadata: { revision: 42 } };
    r2.hash = computeEventHash(r2.prevHash, r2);
    rows[1] = r2;
    expect(verify(rows)).toMatchObject({ valid: false, brokenAtSeq: 3 });
  });

  it('sanitizes metadata to a whitelist and truncates email hashes', () => {
    expect(
      sanitizeMetadata({
        reason: 'ok reason',
        password: 'p',
        token: 't',
        emailHash: 'a'.repeat(64),
        demandLetter: 'x',
        revision: 2,
      }),
    ).toEqual({ reason: 'ok reason', emailHash: 'a'.repeat(12), revision: 2 });
  });
});
