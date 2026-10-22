/**
 * Deterministic audit checks. The step-5 rules engine (`applyRulesTraced`) runs unchanged on a bundle
 * built from the applied contract terms (TL linehaul vs contract, line duplicates, off-schedule
 * accessorials, total vs lines, detention vs gate times). The checks below add what that engine does not
 * cover: cross-invoice duplicates, fuel surcharge vs contract percent or public-index table (with
 * wrong-base and wrong-week diagnosis, reusing the step-7 table functions), LTL re-rating (reweigh,
 * class, rate, minimum charge), line arithmetic, and the accessorial schedule. All money is exact `Dec`.
 *
 * Double counting is prevented by construction: line-arithmetic excess is removed from the lines (and
 * the total) before any other rule sees them, and LTL re-rating splits one linehaul difference into
 * disjoint weight and rate parts.
 */
import { applyRulesTraced } from '../analysis/engine.js';
import { Dec, add, compare, copyNegate, div, gt, lt, mul, pyMax, q2, sub, sumDec } from '../analysis/py-decimal.js';
import { normText } from '../analysis/py-text.js';
import type { ExtractedBundle } from '../extraction.js';
import { evaluateFscTable, expectedAmount, type FscTableSpec } from '../fuel/table.js';
import { applicablePosting } from '../fuel/week.js';
import type { PriceSeriesData } from '../outlook/constants.js';

import { lineKind, type LineKind } from './contract.js';
import type { AppliedTerms, AuditFinding, NormalizedInvoice, ShipmentEvidence } from './types.js';

export interface FuelContext {
  table: FscTableSpec;
  series: PriceSeriesData;
}

export interface AuditInput {
  invoice: NormalizedInvoice;
  evidence: ShipmentEvidence;
  terms: AppliedTerms;
  /** Invoices already received from carriers (for cross-invoice duplicates). */
  history: readonly NormalizedInvoice[];
  fuel: FuelContext | null;
  tolerance?: string;
}

type Draft = Omit<AuditFinding, 'id'>;

const D = (s: string): Dec => Dec.parse(s);
const S = (x: Dec): string => q2(x).toString();
const ZERO = Dec.fromInt(0);
const HUNDRED = Dec.fromInt(100);
const near = (a: Dec, b: Dec, tol: Dec): boolean => !gt(abs(sub(a, b)), tol);
function abs(x: Dec): Dec {
  return x.sign === 1 ? copyNegate(x) : x;
}

/** Indices of the lines of one kind. */
function indicesOf(inv: NormalizedInvoice, kind: LineKind): number[] {
  return inv.lines.flatMap((l, i) => (lineKind(l) === kind ? [i] : []));
}

function draft(p: Omit<Draft, 'direction' | 'calculation' | 'citations'> & Partial<Pick<Draft, 'calculation' | 'citations'>>): Draft {
  return { direction: 'overcharge', calculation: [], citations: [], ...p };
}

/** Step 1: line arithmetic. Returns the findings and the corrected line amounts. */
function lineMath(inv: NormalizedInvoice, tol: Dec): { findings: Draft[]; corrected: Dec[] } {
  const findings: Draft[] = [];
  const corrected = inv.lines.map((ln, i) => {
    const amount = D(ln.amount);
    if (ln.quantity === null || ln.rate === null) return amount;
    const computed = q2(mul(D(ln.quantity), D(ln.rate)));
    const excess = sub(amount, computed);
    if (!gt(excess, tol)) return amount;
    findings.push(
      draft({
        ruleId: 'AUD-LINE-MATH',
        title: 'Line amount does not equal quantity x rate',
        amount: S(excess),
        expected: S(computed),
        billed: S(amount),
        lines: [i],
        citations: [`invoice ${inv.invoiceNumber} line ${i + 1}`],
        calculation: [`${ln.quantity} x $${ln.rate} = $${S(computed)}; billed $${S(amount)}; excess $${S(excess)}.`],
        explanation: `'${ln.description}' is billed at $${S(amount)} but its printed quantity and rate give $${S(computed)}.`,
        confidence: 0.97,
        needsHumanReview: false,
      }),
    );
    return computed;
  });
  return { findings, corrected };
}

