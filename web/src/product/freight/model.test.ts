import { describe, expect, it } from 'vitest';

import { EXAMPLE_FREIGHT_FORM, buildFreightInput, normalizeLocalDateTime, normalizeMoney, parseChargeLines, runFreightCheck } from './model';
import { APP_DISCLAIMER, renderFreightPacket } from './packet';

const NOW = new Date('2026-10-19T12:00:00.000Z');

describe('freight check input parsing', () => {
  it('parses charge lines with comma, tab, pipe and semicolon separators and a header row', () => {
    const r = parseChargeLines('Description, Amount\nLinehaul, $1,500.00\nFuel Surcharge\t168.00\nDetention | 300\nLumper; 150.5');
    expect(r.errors).toEqual([]);
    expect(r.lines).toEqual([
      { description: 'Linehaul', amount: '1500.00' },
      { description: 'Fuel Surcharge', amount: '168.00' },
      { description: 'Detention', amount: '300' },
      { description: 'Lumper', amount: '150.5' },
    ]);
  });

  it('reports lines without an amount instead of guessing', () => {
    const r = parseChargeLines('Linehaul 1500\nDetention, abc');
    expect(r.lines).toEqual([]);
    expect(r.errors).toHaveLength(2);
  });

  it('normalizes money and local date-times', () => {
    expect(normalizeMoney(' $2,118.00 ')).toBe('2118.00');
    expect(normalizeMoney('(25.00)')).toBe('-25.00');
    expect(normalizeMoney('1,2,3x')).toBeNull();
    expect(normalizeLocalDateTime('2025-03-03T08:00')).toBe('2025-03-03T08:00:00');
    expect(normalizeLocalDateTime('2025-03-03 08:00:30')).toBe('2025-03-03T08:00:30');
    expect(normalizeLocalDateTime('03/03/2025 8am')).toBeNull();
  });

  it('requires charge lines and rate confirmation terms', () => {
    const r = buildFreightInput({ ...EXAMPLE_FREIGHT_FORM, linesText: '', rcLinehaul: '', rcFuel: '', rcFreeHours: '', rcRatePerHour: '', rcMaxHours: '', rcAuthorized: '' });
    expect(r.errors.some((e) => e.includes('at least one invoice charge line'))).toBe(true);
    expect(r.errors.some((e) => e.includes('rate confirmation terms'))).toBe(true);
  });
});

describe('freight check run (synthetic LD-5001)', () => {
  it('finds the linehaul overcharge, the unauthorized lumper and the overbilled detention', () => {
    const r = runFreightCheck({ ...EXAMPLE_FREIGHT_FORM }, NOW);
    expect(r.errors).toEqual([]);
    const o = r.outcome;
    expect(o).not.toBeNull();
    if (!o) return;
    const ids = o.result.findings.map((f) => f.rule_id);
    expect(ids).toContain('INV-LINEHAUL-RATE');
    expect(ids).toContain('INV-ACCESSORIAL-UNAUTH');
    expect(ids).toContain('DET-OVERBILLED');
    const confirmed = o.result.findings.filter((f) => !f.needs_human_review).reduce((s, f) => s + Number(f.amount), 0);
    expect(Number(o.result.recoverable_total)).toBeCloseTo(confirmed, 2);
    expect(o.letter).toContain('DRAFT');
    expect(o.letter).not.toContain('undefined');
  });

  it('renders a packet that carries the in-browser disclaimer, every finding and the letter', () => {
    const o = runFreightCheck({ ...EXAMPLE_FREIGHT_FORM }, NOW).outcome;
    expect(o).not.toBeNull();
    if (!o) return;
    const md = renderFreightPacket(o);
    expect(md).toContain(APP_DISCLAIMER);
    for (const f of o.result.findings) expect(md).toContain(f.rule_id);
    expect(md).toContain('## Draft letter');
    expect(md).not.toContain('MVP / pre-product');
  });

  it('reports a readable error instead of throwing on bad settings', () => {
    const r = runFreightCheck({ ...EXAMPLE_FREIGHT_FORM, incrementMinutes: '0' }, NOW);
    expect(r.outcome).toBeNull();
    expect(r.errors[0]).toContain('Detention increment');
  });
});