import { describe, expect, it } from 'vitest';

import { emptyDdForm, exampleDdForm, formFromInvoice, importDdCsv, runDdAudit, validateDdForm } from './model';
import { renderDdPacket } from './packet';

const NOW = new Date('2026-10-19T12:00:00.000Z');

describe('ocean D&D audit (public app)', () => {
  it('validates the synthetic example and round-trips it through the form', () => {
    const v = validateDdForm(exampleDdForm());
    expect(v.errors).toEqual([]);
    expect(v.invoice).not.toBeNull();
    if (!v.invoice) return;
    const again = formFromInvoice(v.invoice, 'maersk-us-import-detention-2026');
    expect(validateDdForm(again).invoice).toEqual(v.invoice);
  });

  it('names the field in validation messages', () => {
    const bad = exampleDdForm();
    const first = bad.containers[0];
    expect(first).toBeDefined();
    if (!first) return;
    bad.containers[0] = { ...first, sizeType: '4DV', periods: [{ from: '2026-03-20', to: '2026-03-06', rate: '', amount: '1' }] };
    const v = validateDdForm(bad);
    expect(v.invoice).toBeNull();
    expect(v.errors.some((e) => e.startsWith('Container 1, size/type'))).toBe(true);
    expect(v.errors.some((e) => e.startsWith('Container 1, charge period 1'))).toBe(true);
  });

  it('audits against the public Maersk preset and finds the tariff overcharge', () => {
    const r = runDdAudit(exampleDdForm(), NOW);
    expect(r.errors).toEqual([]);
    const o = r.outcome;
    expect(o).not.toBeNull();
    if (!o) return;
    expect(o.result.checks).toHaveLength(8);
    expect(o.result.findings.some((f) => f.ruleId.includes('TARIFF'))).toBe(true);
    expect(o.letter).toContain('DRAFT');
    const md = renderDdPacket(o);
    expect(md).toContain('## Checks');
    expect(md).toContain(o.result.findings[0]?.title ?? '');
  });

  it('runs without a tariff and passes a complete invoice', () => {
    const form = { ...exampleDdForm(), tariffPresetId: '' };
    const r = runDdAudit(form, NOW);
    expect(r.errors).toEqual([]);
    expect(r.outcome?.result.checks.find((c) => c.id === 'tariff')?.status).toBe('not_evaluated');
  });

  it('lists the required fields when an empty form is submitted', () => {
    const v = validateDdForm(emptyDdForm());
    expect(v.invoice).toBeNull();
    expect(v.errors.length).toBeGreaterThan(0);
  });

  it('imports nothing from an unrelated CSV and reports the problem', () => {
    const r = importDdCsv('a,b\n1,2\n');
    expect(r.forms).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});