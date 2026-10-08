/** Unit tests: reviewer value validation (shared validators) and commit helpers. */
import { describe, expect, it } from 'vitest';

import { normalizeLoadNumber, parseInvoiceDate } from '../../src/imports/commit-service.js';
import { effectiveValue, fieldCounts, sortFields } from '../../src/imports/dto.js';
import { validateManualValue } from '../../src/imports/values.js';

describe('validateManualValue', () => {
  it.each([
    ['invoice.total', 'DECIMAL', '$2,000.50', '2000.50'],
    ['invoice.total', 'DECIMAL', '(5)', '-5'],
    ['bol.arrival_time', 'DATETIME', '03/04/2025 09:00', '2025-03-04T09:00:00'],
    ['rate_confirmation.authorized_accessorials', 'STRING_LIST', 'Detention,  Lumper ,', '["Detention","Lumper"]'],
    ['invoice.carrier', 'STRING', '  Acme  ', 'Acme'],
  ] as const)('%s %s %j -> %j', (key, kind, input, expected) => {
    expect(validateManualValue(key, kind, input)?.value).toBe(expected);
  });

  it.each([
    ['invoice.total', 'DECIMAL', '1e3'],
    ['bol.arrival_time', 'DATETIME', 'tomorrow'],
    ['invoice.carrier', 'STRING', ''],
    ['invoice.carrier', 'STRING', 'a\nb'],
    ['invoice.carrier', 'STRING', 'x\u{202e}y'],
    ['invoice.carrier', 'STRING', 'x\u{2028}y'],
    ['invoice.carrier', 'STRING', 'x'.repeat(201)],
    ['invoice.load_number', 'STRING', 'x'.repeat(101)],
  ] as const)('rejects %s %s %j', (key, kind, input) => {
    expect(validateManualValue(key, kind, input)).toBeNull();
  });
});

describe('commit helpers', () => {
  it('normalizes load numbers for grouping', () => {
    expect(normalizeLoadNumber('  ld-5001 ')).toBe('LD-5001');
    expect(normalizeLoadNumber('LD\u{a0} 5001')).toBe('LD 5001');
    expect(normalizeLoadNumber('\u{ff2c}\u{ff24}-1')).toBe('LD-1');
  });

  it('parses invoice dates from ISO, US and ISO-datetime strings only', () => {
    expect(parseInvoiceDate('2025-03-10')?.toISOString()).toBe('2025-03-10T00:00:00.000Z');
    expect(parseInvoiceDate('03/10/2025')?.toISOString()).toBe('2025-03-10T00:00:00.000Z');
    expect(parseInvoiceDate('2025-03-10T07:45:00')?.toISOString()).toBe('2025-03-10T00:00:00.000Z');
    expect(parseInvoiceDate('2025-02-30')).toBeNull();
    expect(parseInvoiceDate('March 10')).toBeNull();
    expect(parseInvoiceDate(null)).toBeNull();
  });
});

describe('field DTO helpers', () => {
  it('computes effective values, counts and the N7 order', () => {
    expect(effectiveValue({ status: 'CORRECTED', value: '1', correctedValue: '2' })).toBe('2');
    expect(effectiveValue({ status: 'REJECTED', value: '1', correctedValue: null })).toBeNull();
    expect(effectiveValue({ status: 'CONFIRMED', value: '1', correctedValue: null })).toBe('1');
    expect(
      fieldCounts([
        { needsReview: true, status: 'PROPOSED', confidence: 0.85 },
        { needsReview: true, status: 'CONFIRMED', confidence: 0.85 },
        { needsReview: false, status: 'PROPOSED', confidence: 0.95 },
      ]),
    ).toEqual({ fieldCount: 3, flaggedFieldCount: 2, unresolvedFlaggedCount: 1, minConfidence: 0.85 });
    expect(
      sortFields([
        { key: 'invoice.charge.amount', groupIndex: 0 },
        { key: 'invoice.total', groupIndex: null },
        { key: 'invoice.charge.description', groupIndex: 1 },
        { key: 'invoice.charge.description', groupIndex: 0 },
      ]).map((f) => `${f.key}#${f.groupIndex ?? ''}`),
    ).toEqual(['invoice.total#', 'invoice.charge.description#0', 'invoice.charge.description#1', 'invoice.charge.amount#0']);
  });
});
