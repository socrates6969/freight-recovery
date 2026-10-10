/**
 * Port of `freight_recovery/rules/engine.py` (spec A4): validate the bundle, run the invoice and detention
 * rules, split findings by perspective and total them. `applyRulesTraced` additionally returns, per
 * finding, the invoice lines / fields it rests on (used by the API to build citations).
 */
import type { BillOfLading, ExtractedBundle, RateConfirmation } from '../extraction.js';

import { computeDetentionChecked, detentionFindings, type DetentionInput } from './detention.js';
import { classifyLine, dedupe, invoiceFindings, type CheckedInvoice, type CheckedRateCon, type FindingTrace, type TracedFinding } from './invoice-checks.js';
import { LocalDateTime } from './local-datetime.js';
import { Dec, q2, sumDec } from './py-decimal.js';
import {
  AnalysisInputError,
  DEFAULT_ANALYSIS_SETTINGS,
  type AnalysisPerspective,
  type AnalysisSettings,
  type DetentionCalc,
  type RecoveryResult,
  type RuleFinding,
} from './types.js';

const INCREMENT_MIN = 1;
const INCREMENT_MAX = 240;
const WINDOW_MIN = 1;
const WINDOW_MAX = 3650;

export interface CheckedSettings {
  increment: number;
  tolerance: Dec;
  windowDays: number;
}

/** Validate engine settings (integers in range, tolerance a decimal string). */
export function checkSettings(settings: AnalysisSettings): CheckedSettings {
  const { detentionIncrementMinutes: inc, amountTolerance, disputeWindowDays: win } = settings;
  if (!Number.isInteger(inc) || inc < INCREMENT_MIN || inc > INCREMENT_MAX) throw new AnalysisInputError('detentionIncrementMinutes out of range');
  if (!Number.isInteger(win) || win < WINDOW_MIN || win > WINDOW_MAX) throw new AnalysisInputError('disputeWindowDays out of range');
  return { increment: inc, tolerance: Dec.parse(amountTolerance), windowDays: win };
}

const optDec = (v: string | null | undefined): Dec | null => (v === null || v === undefined ? null : Dec.parse(v));
const optDt = (v: string | null | undefined): LocalDateTime | null => (v === null || v === undefined ? null : LocalDateTime.parse(v));

function checkString(v: unknown): string {
  if (typeof v !== 'string') throw new AnalysisInputError('not a string');
  return v;
}

function checkRateCon(rc: RateConfirmation): CheckedRateCon & { detention: Pick<DetentionInput, 'freeHours' | 'ratePerHour' | 'maxHours'> } {
  if (!Array.isArray(rc.authorized_accessorials)) throw new AnalysisInputError('authorized_accessorials must be a list');
  return {
    linehaulRate: optDec(rc.linehaul_rate),
    fuelSurcharge: optDec(rc.fuel_surcharge),
    authorizedAccessorials: rc.authorized_accessorials.map(checkString),
    detention: {
      freeHours: optDec(rc.detention_free_hours),
      ratePerHour: optDec(rc.detention_rate_per_hour),
      maxHours: optDec(rc.detention_max_hours),
    },
  };
}

function checkBol(bol: BillOfLading): Pick<DetentionInput, 'appointment' | 'arrival' | 'departure'> {
  return { appointment: optDt(bol.appointment_time), arrival: optDt(bol.arrival_time), departure: optDt(bol.departure_time) };
}

/** `compute_detention(bol, rc, increment_minutes)`: the public JSON shape, or null when inputs are missing. */
export function computeDetention(bol: BillOfLading, rc: RateConfirmation, incrementMinutes = DEFAULT_ANALYSIS_SETTINGS.detentionIncrementMinutes): DetentionCalc | null {
  const r = checkRateCon(rc);
  const traced = computeDetentionChecked({ ...checkBol(bol), ...r.detention }, incrementMinutes);
  return traced === null ? null : traced.calc;
}

export interface TracedResult {
  result: RecoveryResult;
  /** Traces aligned with `result.findings`. */
  traces: FindingTrace[];
}

function checkPerspective(p: unknown): AnalysisPerspective {
  if (p !== 'shipper' && p !== 'carrier') throw new AnalysisInputError('perspective must be shipper or carrier');
  return p;
}

/** `apply_rules` with per-finding traces. */
export function applyRulesTraced(bundle: ExtractedBundle, perspective: AnalysisPerspective, settings: AnalysisSettings = DEFAULT_ANALYSIS_SETTINGS): TracedResult {
  const persp = checkPerspective(perspective);
  const cfg = checkSettings(settings);
  // Validate everything first (pydantic validates the whole bundle before any rule runs).
  const inv: CheckedInvoice | null =
    bundle.invoice === null
      ? null
      : {
          lines: bundle.invoice.lines.map((ln, index) => ({ index, description: checkString(ln.description), amount: Dec.parse(ln.amount) })),
          total: optDec(bundle.invoice.total),
        };
  const rc = bundle.rate_confirmation === null ? null : checkRateCon(bundle.rate_confirmation);
  const bol = bundle.bol === null ? null : checkBol(bundle.bol);

  const all: TracedFinding[] = [];
  if (inv !== null) all.push(...invoiceFindings(inv, rc, cfg.tolerance));
  if (bol !== null && rc !== null) {
    const det = computeDetentionChecked({ ...bol, ...rc.detention }, cfg.increment);
    if (det !== null) {
      // Repeated identical detention lines are reported once by INV-DUPLICATE; only unique lines count.
      const detLines = inv === null ? [] : dedupe(inv.lines).unique.filter((ln) => classifyLine(ln.description) === 'detention');
      const invoiced = sumDec(detLines.map((ln) => ln.amount));
      all.push(...detentionFindings(det, invoiced, cfg.tolerance, detLines.map((ln) => ln.index)));
    }
  }

  const isMine = (f: RuleFinding): boolean => (f.direction === 'overcharge') === (persp === 'shipper');
  const mine = all.filter((t) => isMine(t.finding));
  const other = all.filter((t) => !isMine(t.finding));
  const amountOf = (f: RuleFinding): Dec => Dec.parse(f.amount);
  const recoverable = q2(sumDec(mine.filter((t) => !t.finding.needs_human_review).map((t) => amountOf(t.finding))));
  const pending = q2(sumDec(mine.filter((t) => t.finding.needs_human_review).map((t) => amountOf(t.finding))));
  return {
    result: {
      perspective: persp,
      findings: mine.map((t) => t.finding),
      recoverable_total: recoverable.toString(),
      pending_review_total: pending.toString(),
      ignored_findings: other.map((t) => t.finding),
    },
    traces: mine.map((t) => t.trace),
  };
}

/** `apply_rules(bundle, perspective, settings)`. */
export function applyRules(bundle: ExtractedBundle, perspective: AnalysisPerspective, settings: AnalysisSettings = DEFAULT_ANALYSIS_SETTINGS): RecoveryResult {
  return applyRulesTraced(bundle, perspective, settings).result;
}
