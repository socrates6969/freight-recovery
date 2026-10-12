/**
 * Port of `freight_recovery/rules/invoice_checks.py` (spec A4): keyword line classification, exact
 * de-duplication and the invoice-error rules. Messages are byte-identical to the Python f-strings.
 */
import { pyStrip } from '../text-sanitize.js';

import { compare, gt, q2, sub, sumDec, type Dec } from './py-decimal.js';
import { normText, pyReprList } from './py-text.js';
import type { LineClass, RuleFinding } from './types.js';

export const ACCESSORIAL_WORDS = [
  'lumper',
  'layover',
  'tonu',
  'truck order not used',
  'stop off',
  'stop-off',
  'driver assist',
  'liftgate',
  'reconsign',
  'redeliver',
  'inside delivery',
  'residential',
] as const;

const NORMALIZED_ACCESSORIALS: readonly string[] = ACCESSORIAL_WORDS.map(normText);
const INCLUDED = /\b(incl|includes|including|included|inc)\b/u;

/** `classify_line`: exactly one category, first match wins. */
export function classifyLine(description: string): LineClass {
  const d = normText(description);
  const squashed = d.replaceAll(' ', '');
  if (d.includes('detention') || d.includes('dwell')) return 'detention';
  const hasLinehaul = squashed.includes('linehaul');
  if (hasLinehaul && INCLUDED.test(d)) return 'linehaul';
  if (d.includes('fuel') && (d.includes('surcharge') || d.split(' ').includes('fsc'))) return 'fuel';
  if (hasLinehaul) return 'linehaul';
  if (d.includes('fuel')) return 'fuel';
  if (NORMALIZED_ACCESSORIALS.some((w) => d.includes(w))) return 'accessorial';
  return 'other';
}

/** A validated charge line: its index in `invoice.lines`, the raw description and the amount. */
export interface CheckedLine {
  index: number;
  description: string;
  amount: Dec;
}

export interface CheckedInvoice {
  lines: CheckedLine[];
  total: Dec | null;
}

export interface CheckedRateCon {
  linehaulRate: Dec | null;
  fuelSurcharge: Dec | null;
  authorizedAccessorials: string[];
}

/** Internal trace of one finding: which invoice lines / fields it rests on (used for citations). */
export interface FindingTrace {
  /** Indices into `invoice.lines`, in citation order. */
  lines: number[];
  /** Cites the invoice `total` field. */
  total: boolean;
  /** Detention facts (DET-* only). */
  detention: { clockStartedAtAppointment: boolean; capApplied: boolean } | null;
}

export interface TracedFinding {
  finding: RuleFinding;
  trace: FindingTrace;
}

/** `dedupe`: (unique, repeats) by (stripped lower-case description, numeric amount); `firstOf` maps a repeat to its first occurrence. */
export function dedupe(lines: readonly CheckedLine[]): { unique: CheckedLine[]; dups: CheckedLine[]; firstOf: Map<number, number> } {
  const unique: CheckedLine[] = [];
  const dups: CheckedLine[] = [];
  const firstOf = new Map<number, number>();
  const seen: { key: string; amount: Dec; index: number }[] = [];
  for (const ln of lines) {
    const key = pyStrip(ln.description).toLowerCase();
    const hit = seen.find((s) => s.key === key && compare(s.amount, ln.amount) === 0);
    if (hit) {
      dups.push(ln);
      firstOf.set(ln.index, hit.index);
    } else {
      unique.push(ln);
      seen.push({ key, amount: ln.amount, index: ln.index });
    }
  }
  return { unique, dups, firstOf };
}

/** `str()` of a Dec for messages. */
const s = (x: Dec): string => x.toString();

const noTrace = (lines: number[], total = false): FindingTrace => ({ lines, total, detention: null });