/** Lines of `inv` that also appear (same description and amount) on `prior`. */
function repeatedLines(inv: NormalizedInvoice, prior: NormalizedInvoice): Dec {
  const left = prior.lines.map((l) => `${normText(l.description)}|${D(l.amount).toString()}`);
  let sum = ZERO;
  for (const l of inv.lines) {
    const k = left.indexOf(`${normText(l.description)}|${D(l.amount).toString()}`);
    if (k < 0) continue;
    left.splice(k, 1);
    sum = add(sum, D(l.amount));
  }
  return sum;
}

/** Step 2: cross-invoice duplicate. A full duplicate makes every other finding moot. */
function duplicateInvoice(inv: NormalizedInvoice, history: readonly NormalizedInvoice[]): Draft | null {
  const carrier = normText(inv.carrier);
  const ref = (a: string | null, b: string | null): boolean => a !== null && b !== null && normText(a) === normText(b);
  const total = inv.total === null ? sumDec(inv.lines.map((l) => D(l.amount))) : D(inv.total);
  for (const prior of history) {
    if (normText(prior.carrier) !== carrier || prior === inv) continue;
    const sameRef = ref(inv.proNumber, prior.proNumber) || ref(inv.bolNumber, prior.bolNumber) || (ref(inv.loadNumber, prior.loadNumber) && inv.shipDate === prior.shipDate);
    if (!sameRef) continue;
    const priorTotal = prior.total === null ? sumDec(prior.lines.map((l) => D(l.amount))) : D(prior.total);
    const full = compare(total, priorTotal) === 0;
    const which = inv.proNumber !== null && ref(inv.proNumber, prior.proNumber) ? `PRO ${inv.proNumber}` : inv.bolNumber !== null && ref(inv.bolNumber, prior.bolNumber) ? `BOL ${inv.bolNumber}` : `load ${inv.loadNumber ?? ''}`;
    return draft({
      ruleId: 'AUD-DUP-INVOICE',
      title: full ? 'Shipment already billed on an earlier invoice' : 'Shipment billed again with a different amount',
      amount: S(full ? total : repeatedLines(inv, prior)),
      expected: S(ZERO),
      billed: S(total),
      lines: inv.lines.map((_, i) => i),
      citations: [`prior invoice ${prior.invoiceNumber} dated ${prior.invoiceDate}`, which],
      calculation: [`Invoice ${inv.invoiceNumber} ($${S(total)}) and invoice ${prior.invoiceNumber} ($${S(priorTotal)}) bill the same ${which}.`],
      explanation: full
        ? `Invoice ${inv.invoiceNumber} repeats invoice ${prior.invoiceNumber} for the same ${which} and the same amount.`
        : `Invoice ${inv.invoiceNumber} bills the same ${which} as invoice ${prior.invoiceNumber} with a different amount; it may be a corrected rebill. Verify before disputing.`,
      confidence: full ? 0.95 : 0.6,
      needsHumanReview: !full,
    });
  }
  return null;
}

