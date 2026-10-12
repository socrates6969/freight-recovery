/* eslint-disable */
// REQ-20261009-four-eyes: shared contract (Part C P3, P4, P7) - exact UI copy, required selfAuthored flags, audit action.
import { describe, expect, it } from 'vitest';

const load = async () => (await import('@fr/shared')) as any;

describe('FE-SH four-eyes shared contract', () => {
  it('P7 copy constants are exported with the exact text', async () => {
    const m = await load();
    expect(m.FOUR_EYES_CLAIM_TEXT).toBe('You edited this revision. Another approver must approve it.');
    expect(m.FOUR_EYES_DOCUMENT_TEXT).toBe('You uploaded or edited this document. Another reviewer must accept it.');
  });
  it('P3 ApprovalItem.selfAuthored and ImportDocumentDetail.selfAuthored are required booleans', async () => {
    const m = await load();
    for (const name of ['ApprovalItem', 'ImportDocumentDetail']) {
      const s = m[name]?.shape?.selfAuthored;
      expect(s, `${name}.selfAuthored`).toBeTruthy();
      expect(s.safeParse(true).success).toBe(true);
      expect(s.safeParse(false).success).toBe(true);
      expect(s.safeParse(undefined).success, `${name}.selfAuthored required`).toBe(false);
      expect(s.safeParse('true').success).toBe(false);
      expect(s.safeParse(null).success).toBe(false);
    }
  });
  it('P4 audit action authz.four_eyes_denied is part of the action list', async () => {
    const m = await load();
    expect(m.AUDIT_ACTIONS).toContain('authz.four_eyes_denied');
  });
});
