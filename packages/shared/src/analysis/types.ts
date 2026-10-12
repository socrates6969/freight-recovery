/**
 * Public types and constants of the step-5 rules engine (`@fr/shared/analysis`, spec Part C P6). Output
 * shapes mirror the Python models (`freight_recovery.models.Finding`, `RecoveryResult`) in snake_case;
 * every decimal is the exact Python `str(Decimal)` text.
 */
import type { DecimalString } from '../decimal.js';

/** The engine refused its input (malformed decimal/datetime/settings, or an arithmetic the reference refuses). */
export class AnalysisInputError extends Error {
  constructor(message = 'analysis input invalid') {
    super(message);
    this.name = 'AnalysisInputError';
  }
}

export type AnalysisPerspective = 'shipper' | 'carrier';
export type FindingDirection = 'overcharge' | 'underbilled';
export type LineClass = 'detention' | 'linehaul' | 'fuel' | 'accessorial' | 'other';

export interface AnalysisSettings {
  /** Billable detention is rounded down to this many minutes (integer 1..240). */
  detentionIncrementMinutes: number;
  /** Differences up to this amount (DecimalString >= 0) are not findings. */
  amountTolerance: DecimalString;
  /** Dispute window quoted in the draft letter (integer 1..3650). */
  disputeWindowDays: number;
}

/** Python `Settings()` defaults (policy D7: constants in this step). */
export const DEFAULT_ANALYSIS_SETTINGS: Readonly<AnalysisSettings> = Object.freeze({
  detentionIncrementMinutes: 15,
  amountTolerance: '0.01',
  disputeWindowDays: 90,
});

export const RULES_VERSION = 'rules-v1';

export const RULE_IDS = [
  'INV-DUPLICATE',
  'INV-LINEHAUL-RATE',
  'INV-FUEL-SURCHARGE',
  'INV-ACCESSORIAL-UNAUTH',
  'INV-TOTAL-MISMATCH',
  'DET-UNBILLED',
  'DET-UNDERBILLED',
  'DET-OVERBILLED',
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export interface RuleFinding {
  rule_id: RuleId;
  title: string;
  direction: FindingDirection;
  amount: DecimalString;
  explanation: string;
  calculation: string[];
  confidence: number;
  needs_human_review: boolean;
}

export interface RecoveryResult {
  perspective: AnalysisPerspective;
  findings: RuleFinding[];
  recoverable_total: DecimalString;
  pending_review_total: DecimalString;
  ignored_findings: RuleFinding[];
}

export interface DetentionCalc {
  billable_hours: string;
  amount: DecimalString;
  steps: string[];
}

/** One source document as listed in the Markdown packet. */
export interface EvidenceDoc {
  filename: string;
  doc_type: 'invoice' | 'rate_confirmation' | 'bol' | 'unknown';
  sha256: string;
}