/** Step 3: the step-5 engine on a bundle built from the applied terms. */
function stepFive(inv: NormalizedInvoice, ev: ShipmentEvidence, terms: AppliedTerms, corrected: Dec[], mathExcess: Dec, tol: Dec): Draft[] {
  const lane = terms.lane;
  const det = terms.detention;
  const authorized = [
    ...terms.accessorials.flatMap((a) => a.names),
    ...terms.lineCodes.filter((c) => c.code !== null).map((c) => inv.lines[c.line]?.description ?? ''),
  ].filter((n) => n !== '');
  const hasTimes = ev.arrivalTime !== null && ev.departureTime !== null;
  const bundle: ExtractedBundle = {
    invoice: {
      invoice_number: inv.invoiceNumber,
      load_number: inv.loadNumber,
      carrier: inv.carrier,
      shipper: null,
      invoice_date: inv.invoiceDate,
      lines: inv.lines.map((l, i) => ({ description: l.description, amount: (corrected[i] ?? D(l.amount)).toString() })),
      total: inv.total === null ? null : sub(D(inv.total), mathExcess).toString(),
      extraction_warnings: [],
    },
    rate_confirmation: {
      load_number: inv.loadNumber,
      carrier: inv.carrier,
      linehaul_rate: lane !== null && lane.mode === 'TL' ? lane.linehaul : null,
      fuel_surcharge: null,
      detention_free_hours: det?.freeHours ?? null,
      detention_rate_per_hour: det?.ratePerHour ?? null,
      detention_max_hours: det?.maxHours ?? null,
      authorized_accessorials: authorized,
      extraction_warnings: [],
    },
    bol: hasTimes
      ? { load_number: inv.loadNumber, facility: null, appointment_time: ev.appointmentTime, arrival_time: ev.arrivalTime, departure_time: ev.departureTime, extraction_warnings: [] }
      : null,
    warnings: [],
  };
  const { result, traces } = applyRulesTraced(bundle, 'shipper', { detentionIncrementMinutes: 15, amountTolerance: tol.toString(), disputeWindowDays: 90 });
  const clause = (rule: string): string[] => {
    if (rule === 'INV-LINEHAUL-RATE' && lane !== null) return [lane.clause];
    if (rule.startsWith('DET-') && det !== null) return [det.clause, 'BOL / gate times'];
    return [];
  };
  return result.findings.map((f, k) => {
    // A total mismatch rests on the stated total and every line.
    const lines = traces[k]?.total === true ? inv.lines.map((_, i) => i) : (traces[k]?.lines ?? []);
    const billed = f.rule_id === 'INV-TOTAL-MISMATCH' && inv.total !== null ? sub(D(inv.total), mathExcess) : sumDec(lines.map((i) => corrected[i] ?? ZERO));
    return draft({
      ruleId: f.rule_id,
      title: f.title,
      amount: f.amount,
      expected: S(sub(billed, D(f.amount))),
      billed: S(billed),
      lines,
      citations: [...clause(f.rule_id), ...lines.map((i) => `invoice ${inv.invoiceNumber} line ${i + 1}`)],
      calculation: f.calculation,
      explanation: f.explanation,
      confidence: f.confidence,
      needsHumanReview: f.needs_human_review,
    });
  });
}

/** Expected linehaul the fuel percent applies to (contract linehaul; LTL: the re-rated charge). */
function fuelBase(terms: AppliedTerms, ltlExpected: Dec | null): Dec | null {
  if (ltlExpected !== null) return ltlExpected;
  const lh = terms.lane?.linehaul ?? null;
  return lh === null ? null : D(lh);
}

