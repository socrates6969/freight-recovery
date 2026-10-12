/**
 * Fuel-surcharge check (Part C F5, spec A3). Recomputes the expected surcharge from a tenant fuel table and
 * the public weekly diesel price that applies to the ship date, compares it with the billed fuel lines and
 * returns a `FuelCheckResult` plus at most one review-only `FSC-INDEX-MISMATCH` finding. Pure and
 * deterministic; exact decimals throughout (the step-5 `Dec`). The step-5 modules are imported, never
 * modified.
 */
import type { ExtractedBundle } from '../extraction.js';
import { classifyLine, dedupe, type CheckedLine } from '../analysis/invoice-checks.js';
import { Dec, compare, copyNegate, gt, q2, sub, sumDec } from '../analysis/py-decimal.js';
import { AnalysisInputError, DEFAULT_ANALYSIS_SETTINGS, type AnalysisSettings, type RuleFinding, type RuleId } from '../analysis/types.js';
import type { ChargeSuggestion } from '../charge-intel-dto.js';
import type { LearnedRuleId } from '../charge-intel/constants.js';
import { isCalendarDate, type FuelCheckResultDto, type FscMpgParamsDto, type FscRowsParamsDto, type FscStepParamsDto } from '../fuel-dto.js';
import { PRICE_SERIES, type PriceSeriesData } from '../outlook/constants.js';
import { plain } from '../text-sanitize.js';

import { FSC_CONFIDENCE, FUEL_CHECK_VERSION, type FuelResultStatus, type FuelRuleId } from './constants.js';
import { evaluateFscTable, expectedAmount, type FscEvaluation, type FscTableSpec } from './table.js';
import { applicablePosting, weekRuleText, type ApplicablePosting } from './week.js';

/** Cap of a fuel table name quoted in texts. */
const NAME_LIMIT = 80;
const MILES = /^[0-9]{1,5}(\.[0-9])?$/u;
/** Neighbouring postings tried by the wrong-week probe, in order (index offsets). */
const PROBE_OFFSETS = Object.freeze([-1, -2, -3, 1]);

/** Inputs of the fuel check for one claim. */
export interface FuelCheckInput {
  shipDate: string;
  /** Decimal text with at most one decimal (e.g. `500.0`), or null. */
  miles: string | null;
  table: FscTableSpec;
  series: PriceSeriesData | null;
}

/** A finding of the combined result: step-5, learned (step 6) or fuel (step 7). */
export type FuelAnalysisFinding = Omit<RuleFinding, 'rule_id'> & { rule_id: RuleId | LearnedRuleId | FuelRuleId };

export interface FuelCheckComputation {
  result: FuelCheckResultDto;
  finding: FuelAnalysisFinding | null;
  /** Invoice line indices of the billed fuel lines (citations of the finding). */
  traceLines: number[];
}

function checkString(v: unknown): string {
  if (typeof v !== 'string') throw new AnalysisInputError('not a string');
  return v;
}

function emptyResult(status: FuelResultStatus): FuelCheckResultDto {
  return {
    checkVersion: FUEL_CHECK_VERSION,
    status,
    priceSeries: null,
    postedDate: null,
    price: null,
    effectiveFrom: null,
    effectiveTo: null,
    rate: null,
    expected: null,
    billed: null,
    difference: null,
    direction: null,
    alternative: null,
    calculation: [],
    priceImport: null,
  };
}

function noResult(status: FuelResultStatus): FuelCheckComputation {
  return { result: emptyResult(status), finding: null, traceLines: [] };
}

interface FuelLine {
  line: CheckedLine;
  suggested: boolean;
}

/** F5.2: unique invoice lines the keyword rules call `fuel`, plus (with a classifier) suggested fuel lines. */
function billedFuelLines(bundle: ExtractedBundle, classify: ((d: string) => ChargeSuggestion) | null): FuelLine[] {
  const inv = bundle.invoice;
  if (inv === null) return [];
  const lines: CheckedLine[] = inv.lines.map((ln, index) => ({ index, description: checkString(ln.description), amount: Dec.parse(ln.amount) }));
  const out: FuelLine[] = [];
  for (const ln of dedupe(lines).unique) {
    const cls = classifyLine(ln.description);
    if (cls === 'fuel') {
      out.push({ line: ln, suggested: false });
    } else if (cls === 'other' && classify !== null) {
      const s = classify(ln.description);
      if (!s.abstained && s.category === 'fuel') out.push({ line: ln, suggested: true });
    }
  }
  return out;
}

