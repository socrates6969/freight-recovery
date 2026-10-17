import type { ExtractedFieldDto, ImportDocumentDetailDto } from '@fr/shared';

export const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const HOSTILE = '<script>alert(1)</script><img src=x onerror=alert(1)> javascript:alert(1) \u{202E}evil\u{202C}';

export function field(overrides: Partial<ExtractedFieldDto> = {}): ExtractedFieldDto {
  return {
    id: U(300),
    key: 'invoice.total',
    groupIndex: null,
    kind: 'DECIMAL',
    value: '1234.5',
    correctedValue: null,
    effectiveValue: '1234.5',
    rawValue: '$1,234.50',
    confidence: 0.95,
    needsReview: false,
    reviewReasons: [],
    status: 'PROPOSED',
    origin: 'EXTRACTED',
    source: { page: 2, line: 14, start: 10, end: 18, row: null, excerpt: 'Total: $1,234.50' },
    resolvedBy: null,
    resolvedAt: null,
    ...overrides,
  };
}

export function doc(overrides: Partial<ImportDocumentDetailDto> = {}): ImportDocumentDetailDto {
  return {
    id: U(200),
    batchId: U(100),
    displayName: 'invoice-1.pdf',
    detectedType: 'PDF',
    sizeBytes: 1000,
    sha256: 'a'.repeat(64),
    docType: 'INVOICE',
    docTypeBasis: 'HEADER',
    status: 'ACCEPTED',
    rejectReason: null,
    reviewReasons: [],
    fieldCount: 1,
    flaggedFieldCount: 0,
    unresolvedFlaggedCount: 0,
    minConfidence: 0.95,
    loadNumber: 'LD-1',
    pageCount: 2,
    createdAt: '2026-10-08T12:00:00.000Z',
    updatedAt: '2026-10-08T12:00:00.000Z',
    reviewThreshold: 0.9,
    warnings: [],
    providerName: 'deterministic',
    providerVersion: '1',
    fields: [field()],
    decisions: [],
    ...overrides,
  };
}

export const batch = {
  id: U(100),
  label: null,
  source: 'UPLOAD',
  documentCount: 0,
  createdBy: { id: U(1), name: 'Morgan Manager' },
  createdAt: '2026-10-08T12:00:00.000Z',
};