/** Step 4: fuel surcharge vs contract terms, with a diagnosis of why it differs. */
function fuelCheck(inv: NormalizedInvoice, terms: AppliedTerms, fuel: FuelContext | null, corrected: Dec[], ltlExpected: Dec | null, tol: Dec): Draft[] {
  const idx = indicesOf(inv, 'fuel');
  if (idx.length === 0) return [];
  const billed = sumDec(idx.map((i) => corrected[i] ?? ZERO));
  const ft = terms.fuel;
  const cites = [ft.clause, ...idx.map((i) => `invoice ${inv.invoiceNumber} line ${i + 1}`)];
  if (ft.type === 'none') {
    return gt(billed, tol)
      ? [draft({ ruleId: 'AUD-FSC-NOT-IN-CONTRACT', title: 'Fuel surcharge billed but the contract has none', amount: S(billed), expected: '0.00', billed: S(billed), lines: idx, citations: cites, calculation: [`Contract fuel terms: none. Billed fuel $${S(billed)}.`], explanation: `The contract includes fuel in the rate; $${S(billed)} fuel surcharge was billed.`, confidence: 0.9, needsHumanReview: false })]
      : [];
  }
  const miles = inv.miles === null ? null : D(inv.miles);
  let unit: 'percent' | 'per_mile';
  let rate: Dec;
  const steps: string[] = [];
  let posting: ReturnType<typeof applicablePosting> = null;
  if (ft.type === 'percent') {
    unit = 'percent';
    rate = D(ft.percent);
    steps.push(`Contract fuel surcharge: ${ft.percent}% of linehaul.`);
  } else if (ft.type === 'per_mile') {
    unit = 'per_mile';
    rate = D(ft.ratePerMile);
    steps.push(`Contract fuel surcharge: $${ft.ratePerMile} per mile.`);
  } else {
    if (fuel === null || inv.shipDate === null) return [];
    posting = applicablePosting(fuel.series.observations, inv.shipDate, fuel.table.effectiveOffsetDays);
    if (posting === null) return [];
    unit = fuel.table.unit;
    rate = D(evaluateFscTable(fuel.table, posting.value).rate);
    steps.push(`Ship date ${inv.shipDate}: diesel price posted ${posting.date} = $${posting.value}; fuel table '${fuel.table.name}' v${fuel.table.version} gives ${unit === 'percent' ? `${rate.toString()}%` : `$${rate.toString()} per mile`}.`);
  }
  const base = fuelBase(terms, ltlExpected);
  const expected = expectedAmount(unit, rate, miles, base);
  if (expected === null) return [];
  steps.push(unit === 'percent' ? `Expected: ${rate.toString()}% x contract linehaul $${S(base ?? ZERO)} = $${S(expected)}.` : `Expected: ${miles?.toString() ?? ''} miles x $${rate.toString()} = $${S(expected)}.`);
  steps.push(`Billed fuel: $${S(billed)}.`);
  const diff = sub(billed, expected);
  if (!gt(diff, tol)) return [];
  const base0 = { amount: S(diff), expected: S(expected), billed: S(billed), lines: idx, citations: cites };

  if (unit === 'percent') {
    const kinds = inv.lines.map((l) => lineKind(l));
    const billedLinehaul = sumDec(kinds.map((k, i) => (k === 'linehaul' ? (corrected[i] ?? ZERO) : ZERO)));
    const withAccessorials = sumDec(kinds.map((k, i) => (k === 'linehaul' || k === 'accessorial' || k === 'detention' ? (corrected[i] ?? ZERO) : ZERO)));
    const at = (b: Dec): Dec => q2(div(mul(rate, b), HUNDRED));
    if (base !== null && compare(billedLinehaul, base) !== 0 && near(at(billedLinehaul), billed, tol)) {
      return [draft({ ...base0, ruleId: 'AUD-FSC-ON-OVERCHARGE', title: 'Fuel surcharge computed on an overbilled linehaul', calculation: [...steps, `Billed fuel equals ${rate.toString()}% x billed linehaul $${S(billedLinehaul)}; the contract linehaul is $${S(base)}.`], explanation: `The fuel percent was applied to the overbilled linehaul ($${S(billedLinehaul)}) instead of the contract linehaul ($${S(base)}).`, confidence: 0.9, needsHumanReview: false })];
    }
    if (compare(withAccessorials, billedLinehaul) !== 0 && near(at(withAccessorials), billed, tol)) {
      return [draft({ ...base0, ruleId: 'AUD-FSC-BASE', title: 'Fuel surcharge applied to accessorials (wrong base)', calculation: [...steps, `Billed fuel equals ${rate.toString()}% x $${S(withAccessorials)} (linehaul plus accessorials).`], explanation: `The contract applies fuel to linehaul only; the carrier applied ${rate.toString()}% to linehaul plus accessorials ($${S(withAccessorials)}).`, confidence: 0.92, needsHumanReview: false })];
    }
  }
  if (posting !== null && fuel !== null) {
    for (const off of [-1, -2, -3, 1]) {
      const obs = fuel.series.observations[posting.index + off];
      if (obs === undefined) continue;
      const alt = expectedAmount(unit, D(evaluateFscTable(fuel.table, obs.value).rate), miles, base);
      if (alt !== null && near(alt, billed, tol)) {
        return [draft({ ...base0, ruleId: 'AUD-FSC-WRONG-WEEK', title: 'Fuel surcharge uses the wrong week of the diesel index', calculation: [...steps, `Billed fuel equals the table result for the price posted ${obs.date} ($${obs.value}).`], explanation: `The fuel surcharge matches the diesel price posted ${obs.date}, not the posting that applies to ship date ${inv.shipDate ?? ''}.`, confidence: 0.85, needsHumanReview: false })];
      }
    }
  }
  return [draft({ ...base0, ruleId: 'AUD-FSC-RATE', title: 'Fuel surcharge above contract terms', calculation: steps, explanation: `Billed fuel $${S(billed)} exceeds the $${S(expected)} the contract fuel terms support; the cause is not identified.`, confidence: 0.75, needsHumanReview: true })];
}

