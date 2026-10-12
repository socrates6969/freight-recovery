/**
 * Step 7 fuel-surcharge check constants (REQ-20261011-fuel-outlook, Part C F1). Plain data, no runtime
 * imports: exported from the package root. The engines (table evaluation, week rule, check, evidence)
 * stay behind the `@fr/shared/fuel` subpath.
 */

/** Version of the fuel-surcharge check. */
export const FUEL_CHECK_VERSION = 'fsc-v1';

/** Rule ids of findings produced by the fuel check (never by the step-5 rules). */
export const FUEL_RULE_IDS = Object.freeze(['FSC-INDEX-MISMATCH'] as const);
export type FuelRuleId = (typeof FUEL_RULE_IDS)[number];

/** Confidence of an FSC finding (fixed; always needs human review). */
export const FSC_CONFIDENCE = 0.7;

/** Fuel tables per tenant (archived included). */
export const FSC_TABLES_MAX = 50;

/** Rows of a `rows` fuel table. */
export const FSC_ROWS_MAX = 200;

/** Fuel-check statuses in the F5 order (`off` = flag off; never a `FuelCheckResult` status). */
export const FUEL_CHECK_STATUSES = Object.freeze([
  'off',
  'no_inputs',
  'table_archived',
  'contract_amount',
  'no_fuel_line',
  'price_unavailable',
  'miles_missing',
  'no_linehaul',
  'within_tolerance',
  'finding',
] as const);
export type FuelCheckStatus = (typeof FUEL_CHECK_STATUSES)[number];
/** Statuses a computed `FuelCheckResult` can have. */
export type FuelResultStatus = Exclude<FuelCheckStatus, 'off'>;

export const FSC_KINDS = Object.freeze(['step', 'mpg', 'rows'] as const);
export type FscKind = (typeof FSC_KINDS)[number];

export const FSC_UNITS = Object.freeze(['per_mile', 'percent'] as const);
export type FscUnit = (typeof FSC_UNITS)[number];

export const FSC_BRACKETS = Object.freeze(['above_base', 'from_base'] as const);
export type FscBracket = (typeof FSC_BRACKETS)[number];

/** Default week-rule offset: the Monday posting applies Wednesday to Tuesday (GSA rule). */
export const FSC_DEFAULT_OFFSET_DAYS = 2;

/** Bounds of a fuel table name (characters). */
export const FSC_TABLE_NAME_MAX = 80;
