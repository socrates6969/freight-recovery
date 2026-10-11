/**
 * Step 8 (REQ-20261011-ocean-dd, Part C C1): ocean demurrage and detention (D&D) invoice audit constants.
 * Plain data, frozen where objects. 46 CFR 541.4 is deliberately not modelled: it was set aside by the D.C.
 * Circuit on 2025-09-23 and removed effective 2025-12-29 (FR Doc. 2025-23920).
 */

export const DD_RULES_VERSION = 'dd-rules-v1' as const;

export const DD_RULE_IDS = Object.freeze([
  'DD-TOTAL-MISMATCH',
  'DD-PERIOD-ARITH',
  'DD-TARIFF-OVERCHARGE',
  'DD-545-RETURN-REFUSED',
  'DD-545-AVAILABILITY',
  'DD-541-7-LATE',
  'DD-541-6-CONTENT',
] as const);
export type DdRuleId = (typeof DD_RULE_IDS)[number];

/** Effective date of 46 CFR Part 541. */
export const DD_PART541_EFFECTIVE = '2024-05-28';
/** 46 CFR 541.7: invoice within 30 calendar days. */
export const DD_ISSUE_DEADLINE_DAYS = 30;
/** 46 CFR 541.8(a): at least 30 calendar days to request mitigation, refund or waiver. */
export const DD_DISPUTE_MIN_DAYS = 30;
/** 46 CFR 541.8(b): attempt to resolve within 30 calendar days. */
export const DD_RESOLUTION_MAX_DAYS = 30;
export const DD_REGULATION_VERSION = 'ecfr-2026-10-07';

export const DD_CONTAINERS_MAX = 50;
export const DD_PERIODS_MAX = 20;
export const DD_TIERS_MAX = 10;
export const DD_SIZES_MAX = 20;
export const DD_CALENDAR_DATES_MAX = 400;
export const DD_REFUSED_DATES_MAX = 60;
export const DD_BL_MAX = 20;
/** Largest clock stop - clock start (days). */
export const DD_SPAN_MAX_DAYS = 730;
/** Largest period to - from (days). */
export const DD_PERIOD_SPAN_MAX_DAYS = 365;
export const DD_CSV_MAX_CHARS = 1_000_000;
export const DD_CSV_MAX_ROWS = 2000;
export const DD_CSV_MAX_INVOICES = 50;
/** Per-tenant caps (decision D11). */
export const DD_TARIFFS_MAX = 200;
export const DD_CALENDARS_MAX = 200;
/** Fix round 1 (S2): per-tenant cap of D&D invoices (DRAFT + AUDITED); beyond it 409 dd_limit_reached. */
export const DD_INVOICES_MAX = 2000;
/** Fix round 1 (S1): largest pageSize of GET /dd/invoices. */
export const DD_INVOICE_PAGE_SIZE_MAX = 50;
/** Fix round 1 (S4): request body limit (bytes) of POST/PUT /dd/invoices; equals the dd_invoices.data CHECK. */
export const DD_INVOICE_BODY_LIMIT = 262144;

export const DD_SOURCE_FILES = Object.freeze({
  invoice: 'dd-invoice.json',
  tariff: 'dd-tariff.json',
  calendar: 'dd-calendar.json',
  regulation: 'ecfr-46-cfr-541-545.5.json',
} as const);

/** Valid civil-date range of a `DdDate` (C2). */
export const DD_DATE_MIN = '2000-01-01';
export const DD_DATE_MAX = '2099-12-31';
/** Bound of the free-time scan: F more than this many days after S is a RangeError (C3). */
export const DD_FREE_TIME_SCAN_MAX_DAYS = 3660;

export const DD_CHARGE_TYPES = Object.freeze(['DEMURRAGE', 'DETENTION'] as const);
export type DdChargeType = (typeof DD_CHARGE_TYPES)[number];
export const DD_DIRECTIONS = Object.freeze(['IMPORT', 'EXPORT'] as const);
export type DdDirection = (typeof DD_DIRECTIONS)[number];
export const DD_BILLING_PARTY_TYPES = Object.freeze(['OCEAN_CARRIER', 'MARINE_TERMINAL_OPERATOR', 'NVOCC'] as const);
export type DdBillingPartyType = (typeof DD_BILLING_PARTY_TYPES)[number];
export const DD_DAY_BASES = Object.freeze(['calendar', 'working'] as const);
export type DdDayBasis = (typeof DD_DAY_BASES)[number];
export const DD_START_DAY_RULES = Object.freeze(['included', 'additional'] as const);
export type DdStartDayRule = (typeof DD_START_DAY_RULES)[number];
export const DD_INVOICE_STATUSES = Object.freeze(['DRAFT', 'AUDITED'] as const);
export type DdInvoiceStatus = (typeof DD_INVOICE_STATUSES)[number];

/** C6 check ids, in output order. */
export const DD_CHECK_IDS = Object.freeze(['part541', 'content', 'issuance', 'total', 'line_arithmetic', 'tariff', 'availability', 'return_refused'] as const);
export type DdCheckId = (typeof DD_CHECK_IDS)[number];
export const DD_CHECK_STATUSES = Object.freeze(['ok', 'finding', 'not_evaluated', 'not_applicable'] as const);
export type DdCheckStatus = (typeof DD_CHECK_STATUSES)[number];

/** Confidence of confirmed arithmetic findings (TOTAL, PERIOD, TARIFF; decision D2). */
export const DD_CONFIDENCE_ARITHMETIC = 0.9;
/** Confidence of the 46 CFR 545.5 findings. */
export const DD_CONFIDENCE_545 = 0.5;
/** Confidence of the 46 CFR 541.6 / 541.7 findings. */
export const DD_CONFIDENCE_541 = 0.7;
