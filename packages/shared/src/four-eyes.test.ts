import { describe, expect, it } from 'vitest';

import { ApprovalItem } from './dto.js';
import { FOUR_EYES_CLAIM_TEXT, FOUR_EYES_DOCUMENT_TEXT, FOUR_EYES_ERROR_CODE } from './four-eyes.js';
import { ImportDocumentDetail, ImportDocumentSummary, ReviewQueueItem } from './import-dto.js';

describe('four-eyes shared contract', () => {
  it('exports the exact copy and error code', () => {
    expect(FOUR_EYES_ERROR_CODE).toBe('four_eyes_required');
    expect(FOUR_EYES_CLAIM_TEXT).toBe('You edited this revision. Another approver must approve it.');
    expect(FOUR_EYES_DOCUMENT_TEXT).toBe('You uploaded or edited this document. Another reviewer must accept it.');
  });

  it('requires selfAuthored on ApprovalItem and ImportDocumentDetail only', () => {
    expect(ApprovalItem.shape.selfAuthored.safeParse(true).success).toBe(true);
    expect(ApprovalItem.shape.selfAuthored.safeParse(undefined).success).toBe(false);
    expect(ImportDocumentDetail.shape.selfAuthored.safeParse(false).success).toBe(true);
    expect(ImportDocumentDetail.shape.selfAuthored.safeParse(undefined).success).toBe(false);
    expect('selfAuthored' in ImportDocumentSummary.shape).toBe(false);
    expect('selfAuthored' in ReviewQueueItem.shape).toBe(false);
  });
});