/** F4 linehaul basis of a percent table, or null when missing or <= 0. */
function linehaulBasis(bundle: ExtractedBundle): { amount: Dec; basis: string } | null {
  const zero = Dec.fromInt(0);
  const rc = bundle.rate_confirmation;
  if (rc !== null && rc.linehaul_rate !== null) {
    const l = Dec.parse(rc.linehaul_rate);
    return gt(l, zero) ? { amount: l, basis: 'rate confirmation' } : null;
  }
  const inv = bundle.invoice;
  if (inv === null) return null;
  const lines: CheckedLine[] = inv.lines.map((ln, index) => ({ index, description: checkString(ln.description), amount: Dec.parse(ln.amount) }));
  const lh = dedupe(lines).unique.filter((ln) => classifyLine(ln.description) === 'linehaul');
  if (lh.length === 0) return null;
  const sum = sumDec(lh.map((ln) => ln.amount));
  return gt(sum, zero) ? { amount: sum, basis: 'invoice linehaul lines' } : null;
}

const decText = (x: string): string => Dec.parse(x).toString();

function unitText(table: FscTableSpec, x: string): string {
  return table.unit === 'per_mile' ? `$${x} per mile` : `${x}%`;
}

/** F5.3 step 3: the table line. */
function tableLine(table: FscTableSpec, price: string, ev: FscEvaluation): string {
  const head = `Fuel table '${plain(table.name, NAME_LIMIT)}' v${table.version}: `;
  if (table.kind === 'rows') {
    const p = table.params as FscRowsParamsDto;
    if (!ev.reachesFirstStep || ev.row === null) return `${head}$${price} is below the first row ($${decText(p.rows[0]?.atLeast ?? '0')}); rate ${unitText(table, '0')}.`;
    return `${head}row from $${decText(p.rows[ev.row]?.atLeast ?? '0')} applies: ${unitText(table, ev.rate)}.`;
  }
  const base = decText((table.params as FscStepParamsDto | FscMpgParamsDto).basePrice);
  if (!ev.reachesFirstStep) return `${head}$${price} does not reach the first step (base $${base}); rate ${unitText(table, '0')}.`;
  if (table.kind === 'mpg') {
    const p = table.params as FscMpgParamsDto;
    return `${head}($${price} - $${base}) / ${decText(p.mpg)} mpg = ${unitText(table, ev.rate)} (rounded half up to ${p.decimals} decimals).`;
  }
  const p = table.params as FscStepParamsDto;
  const formula = p.bracket === 'above_base' ? `ceil(($${price} - $${base}) / $${decText(p.stepSize)})` : `1 + floor(($${price} - $${base}) / $${decText(p.stepSize)})`;
  return `${head}${formula} = ${ev.steps ?? 0} step(s) x ${unitText(table, decText(p.ratePerStep))} = ${unitText(table, ev.rate)}.`;
}

function checkInput(input: FuelCheckInput): void {
  if (!isCalendarDate(input.shipDate)) throw new AnalysisInputError('shipDate must be a calendar date');
  if (input.miles !== null && (typeof input.miles !== 'string' || !MILES.test(input.miles))) throw new AnalysisInputError('miles must be a decimal with at most one decimal place');
}

/**
 * F5: the fuel check of one bundle with its finding and the billed fuel-line indices (internal form used
 * by `buildEvidenceFuel`). `classify` is the step-6 charge classifier (null: keyword fuel lines only).
 * `settings.amountTolerance` is the threshold of a finding (default: the step-5 default).
 */
