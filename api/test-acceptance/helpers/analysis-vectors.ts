/* eslint-disable */
// Expected engine outputs for the repository fixtures, produced by running the Python reference
// (freight_recovery.rules.apply_rules / evidence.build_demand_letter; test-spec AN-E20, AN-E22, AN-E42).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SEED = resolve(__dirname, '..', '..', 'prisma', 'seed-data');
export const seedLetter = (f: 'ld5001.json' | 'ld5002.json'): string => JSON.parse(readFileSync(resolve(SEED, f), 'utf8')).demandLetter;

/** AN-E20 (ld5001, shipper): engine order. */
export const LD5001_SHIPPER = [
  { ruleId: 'INV-LINEHAUL-RATE', title: 'Linehaul billed above rate confirmation', direction: 'OVERCHARGE', amountCents: 10000, explanation: 'Invoice linehaul $1500.00 vs agreed $1400.00.', calculation: ['$1500.00 - $1400.00 = $100.00.'], confidence: 0.95, needsHumanReview: false },
  { ruleId: 'INV-ACCESSORIAL-UNAUTH', title: 'Accessorial not authorized on rate confirmation', direction: 'OVERCHARGE', amountCents: 15000, explanation: "'Lumper' ($150.00) is not listed as authorized on the rate confirmation. May be valid with a receipt or separate approval - verify before disputing.", calculation: ["Authorized accessorials: ['Detention'].", "Charged: 'Lumper' = $150.00."], confidence: 0.6, needsHumanReview: true },
  {
    ruleId: 'DET-OVERBILLED', title: 'Detention billed above supported amount', direction: 'OVERCHARGE', amountCents: 22500,
    explanation: 'Invoice billed $300.00 detention; gate times and rate-con terms support only $75.00.',
    calculation: ['Arrived early; clock starts at appointment 2025-03-03 08:00.', 'Departure 2025-03-03 11:30; dwell = 210 min (3.50 h).', 'Less 2 h free time = 1.50 h over.', 'Rounded down to 15-minute increments = 90 min (1.50 h).', '1.50 h x $50.00/h = $75.00.', 'Invoiced detention = $300.00; earned = $75.00.'],
    confidence: 0.85, needsHumanReview: false,
  },
];

/** AN-E22 (ld5002, carrier). */
export const LD5002_CARRIER = [
  {
    ruleId: 'DET-UNBILLED', title: 'Detention earned but not billed', direction: 'UNDERBILLED', amountCents: 16250,
    explanation: 'Gate times and rate-con terms support $162.50 of detention; $0 was billed.',
    calculation: ['Clock starts at arrival 2025-03-04 09:00.', 'Departure 2025-03-04 14:20; dwell = 320 min (5.33 h).', 'Less 2 h free time = 3.33 h over.', 'Rounded down to 15-minute increments = 195 min (3.25 h).', '3.25 h x $50.00/h = $162.50.', 'Invoiced detention = $0; earned = $162.50.'],
    confidence: 0.85, needsHumanReview: false,
  },
];

/** AN-E42 letter (date 2026-10-10). */
export const LD5002_CARRIER_LETTER =
  'DRAFT - FOR HUMAN REVIEW. NOT SENT. NOT LEGAL ADVICE.\n\nDate: 2026-10-10\nTo: Widget Co\nFrom: Acme Freight LLC\nRe: Load LD-5002 / Invoice INV-2002 - billing dispute\n\nDelivery records and the signed rate confirmation support the following charges that were not billed or were under-billed:\n\n1. Detention earned but not billed: $162.50\n   Gate times and rate-con terms support $162.50 of detention; $0 was billed.\n\nWe request payment of $162.50 in accessorial/detention charges for load LD-5002 (reference invoice INV-2002).\nSupporting documents and calculations are attached in the evidence packet.\nPlease respond within 30 days. (Reminder for sender: confirm the contractual dispute window - assumed 90 days from invoice date; verify before sending.)\n\nSincerely,\n[Name / Title / Contact - to be completed by sender]';

export const FINDING_KEYS = ['ruleId', 'title', 'direction', 'amountCents', 'explanation', 'calculation', 'confidence', 'needsHumanReview'] as const;
export const projectFinding = (f: any) => Object.fromEntries(FINDING_KEYS.map((k) => [k, f[k]]));