/** Step 5: LTL re-rate. Returns findings and the expected linehaul (the fuel base). */
function ltlRerate(inv: NormalizedInvoice, ev: ShipmentEvidence, terms: AppliedTerms, corrected: Dec[], tol: Dec): { findings: Draft[]; expected: Dec | null } {
  const lane = terms.lane;
  if (lane === null || lane.mode !== 'LTL' || lane.ratePerCwt === null || inv.billedWeightLbs === null) return { findings: [], expected: null };
  const ratedClass = lane.fakClass ?? ev.bolClass ?? inv.billedClass;
  const rateText = ratedClass === null ? undefined : lane.ratePerCwt[ratedClass];
  if (rateText === undefined) return { findings: [], expected: null };
  const idx = indicesOf(inv, 'linehaul');
  if (idx.length === 0) return { findings: [], expected: null };
  const billed = sumDec(idx.map((i) => corrected[i] ?? ZERO));
  const billedW = D(inv.billedWeightLbs);
  const bolW = ev.bolWeightLbs === null ? null : D(ev.bolWeightLbs);
  const reweighDisallowed = bolW !== null && gt(billedW, bolW) && terms.reweighRequiresCertificate && ev.reweighCertificate === null;
  const weight = reweighDisallowed && bolW !== null ? bolW : billedW;
  const R = D(rateText);
  const computed = q2(div(mul(R, weight), HUNDRED));
  const min = lane.minimumCharge === null ? null : D(lane.minimumCharge);
  const expected = min !== null && lt(computed, min) ? min : computed;
  const findings: Draft[] = [];
  const cites = [lane.clause, ...idx.map((i) => `invoice ${inv.invoiceNumber} line ${i + 1}`)];
  const steps = [
    `Contract ${terms.contractId} lane ${lane.id}: class ${ratedClass ?? ''}${lane.fakClass !== null ? ' (FAK)' : ''} at $${rateText}/cwt.`,
    `Weight rated: ${weight.toString()} lb${reweighDisallowed ? ` (BOL weight; carrier billed ${billedW.toString()} lb without a reweigh certificate)` : ''}.`,
    `$${rateText} x ${weight.toString()} / 100 = $${S(computed)}${min !== null && lt(computed, min) ? `; below the $${S(min)} minimum, so the minimum applies` : ''}.`,
    `Expected linehaul $${S(expected)}; billed $${S(billed)}.`,
  ];
  let weightPart = ZERO;
  if (reweighDisallowed && bolW !== null) {
    weightPart = q2(div(mul(billed, sub(billedW, bolW)), billedW));
    const atBol = sub(billed, weightPart);
    // The weight part can never take the linehaul below the contract expectation.
    if (lt(atBol, expected)) weightPart = pyMax(ZERO, sub(billed, expected));
    if (gt(weightPart, tol)) {
      findings.push(draft({ ruleId: 'AUD-REWEIGH', title: 'Reweigh charge without a reweigh certificate', amount: S(weightPart), expected: S(sub(billed, weightPart)), billed: S(billed), lines: idx, citations: [...cites, 'BOL weight', 'reweigh certificate: none on file'], calculation: [...steps, `Weight part: $${S(billed)} x (${billedW.toString()} - ${bolW.toString()}) / ${billedW.toString()} = $${S(weightPart)}.`], explanation: `The carrier billed ${billedW.toString()} lb against a BOL weight of ${bolW.toString()} lb and supplied no reweigh certificate, which the contract requires.`, confidence: 0.88, needsHumanReview: false }));
    }
  }
  const ratePart = sub(sub(billed, weightPart), expected);
  if (gt(ratePart, tol)) {
    const minLine = idx.some((i) => normText(inv.lines[i]?.description ?? '').includes('minimum'));
    const classDiff = inv.billedClass !== null && ratedClass !== null && normText(inv.billedClass) !== normText(ratedClass);
    const ruleId = minLine ? 'AUD-MIN-CHARGE' : classDiff ? 'AUD-CLASS' : 'AUD-LTL-RATE';
    const title = minLine ? 'Minimum charge above contract' : classDiff ? `Rated at class ${inv.billedClass ?? ''} instead of class ${ratedClass ?? ''}` : 'LTL rate above contract';
    findings.push(draft({ ruleId, title, amount: S(ratePart), expected: S(expected), billed: S(sub(billed, weightPart)), lines: idx, citations: cites, calculation: [...steps, `Rate part: $${S(sub(billed, weightPart))} - $${S(expected)} = $${S(ratePart)}.`], explanation: `Linehaul is billed $${S(ratePart)} above the contract rating for lane ${lane.id}.`, confidence: 0.9, needsHumanReview: false }));
  }
  return { findings, expected };
}