/** `invoice_findings` (rc may be null: only self-consistency rules run). */
export function invoiceFindings(inv: CheckedInvoice, rc: CheckedRateCon | null, tolerance: Dec): TracedFinding[] {
  const out: TracedFinding[] = [];
  const { unique, dups, firstOf } = dedupe(inv.lines);

  for (const ln of dups) {
    out.push({
      finding: {
        rule_id: 'INV-DUPLICATE',
        title: 'Duplicate charge line',
        direction: 'overcharge',
        amount: s(q2(ln.amount)),
        explanation: `'${ln.description}' for $${s(ln.amount)} appears more than once. Could be a genuine repeat (e.g. two stops) - verify against the BOL/stop list before disputing.`,
        calculation: [`Repeat of identical line '${ln.description}' = $${s(ln.amount)}.`],
        confidence: 0.6,
        needs_human_review: true,
      },
      trace: noTrace([firstOf.get(ln.index) ?? ln.index, ln.index]),
    });
  }

  if (rc !== null) {
    const lhLines = unique.filter((ln) => classifyLine(ln.description) === 'linehaul');
    const lh = sumDec(lhLines.map((ln) => ln.amount));
    if (rc.linehaulRate !== null && gt(sub(lh, rc.linehaulRate), tolerance)) {
      const diff = sub(lh, rc.linehaulRate);
      out.push({
        finding: {
          rule_id: 'INV-LINEHAUL-RATE',
          title: 'Linehaul billed above rate confirmation',
          direction: 'overcharge',
          amount: s(q2(diff)),
          explanation: `Invoice linehaul $${s(lh)} vs agreed $${s(rc.linehaulRate)}.`,
          calculation: [`$${s(lh)} - $${s(rc.linehaulRate)} = $${s(diff)}.`],
          confidence: 0.95,
          needs_human_review: false,
        },
        trace: noTrace(lhLines.map((ln) => ln.index)),
      });
    }
    const fuelLines = unique.filter((ln) => classifyLine(ln.description) === 'fuel');
    const fsc = sumDec(fuelLines.map((ln) => ln.amount));
    if (rc.fuelSurcharge !== null && gt(sub(fsc, rc.fuelSurcharge), tolerance)) {
      const diff = sub(fsc, rc.fuelSurcharge);
      out.push({
        finding: {
          rule_id: 'INV-FUEL-SURCHARGE',
          title: 'Fuel surcharge above rate confirmation',
          direction: 'overcharge',
          amount: s(q2(diff)),
          explanation: `Invoice fuel $${s(fsc)} vs agreed $${s(rc.fuelSurcharge)}.`,
          calculation: [`$${s(fsc)} - $${s(rc.fuelSurcharge)} = $${s(diff)}.`],
          confidence: 0.9,
          needs_human_review: false,
        },
        trace: noTrace(fuelLines.map((ln) => ln.index)),
      });
    }
    const authorized = rc.authorizedAccessorials.map(normText).filter((a) => a !== '');
    const listed = rc.authorizedAccessorials.length > 0 ? pyReprList(rc.authorizedAccessorials) : 'none';
    for (const ln of unique) {
      if (classifyLine(ln.description) !== 'accessorial') continue;
      const d = normText(ln.description);
      if (d === '' || !authorized.some((a) => d.includes(a) || a.includes(d))) {
        out.push({
          finding: {
            rule_id: 'INV-ACCESSORIAL-UNAUTH',
            title: 'Accessorial not authorized on rate confirmation',
            direction: 'overcharge',
            amount: s(q2(ln.amount)),
            explanation: `'${ln.description}' ($${s(ln.amount)}) is not listed as authorized on the rate confirmation. May be valid with a receipt or separate approval - verify before disputing.`,
            calculation: [`Authorized accessorials: ${listed}.`, `Charged: '${ln.description}' = $${s(ln.amount)}.`],
            confidence: 0.6,
            needs_human_review: true,
          },
          trace: noTrace([ln.index]),
        });
      }
    }
  }

  if (inv.total !== null && inv.lines.length > 0) {
    const lineSum = sumDec(inv.lines.map((ln) => ln.amount));
    const diff = sub(inv.total, lineSum);
    if (gt(diff, tolerance)) {
      out.push({
        finding: {
          rule_id: 'INV-TOTAL-MISMATCH',
          title: 'Invoice total exceeds sum of line items',
          direction: 'overcharge',
          amount: s(q2(diff)),
          explanation: `Stated total $${s(inv.total)} vs line items $${s(lineSum)}.`,
          calculation: [`$${s(inv.total)} - $${s(lineSum)} = $${s(diff)}.`],
          confidence: 0.9,
          needs_human_review: false,
        },
        trace: noTrace([], true),
      });
    }
  }
  return out;
}
