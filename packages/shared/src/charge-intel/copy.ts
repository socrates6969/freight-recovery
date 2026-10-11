/**
 * Fixed UI copy of the step-6 charge suggestions (Part C C13). The web renders these texts verbatim.
 * Suggestions are labelled as such: they are not verified and only add items for human review.
 */
import type { ChargeCategory } from './constants.js';

export const CHARGE_NOTE =
  "Suggestions compare each charge name with labelled examples: public carrier tariff charge names and your team's labels. They are not verified. A suggestion only adds items for human review; it never confirms an amount.";

export const CHARGE_EVAL_NOTE =
  'Leave-one-carrier-out check on 175 public tariff charge names from 6 carriers. It is a regression check on this seed set, not an accuracy measure on invoices.';

export const CATEGORY_LABELS: Readonly<Record<ChargeCategory, string>> = Object.freeze({
  detention: 'Detention',
  linehaul: 'Linehaul',
  fuel: 'Fuel',
  accessorial: 'Accessorial',
  other: 'Other',
});

export const CHARGE_TEXT = Object.freeze({
  tab: 'Charges',
  heading: 'Charge lines',
  rules: 'Rules',
  suggested: 'Suggested',
  noSuggestion: 'No suggestion',
  teamLabel: 'Team label',
  nearest: 'Nearest example',
  confirm: (label: string): string => 'Confirm ' + label,
  category: 'Category',
  save: 'Save label',
  saved: 'Label saved. It applies to future analyses.',
  empty: 'No invoice charge lines on the accepted documents of this claim.',
  forbidden: 'You do not have permission to label charges.',
  limit: 'This organization has reached the maximum number of charge labels.',
  rateLimited: 'Too many requests. Try again later.',
  failed: 'Could not save the label. Try again.',
});