/** Step 6: accessorial schedule (authorization and caps) and detention without terms or evidence. */
function accessorials(inv: NormalizedInvoice, ev: ShipmentEvidence, terms: AppliedTerms, corrected: Dec[], tol: Dec): Draft[] {
  const out: Draft[] = [];
  const approved = new Set(ev.authorizedAccessorials.map(normText));
  for (const lc of terms.lineCodes) {
    const line = inv.lines[lc.line];
    const amount = corrected[lc.line] ?? ZERO;
    if (line === undefined || !gt(amount, tol)) continue;
    const cite = `invoice ${inv.invoiceNumber} line ${lc.line + 1}`;
    if (lc.code === null) {
      // The step-5 rule INV-ACCESSORIAL-UNAUTH covers its known accessorial words; this covers the rest.
      if (normText(line.description) !== '' && !STEP5_WORDS.some((w) => normText(line.description).includes(w))) {
        out.push(draft({ ruleId: 'AUD-ACC-NOT-IN-CONTRACT', title: 'Charge not in the contract accessorial schedule', amount: S(amount), expected: '0.00', billed: S(amount), lines: [lc.line], citations: [cite], calculation: [`'${line.description}' = $${S(amount)}; no schedule entry matches.`], explanation: `'${line.description}' is not on the contract's accessorial schedule. It may be valid with separate approval; verify before disputing.`, confidence: 0.6, needsHumanReview: true }));
      }
      continue;
    }
    const term = terms.accessorials.find((a) => a.code === lc.code);
    if (term === undefined) continue;
    if (term.requiresAuthorization && !approved.has(normText(term.code))) {
      out.push(draft({ ruleId: 'AUD-ACC-UNAUTH', title: `${term.code} billed without the required approval`, amount: S(amount), expected: '0.00', billed: S(amount), lines: [lc.line], citations: [term.clause, cite, 'load approvals on file'], calculation: [`${term.code} requires per-load approval; approvals on file: ${ev.authorizedAccessorials.join(', ') || 'none'}.`], explanation: `The contract requires approval before ${term.code} is billed; no approval is on file for this load.`, confidence: 0.85, needsHumanReview: false }));
      continue;
    }
    if (term.maxAmount !== null && gt(sub(amount, D(term.maxAmount)), tol)) {
      out.push(draft({ ruleId: 'AUD-ACC-RATE', title: `${term.code} above the contract maximum`, amount: S(sub(amount, D(term.maxAmount))), expected: S(D(term.maxAmount)), billed: S(amount), lines: [lc.line], citations: [term.clause, cite], calculation: [`Billed $${S(amount)}; contract maximum $${term.maxAmount}.`], explanation: `${term.code} is capped at $${term.maxAmount} per occurrence.`, confidence: 0.9, needsHumanReview: false }));
    }
  }
  const det = indicesOf(inv, 'detention');
  const detBilled = sumDec(det.map((i) => corrected[i] ?? ZERO));
  if (det.length > 0 && gt(detBilled, tol)) {
    const cites = det.map((i) => `invoice ${inv.invoiceNumber} line ${i + 1}`);
    if (terms.detention === null) {
      out.push(draft({ ruleId: 'AUD-DET-NOT-IN-CONTRACT', title: 'Detention billed but the contract has no detention terms', amount: S(detBilled), expected: '0.00', billed: S(detBilled), lines: det, citations: cites, calculation: [`Billed detention $${S(detBilled)}; contract ${terms.contractId} has no detention clause.`], explanation: 'The contract has no detention terms; verify whether detention was agreed separately.', confidence: 0.6, needsHumanReview: true }));
    } else if (ev.arrivalTime === null || ev.departureTime === null) {
      out.push(draft({ ruleId: 'AUD-DET-NO-EVIDENCE', title: 'Detention billed without gate times', amount: S(detBilled), expected: null, billed: S(detBilled), lines: det, citations: [terms.detention.clause, ...cites], calculation: [`Billed detention $${S(detBilled)}; no arrival/departure times on file.`], explanation: 'Detention cannot be verified without arrival and departure times; request the carrier\'s gate record.', confidence: 0.5, needsHumanReview: true }));
    }
  }
  return out;
}

