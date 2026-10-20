import { describe, expect, it } from 'vitest';

import {
  DD_DEADLINE_RED_DAYS,
  DD_DEADLINE_URGENT_DAYS,
  DdDisputeWindow,
  computeDdDisputeWindow,
  ddDisputeDaysLeft,
  ddDisputeUrgency,
  ddDisputeWindowText,
  utcDay,
} from './dd-deadline.js';

describe('computeDdDisputeWindow (46 CFR 541.8(a) floor)', () => {
  it('no invoice date: nothing to count from', () => {
    expect(computeDdDisputeWindow({ invoiceDate: null, statedDays: 45 })).toBeNull();
    expect(computeDdDisputeWindow({ invoiceDate: null, statedDays: null })).toBeNull();
  });
  it('nothing stated: the 30-day floor applies', () => {
    expect(computeDdDisputeWindow({ invoiceDate: '2026-10-01', statedDays: null })).toEqual({
      regulation: '46 CFR 541.8(a)',
      invoiceDate: '2026-10-01',
      statedDays: null,
      windowDays: 30,
      floorApplied: true,
      closesOn: '2026-10-31',
    });
  });
  it('window shorter than 30 (incl. 0 and 29): the floor replaces it', () => {
    for (const stated of [0, 1, 14, 29]) {
      const w = computeDdDisputeWindow({ invoiceDate: '2026-02-10', statedDays: stated });
      expect(w).toMatchObject({ statedDays: stated, windowDays: 30, floorApplied: true, closesOn: '2026-03-12' });
    }
  });
  it('exactly 30: the stated window is used and the floor is not applied', () => {
    expect(computeDdDisputeWindow({ invoiceDate: '2026-01-31', statedDays: 30 })).toMatchObject({ windowDays: 30, floorApplied: false, closesOn: '2026-03-02' });
  });
  it('longer than 30: the stated window is used', () => {
    expect(computeDdDisputeWindow({ invoiceDate: '2024-02-28', statedDays: 45 })).toMatchObject({ windowDays: 45, floorApplied: false, closesOn: '2024-04-13' });
    expect(computeDdDisputeWindow({ invoiceDate: '2026-12-31', statedDays: 365 })).toMatchObject({ windowDays: 365, closesOn: '2027-12-31' });
  });
  it('output satisfies the strict schema', () => {
    const w = computeDdDisputeWindow({ invoiceDate: '2026-10-01', statedDays: 60 });
    expect(DdDisputeWindow.parse(w)).toEqual(w);
  });
  it('refuses malformed input and gives null when the closing date leaves the supported range', () => {
    expect(() => computeDdDisputeWindow({ invoiceDate: '2026-13-01', statedDays: null })).toThrow(RangeError);
    expect(() => computeDdDisputeWindow({ invoiceDate: '2026-10-01', statedDays: -1 })).toThrow(RangeError);
    expect(() => computeDdDisputeWindow({ invoiceDate: '2026-10-01', statedDays: 1.5 })).toThrow(RangeError);
    expect(computeDdDisputeWindow({ invoiceDate: '2099-12-20', statedDays: null })).toBeNull();
  });
});

describe('days left, urgency and text', () => {
  it('counts whole days from today (0 = closes today, negative = past)', () => {
    expect(ddDisputeDaysLeft('2026-10-31', '2026-10-01')).toBe(30);
    expect(ddDisputeDaysLeft('2026-10-31', '2026-10-31')).toBe(0);
    expect(ddDisputeDaysLeft('2026-10-31', '2026-11-03')).toBe(-3);
  });
  it('urgency thresholds are the documented constants', () => {
    expect([DD_DEADLINE_RED_DAYS, DD_DEADLINE_URGENT_DAYS]).toEqual([7, 14]);
    expect(ddDisputeUrgency(-1)).toBe('closed');
    expect(ddDisputeUrgency(0)).toBe('red');
    expect(ddDisputeUrgency(7)).toBe('red');
    expect(ddDisputeUrgency(8)).toBe('urgent');
    expect(ddDisputeUrgency(14)).toBe('urgent');
    expect(ddDisputeUrgency(15)).toBe('open');
  });
  it('renders the fixed wording', () => {
    expect(ddDisputeWindowText({ closesOn: '2026-10-31' }, '2026-10-21')).toBe('Dispute window: 10 days left (closes 2026-10-31)');
    expect(ddDisputeWindowText({ closesOn: '2026-10-31' }, '2026-10-30')).toBe('Dispute window: 1 day left (closes 2026-10-31)');
    expect(ddDisputeWindowText({ closesOn: '2026-10-31' }, '2026-10-31')).toBe('Dispute window: 0 days left (closes 2026-10-31)');
    expect(ddDisputeWindowText({ closesOn: '2026-10-31' }, '2026-11-01')).toBe('Dispute window closed 2026-10-31 (1 day ago)');
    expect(ddDisputeWindowText({ closesOn: '2026-10-31' }, '2026-11-05')).toBe('Dispute window closed 2026-10-31 (5 days ago)');
  });
  it('utcDay is the UTC calendar date', () => {
    expect(utcDay(new Date('2026-10-20T23:59:59.999Z'))).toBe('2026-10-20');
    expect(utcDay(new Date('2026-10-21T00:00:00.000Z'))).toBe('2026-10-21');
  });
});