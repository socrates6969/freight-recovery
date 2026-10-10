/**
 * Port of `freight_recovery/rules/detention.py` (spec A4). Convention (unchanged from the reference):
 * the clock starts at the LATER of appointment and arrival, free time comes from the rate confirmation,
 * billable time is rounded DOWN to whole increments, capped at the contract maximum, times the hourly rate.
 * Exact Python Decimal arithmetic; step texts byte-identical to the Python f-strings.
 */
import type { FindingTrace, TracedFinding } from './invoice-checks.js';
import type { LocalDateTime } from './local-datetime.js';
import { Dec, copyNegate, div, divInt, floorDivInt, format2f, gt, le, lt, mul, pyMax, q2, sub } from './py-decimal.js';
import { AnalysisInputError, type DetentionCalc } from './types.js';

const SECONDS_PER_HOUR = 3600;
const MINUTES_PER_HOUR = 60;

/** Validated detention inputs (datetimes parsed, decimals as Dec). */
export interface DetentionInput {
  appointment: LocalDateTime | null;
  arrival: LocalDateTime | null;
  departure: LocalDateTime | null;
  freeHours: Dec | null;
  ratePerHour: Dec | null;
  maxHours: Dec | null;
}

/** DetentionCalc plus the internal facts the packet cites (not part of the public JSON shape). */
export interface TracedDetention {
  calc: DetentionCalc;
  amount: Dec;
  clockStartedAtAppointment: boolean;
  capApplied: boolean;
}

/** `compute_detention` on validated input; null when a required input is missing. */
export function computeDetentionChecked(input: DetentionInput, incrementMinutes: number): TracedDetention | null {
  if (!Number.isInteger(incrementMinutes) || incrementMinutes < 1) throw new AnalysisInputError('increment_minutes must be >= 1');
  const { arrival, departure, freeHours, ratePerHour } = input;
  if (arrival === null || departure === null || freeHours === null || ratePerHour === null) return null;

  let start = arrival;
  const steps: string[] = [];
  let atAppointment = false;
  if (input.appointment !== null && input.appointment.epochSeconds() > start.epochSeconds()) {
    start = input.appointment;
    atAppointment = true;
    steps.push(`Arrived early; clock starts at appointment ${start.fmtYmdHm()}.`);
  } else {
    steps.push(`Clock starts at arrival ${start.fmtYmdHm()}.`);
  }

  const dwell = departure.epochSeconds() - start.epochSeconds();
  const dwellDec = Dec.fromInt(dwell);
  const hour = Dec.fromInt(SECONDS_PER_HOUR);
  steps.push(`Departure ${departure.fmtYmdHm()}; dwell = ${floorDivInt(dwell, MINUTES_PER_HOUR)} min (${format2f(div(dwellDec, hour))} h).`);
  const over = sub(dwellDec, mul(freeHours, hour));
  steps.push(`Less ${freeHours.toString()} h free time = ${format2f(div(pyMax(over, Dec.fromInt(0)), hour))} h over.`);
  if (le(over, Dec.fromInt(0))) {
    return {
      calc: { billable_hours: '0', amount: '0.00', steps: [...steps, 'No detention owed.'] },
      amount: Dec.parse('0.00'),
      clockStartedAtAppointment: atAppointment,
      capApplied: false,
    };
  }

  const minute = Dec.fromInt(MINUTES_PER_HOUR);
  let billableMin = mul(divInt(over, Dec.fromInt(incrementMinutes * MINUTES_PER_HOUR)), Dec.fromInt(incrementMinutes));
  steps.push(`Rounded down to ${incrementMinutes}-minute increments = ${billableMin.toString()} min (${format2f(div(billableMin, minute))} h).`);
  let capApplied = false;
  if (input.maxHours !== null && gt(billableMin, mul(input.maxHours, minute))) {
    billableMin = mul(input.maxHours, minute);
    capApplied = true;
    steps.push(`Capped at contract max of ${input.maxHours.toString()} h.`);
  }
  const billable = div(billableMin, minute);
  const amount = q2(div(mul(billableMin, ratePerHour), minute));
  steps.push(`${format2f(billable)} h x $${ratePerHour.toString()}/h = $${amount.toString()}.`);
  return {
    calc: { billable_hours: billable.toString(), amount: amount.toString(), steps },
    amount,
    clockStartedAtAppointment: atAppointment,
    capApplied,
  };
}

/** `detention_findings`: compare earned detention to what the invoice billed. */
export function detentionFindings(det: TracedDetention, invoiced: Dec, tolerance: Dec, detentionLines: number[]): TracedFinding[] {
  const diff = sub(det.amount, invoiced);
  const base = [...det.calc.steps, `Invoiced detention = $${invoiced.toString()}; earned = $${det.amount.toString()}.`];
  const trace: FindingTrace = {
    lines: detentionLines,
    total: false,
    detention: { clockStartedAtAppointment: det.clockStartedAtAppointment, capApplied: det.capApplied },
  };
  if (gt(diff, tolerance)) {
    const unbilled = invoiced.isZero();
    return [
      {
        finding: {
          rule_id: unbilled ? 'DET-UNBILLED' : 'DET-UNDERBILLED',
          title: unbilled ? 'Detention earned but not billed' : 'Detention under-billed',
          direction: 'underbilled',
          amount: q2(diff).toString(),
          explanation: `Gate times and rate-con terms support $${det.amount.toString()} of detention; $${invoiced.toString()} was billed.`,
          calculation: base,
          confidence: 0.85,
          needs_human_review: false,
        },
        trace,
      },
    ];
  }
  if (lt(diff, copyNegate(tolerance))) {
    return [
      {
        finding: {
          rule_id: 'DET-OVERBILLED',
          title: 'Detention billed above supported amount',
          direction: 'overcharge',
          amount: q2(copyNegate(diff)).toString(),
          explanation: `Invoice billed $${invoiced.toString()} detention; gate times and rate-con terms support only $${det.amount.toString()}.`,
          calculation: base,
          confidence: 0.85,
          needs_human_review: false,
        },
        trace,
      },
    ];
  }
  return [];
}