/** The step-5 accessorial words (normalized), so the two schedule rules never flag the same line. */
const STEP5_WORDS = ['lumper', 'layover', 'tonu', 'truck order not used', 'stop off', 'driver assist', 'liftgate', 'reconsign', 'redeliver', 'inside delivery', 'residential'];

/** Run every check on one invoice. Findings are overcharges only (shipper perspective). */
export function runAuditChecks(input: AuditInput): AuditFinding[] {
  const { invoice: inv, evidence: ev, terms, history } = input;
  const tol = D(input.tolerance ?? '0.01');
  const dup = duplicateInvoice(inv, history);
  let drafts: Draft[];
  if (dup !== null && !dup.needsHumanReview) {
    drafts = [dup];
  } else {
    const math = lineMath(inv, tol);
    const excess = sumDec(math.findings.map((f) => D(f.amount)));
    const ltl = ltlRerate(inv, ev, terms, math.corrected, tol);
    drafts = [
      ...(dup === null ? [] : [dup]),
      ...math.findings,
      ...stepFive(inv, ev, terms, math.corrected, excess, tol),
      ...ltl.findings,
      ...fuelCheck(inv, terms, input.fuel, math.corrected, ltl.expected, tol),
      ...accessorials(inv, ev, terms, math.corrected, tol),
    ];
  }
  return drafts.map((d, i) => ({ ...d, id: `${inv.invoiceNumber}/${d.ruleId}/${i + 1}` }));
}

/** Sum of finding amounts (exact), for totals. */
export function totalOf(findings: readonly AuditFinding[]): string {
  return S(findings.reduce((acc, f) => add(acc, D(f.amount)), ZERO));
}