export function computeFuelCheck(
  bundle: ExtractedBundle,
  input: FuelCheckInput | null,
  classify: ((description: string) => ChargeSuggestion) | null,
  settings: AnalysisSettings = DEFAULT_ANALYSIS_SETTINGS,
): FuelCheckComputation {
  if (input === null) return noResult('no_inputs');
  checkInput(input);
  const { table, series } = input;
  if (table.archived) return noResult('table_archived');
  const rc = bundle.rate_confirmation;
  if (rc !== null && rc.fuel_surcharge !== null) return noResult('contract_amount');
  const fuelLines = billedFuelLines(bundle, classify);
  if (fuelLines.length === 0) return noResult('no_fuel_line');
  const posting: ApplicablePosting | null = series === null ? null : applicablePosting(series.observations, input.shipDate, table.effectiveOffsetDays);
  if (series === null || posting === null) return noResult('price_unavailable');

  const tolerance = Dec.parse(settings.amountTolerance);
  const traceLines = fuelLines.map((f) => f.line.index);
  const billed = sumDec(fuelLines.map((f) => f.line.amount));
  const billedText = billed.toString();
  const ev = evaluateFscTable(table, posting.value);
  const rate = Dec.parse(ev.rate);
  const def = PRICE_SERIES[series.key];
  const partial: FuelCheckResultDto = {
    ...emptyResult('miles_missing'),
    priceSeries: 'diesel_us',
    postedDate: posting.date,
    price: posting.value,
    effectiveFrom: posting.effectiveFrom,
    effectiveTo: posting.effectiveTo,
    rate: ev.rate,
    billed: billedText,
    priceImport: { id: series.importId, sha256: series.sha256, retrievedAt: series.retrievedAt, sourceUrl: series.sourceUrl },
  };
  const miles = input.miles === null ? null : Dec.parse(input.miles);
  if (table.unit === 'per_mile' && miles === null) return { result: partial, finding: null, traceLines };
  const lh = table.unit === 'percent' ? linehaulBasis(bundle) : null;
  if (table.unit === 'percent' && lh === null) return { result: { ...partial, status: 'no_linehaul' }, finding: null, traceLines };

  const expectedFor = (r: Dec): Dec => {
    const e = expectedAmount(table.unit, r, miles, lh === null ? null : lh.amount);
    if (e === null) throw new AnalysisInputError('expected amount unavailable');
    return e;
  };
  const expected = expectedFor(rate);
  const expectedText = expected.toString();
  const diff = sub(billed, expected);
  const absDiff = diff.sign === 1 ? copyNegate(diff) : diff;
  const isFinding = gt(absDiff, tolerance);
  const difference = q2(diff).toString();

  const lineTexts = fuelLines.map((f) => `'${f.line.description}' $${f.line.amount.toString()}${f.suggested ? ' (suggested fuel line)' : ''}`).join(', ');
  const calculation = [
    `Ship date ${input.shipDate}: the ${def.label} posted ${posting.date} applies ${posting.effectiveFrom} to ${posting.effectiveTo} (${weekRuleText(table.effectiveOffsetDays)}).`,
    `Price posted ${posting.date}: $${posting.value} per gallon (${def.citation}; file sha256 ${series.sha256.slice(0, 12)}).`,
    tableLine(table, posting.value, ev),
    table.unit === 'per_mile'
      ? `Expected: ${miles?.toString() ?? ''} miles x ${unitText(table, ev.rate)} = $${expectedText}.`
      : `Expected: ${ev.rate}% x linehaul $${lh?.amount.toString() ?? ''} (${lh?.basis ?? ''}) = $${expectedText}.`,
    `Billed fuel lines: ${lineTexts} = $${billedText}.`,
    `Difference: $${billedText} - $${expectedText} = $${difference}.`,
  ];
  if (!isFinding) {
    return { result: { ...partial, status: 'within_tolerance', expected: expectedText, difference, calculation }, finding: null, traceLines };
  }

  // F5.3 step 7 / D6: the first neighbouring posting whose table result equals the billed amount.
  let alternative: FuelCheckResultDto['alternative'] = null;
  for (const off of PROBE_OFFSETS) {
    const obs = series.observations[posting.index + off];
    if (posting.index + off < 0 || obs === undefined) continue;
    const alt = expectedFor(Dec.parse(evaluateFscTable(table, obs.value).rate));
    if (compare(alt, billed) === 0) {
      alternative = { postedDate: obs.date, price: obs.value, weeks: Math.abs(off), later: off > 0 };
      break;
    }
  }
  if (alternative !== null) {
    calculation.push(
      `The billed amount equals the table result for the price posted ${alternative.postedDate} ($${alternative.price}), ${alternative.weeks} week(s) ${alternative.later ? 'later' : 'earlier'} than the applicable posting.`,
    );
  }
  const direction = gt(billed, expected) ? 'overcharge' : 'underbilled';
  const finding: FuelAnalysisFinding = {
    rule_id: 'FSC-INDEX-MISMATCH',
    title: 'Fuel surcharge differs from the fuel table (review)',
    direction,
    amount: q2(absDiff).toString(),
    explanation: `Billed fuel surcharge $${billedText} vs $${expectedText} from fuel table '${plain(table.name, NAME_LIMIT)}' for ship date ${input.shipDate}. Verify the table, the miles and the ship date before disputing.`,
    calculation: [...calculation],
    confidence: FSC_CONFIDENCE,
    needs_human_review: true,
  };
  return {
    result: { ...partial, status: 'finding', expected: expectedText, difference, direction, alternative, calculation },
    finding,
    traceLines,
  };
}

/** F5 `checkFuel(bundle, input, classify | null)`: the `FuelCheckResult` of one bundle. */
export function checkFuel(
  bundle: ExtractedBundle,
  input: FuelCheckInput | null,
  classify: ((description: string) => ChargeSuggestion) | null,
  settings: AnalysisSettings = DEFAULT_ANALYSIS_SETTINGS,
): FuelCheckResultDto {
  return computeFuelCheck(bundle, input, classify, settings).result;
}
