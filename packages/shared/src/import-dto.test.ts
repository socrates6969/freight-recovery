import { describe, expect, it } from 'vitest';

import {
  AcceptDocBody,
  AddFieldBody,
  CHARGE_KEYS,
  ExportClaimsQuery,
  ExportOutcomesQuery,
  ExportPacketsQuery,
  FIELD_LABELS,
  FIELD_SPECS,
  ResolveFieldBody,
  UploadQuery,
  confidenceLevel,
  fieldKeysFor,
} from './import-dto.js';

describe('upload filename', () => {
  it('accepts normal names and normalizes to NFC', () => {
    expect(UploadQuery.parse({ filename: 'invoice.pdf' }).filename).toBe('invoice.pdf');
    expect(UploadQuery.parse({ filename: 'e\u{301}.txt' }).filename).toBe('\u{e9}.txt');
  });

  it.each(['', 'a\u0000.txt', 'a\nb.txt', 'x\u{202e}fdp.txt', 'a\u{2028}.txt', 'x'.repeat(256)])('rejects %j', (name) => {
    expect(UploadQuery.safeParse({ filename: name }).success).toBe(false);
  });

  it('rejects unknown query keys and repeated filenames', () => {
    expect(UploadQuery.safeParse({ filename: 'a.txt', x: '1' }).success).toBe(false);
    expect(UploadQuery.safeParse({ filename: ['a.txt', 'b.txt'] }).success).toBe(false);
  });
});

describe('review bodies', () => {
  it('requires correctedValue iff CORRECT', () => {
    const reason = 'checked against the PDF';
    expect(ResolveFieldBody.safeParse({ action: 'CORRECT', reason }).success).toBe(false);
    expect(ResolveFieldBody.safeParse({ action: 'CORRECT', correctedValue: '5', reason }).success).toBe(true);
    expect(ResolveFieldBody.safeParse({ action: 'CONFIRM', correctedValue: '5', reason }).success).toBe(false);
    expect(ResolveFieldBody.safeParse({ action: 'REJECT', reason: 'too short' }).success).toBe(false);
  });

  it('allow-lists field keys and accept flags', () => {
    expect(AddFieldBody.safeParse({ key: 'invoice.total', value: '1', reason: 'keyed from the scan' }).success).toBe(true);
    expect(AddFieldBody.safeParse({ key: 'invoice.secret', value: '1', reason: 'keyed from the scan' }).success).toBe(false);
    expect(AcceptDocBody.safeParse({ reason: 'all fields verified', confirmRemaining: true }).success).toBe(true);
  });
});

describe('export queries', () => {
  it('requires a format and rejects paging keys', () => {
    expect(ExportClaimsQuery.safeParse({}).success).toBe(false);
    expect(ExportClaimsQuery.safeParse({ format: 'csv' }).success).toBe(true);
    expect(ExportClaimsQuery.safeParse({ format: 'csv', page: '2' }).success).toBe(false);
    expect(ExportClaimsQuery.safeParse({ format: 'pdf' }).success).toBe(false);
    expect(ExportClaimsQuery.parse({ format: 'xlsx', status: 'AWAITING_ANALYSIS' }).status).toEqual(['AWAITING_ANALYSIS']);
  });

  it('packets: claimId cannot be combined with filters', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(ExportPacketsQuery.safeParse({ format: 'csv', claimId: id }).success).toBe(true);
    expect(ExportPacketsQuery.safeParse({ format: 'csv', claimId: id, q: 'x' }).success).toBe(false);
  });

  it('outcomes: action list and inclusive ISO day range', () => {
    expect(ExportOutcomesQuery.parse({ format: 'csv', action: 'APPROVE,REJECT,APPROVE' }).action).toEqual(['APPROVE', 'REJECT']);
    expect(ExportOutcomesQuery.safeParse({ format: 'csv', action: 'DELETE' }).success).toBe(false);
    expect(ExportOutcomesQuery.safeParse({ format: 'csv', from: '2026-02-30' }).success).toBe(false);
    expect(ExportOutcomesQuery.safeParse({ format: 'csv', from: '2026-03-02', to: '2026-03-01' }).success).toBe(false);
    expect(ExportOutcomesQuery.safeParse({ format: 'csv', from: '2026-03-01', to: '2026-03-01' }).success).toBe(true);
  });
});

describe('field registry', () => {
  it('has labels for every key and keeps the N7 order', () => {
    expect(FIELD_SPECS).toHaveLength(21);
    for (const f of FIELD_SPECS) expect(FIELD_LABELS[f.key]).toBe(f.label);
    expect(fieldKeysFor('INVOICE').slice(-2)).toEqual([...CHARGE_KEYS]);
    expect(fieldKeysFor('BILL_OF_LADING')).toEqual(['bol.load_number', 'bol.facility', 'bol.appointment_time', 'bol.arrival_time', 'bol.departure_time']);
  });

  it('maps confidence to level words', () => {
    expect([confidenceLevel(0.95), confidenceLevel(0.9), confidenceLevel(0.85), confidenceLevel(0.7), confidenceLevel(0.69)]).toEqual([
      'High',
      'High',
      'Medium',
      'Medium',
      'Low',
    ]);
  });
});
