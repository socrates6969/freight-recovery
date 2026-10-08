import { describe, expect, it } from 'vitest';

import { ApprovalsQuery, ClaimsQuery, LoginBody, MfaVerifyBody, RevisionBody } from './dto.js';

describe('request schemas', () => {
  it('are strict (unknown keys rejected)', () => {
    expect(LoginBody.safeParse({ email: 'a@b.test', password: 'x', extra: 1 }).success).toBe(false);
    expect(ClaimsQuery.safeParse({ foo: 'bar' }).success).toBe(false);
  });

  it('MFA verify accepts code XOR recoveryCode', () => {
    expect(MfaVerifyBody.safeParse({ mfaToken: 't', code: '123456' }).success).toBe(true);
    expect(MfaVerifyBody.safeParse({ mfaToken: 't', recoveryCode: 'abcde-fghij' }).success).toBe(true);
    expect(MfaVerifyBody.safeParse({ mfaToken: 't', code: '1', recoveryCode: '2' }).success).toBe(false);
    expect(MfaVerifyBody.safeParse({ mfaToken: 't' }).success).toBe(false);
  });

  it('claims query defaults, sort whitelist, status list and caps', () => {
    const q = ClaimsQuery.parse({});
    expect(q.sort).toEqual({ field: 'createdAt', dir: 'desc' });
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(25);
    expect(ClaimsQuery.safeParse({ sort: 'passwordHash:asc' }).success).toBe(false);
    expect(ClaimsQuery.safeParse({ sort: 'createdAt' }).success).toBe(false);
    expect(ClaimsQuery.parse({ status: 'APPROVED,REJECTED' }).status).toEqual(['APPROVED', 'REJECTED']);
    expect(ClaimsQuery.safeParse({ status: 'NOPE' }).success).toBe(false);
    expect(ClaimsQuery.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(ClaimsQuery.safeParse({ page: '0' }).success).toBe(false);
    expect(ClaimsQuery.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(ClaimsQuery.parse({ q: `50%_\\"'` }).q).toBe(`50%_\\"'`);
    expect(ClaimsQuery.parse({ assigneeId: 'none' }).assigneeId).toBe('none');
  });

  it('approvals query only allows queue statuses', () => {
    expect(ApprovalsQuery.parse({}).status).toEqual(['PENDING_REVIEW', 'APPROVED']);
    expect(ApprovalsQuery.safeParse({ status: 'REJECTED' }).success).toBe(false);
  });

  it('revision body strips control characters from the letter', () => {
    const r = RevisionBody.parse({ baseRevision: 1, demandLetter: 'Dear\u0007 X\r\n', reason: 'fix the letter please' });
    expect(r.demandLetter).toBe('Dear X\n');
  });
});
