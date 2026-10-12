/**
 * Fixed UI copy of the step-7 fuel check (Part C F15). The web renders these texts verbatim. A difference
 * is a finding for review, never a confirmed amount.
 */
import type { FuelResultStatus } from './constants.js';

export const FUEL_NOTE =
  'The fuel check recomputes the surcharge from your fuel table and the public weekly U.S. diesel price for the ship date. A difference is a finding for review, not a confirmed amount.';

export const FUEL_STATUS_TEXT: Readonly<Record<FuelResultStatus, string>> = Object.freeze({
  no_inputs: 'No fuel inputs yet.',
  table_archived: 'The selected fuel table is archived.',
  contract_amount: 'The rate confirmation states a fixed fuel surcharge; that amount is checked instead.',
  no_fuel_line: 'No fuel surcharge line on the invoice.',
  price_unavailable: 'No public diesel price is available for this ship date.',
  miles_missing: 'Miles are required for a per-mile fuel table.',
  no_linehaul: 'No linehaul amount to apply a percent table to.',
  within_tolerance: 'The billed fuel surcharge matches the fuel table.',
  finding: 'The billed fuel surcharge differs from the fuel table. Review the finding.',
});

export const FUEL_TEXT = Object.freeze({
  tab: 'Fuel',
  heading: 'Fuel surcharge check',
  shipDate: 'Ship date',
  miles: 'Miles',
  table: 'Fuel table',
  save: 'Save fuel inputs',
  saved: 'Fuel inputs saved. They apply when the claim is analysed.',
  clear: 'Clear fuel inputs',
  locked: 'Fuel inputs can only change before the claim is analysed.',
  noTables: 'No fuel tables yet. An owner or admin can add one under Fuel tables.',
  forbidden: 'You do not have permission to change fuel inputs.',
  rateLimited: 'Too many requests. Try again later.',
  failed: 'Could not save the fuel inputs. Try again.',
});

export const FUEL_TABLES_TEXT = Object.freeze({
  nav: 'Fuel tables',
  heading: 'Fuel tables',
  note: "Fuel tables are your carriers' surcharge schedules. The fuel check applies them to the public weekly U.S. diesel price.",
  add: 'Add fuel table',
  save: 'Save fuel table',
  archive: 'Archive',
  saved: 'Fuel table saved.',
  archived: 'Fuel table archived.',
  limit: 'This organization has reached the maximum number of fuel tables.',
  stale: 'This item changed. Reload to continue.',
  nameTaken: 'A fuel table with this name already exists.',
  forbidden: 'You do not have permission to change fuel tables.',
  failed: 'Could not save the fuel table. Try again.',
});
