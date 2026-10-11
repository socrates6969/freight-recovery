// REQ-20261011-fuel-outlook: test-owned oracle for Part C F3 (week rule), F4 (exact FSC table evaluation) and F5
// (fuel check: statuses, billed lines, finding texts, neighbouring postings, result fields). Written from the Part C
// text only; it never imports the product's fuel or outlook modules. All money and rate arithmetic uses exact
// rationals over BigInt. The step-5 `classifyLine` and the step-6 suggestion are injected by the caller (the
// suggestion comes from the test-owned C3 oracle in charge-oracle.ts). Pure (no imports).

// ---------------------------------------------------------------------------------------------------------------
// Exact rationals
// ---------------------------------------------------------------------------------------------------------------
export interface Q { n: bigint; d: bigint }
const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
export const q = (n: bigint, d = 1n): Q => { if (d === 0n) throw new RangeError('division by zero'); if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d) || 1n; return { n: n / g, d: d / g }; };
export const qAdd = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d);
export const qSub = (a: Q, b: Q): Q => q(a.n * b.d - b.n * a.d, a.d * b.d);
export const qMul = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d);
export const qDiv = (a: Q, b: Q): Q => q(a.n * b.d, a.d * b.n);
export const qCmp = (a: Q, b: Q): number => { const x = a.n * b.d - b.n * a.d; return x < 0n ? -1 : x > 0n ? 1 : 0; };
const floorDiv = (n: bigint, d: bigint): bigint => { const f = n / d; return (n % d !== 0n && (n < 0n) !== (d < 0n)) ? f - 1n : f; };
export const qFloor = (a: Q): bigint => floorDiv(a.n, a.d);
export const qCeil = (a: Q): bigint => -floorDiv(-a.n, a.d);

/** Decimal text -> rational (accepts an optional sign, integer and fraction digits). */
export function dec(s: string): Q {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new RangeError(`not a decimal: ${s}`);
  const frac = m[3] ?? '';
  const v = q(BigInt((m[2] ?? '0') + frac), 10n ** BigInt(frac.length));
  return m[1] ? q(-v.n, v.d) : v;
}
/** Python `str(Decimal(given))` for plain non-negative decimal texts (drops leading zeros of the integer part). */
export function pyStr(s: string): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new RangeError(`not a decimal: ${s}`);
  return m[2] === undefined ? BigInt(m[1] ?? '0').toString() : `${BigInt(m[1] ?? '0').toString()}.${m[2]}`;
}
/** Scaled integer -> text with exactly `scale` decimals (Python str of a Decimal with that exponent). */
export function scaledText(v: bigint, scale: number): string {
  const neg = v < 0n;
  const a = (neg ? -v : v).toString().padStart(scale + 1, '0');
  const body = scale === 0 ? a : `${a.slice(0, a.length - scale)}.${a.slice(a.length - scale)}`;
  return neg ? `-${body}` : body;
}
/** Q(x): quantize to cents, ROUND_HALF_EVEN; returns integer cents. */
export function centsHalfEven(x: Q): bigint {
  const t = q(x.n * 100n, x.d);
  const f = qFloor(t);
  const rem = q(t.n - f * t.d, t.d); // in [0, 1)
  const c = qCmp(rem, q(1n, 2n));
  if (c < 0) return f;
  if (c > 0) return f + 1n;
  return f % 2n === 0n ? f : f + 1n;
}
export const centsText = (c: bigint): string => scaledText(c, 2);
const fracDigits = (s: string): number => (s.split('.')[1] ?? '').length;

// ---------------------------------------------------------------------------------------------------------------
// F3 week rule
// ---------------------------------------------------------------------------------------------------------------
export interface Obs { date: string; value: string }
export const DAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export const dayNum = (iso: string): number => { const [Y = 0, M = 1, D = 1] = iso.split('-').map(Number); return Date.UTC(Y, M - 1, D) / 86400000; };
export const isoOf = (n: number): string => new Date(n * 86400000).toISOString().slice(0, 10);
export const addDays = (iso: string, k: number): string => isoOf(dayNum(iso) + k);
export const ruleText = (o: number): string => `Monday posting applies ${DAY[o] ?? '?'} to ${DAY[(o + 6) % 7] ?? '?'}`;

export interface OPosting { index: number; postedDate: string; price: string; effectiveFrom: string; effectiveTo: string }
export function oPosting(obs: readonly Obs[], shipDate: string, o: number): OPosting | null {
  const D = dayNum(shipDate);
  let idx = -1;
  for (let i = 0; i < obs.length; i++) {
    const w = obs[i];
    if (w && dayNum(w.date) + o <= D) idx = i;
  }
  const w = obs[idx];
  if (!w) return null;
  const from = dayNum(w.date) + o;
  if (D > from + 6) return null;
  return { index: idx, postedDate: w.date, price: w.value, effectiveFrom: isoOf(from), effectiveTo: isoOf(from + 6) };
}

// ---------------------------------------------------------------------------------------------------------------
// F4 tables
// ---------------------------------------------------------------------------------------------------------------
export interface StepParams { basePrice: string; stepSize: string; ratePerStep: string; bracket: 'above_base' | 'from_base' }
export interface MpgParams { basePrice: string; mpg: string; decimals: 2 | 3 | 4 }
export interface RowsParams { rows: { atLeast: string; rate: string }[] }
export type OTable =
  | { name: string; version: number; kind: 'step'; unit: 'per_mile' | 'percent'; priceSeries: 'diesel_us'; effectiveOffsetDays: number; params: StepParams; archived: boolean }
  | { name: string; version: number; kind: 'mpg'; unit: 'per_mile'; priceSeries: 'diesel_us'; effectiveOffsetDays: number; params: MpgParams; archived: boolean }
  | { name: string; version: number; kind: 'rows'; unit: 'per_mile' | 'percent'; priceSeries: 'diesel_us'; effectiveOffsetDays: number; params: RowsParams; archived: boolean };
export interface OEval { rate: string; steps: number | null; row: number | null; reachesFirstStep: boolean }

export function oEvaluate(t: OTable, price: string): OEval {
  const P = dec(price);
  if (t.kind === 'step') {
    const { basePrice, stepSize, ratePerStep, bracket } = t.params;
    const B = dec(basePrice);
    const S = dec(stepSize);
    let k = 0n;
    if (bracket === 'above_base' && qCmp(P, B) > 0) k = qCeil(qDiv(qSub(P, B), S));
    if (bracket === 'from_base' && qCmp(P, B) >= 0) k = qFloor(qDiv(qSub(P, B), S)) + 1n;
    if (k === 0n) return { rate: '0', steps: 0, row: null, reachesFirstStep: false };
    const R = dec(ratePerStep);
    const scale = fracDigits(ratePerStep);
    return { rate: scaledText(R.n * (10n ** BigInt(scale) / R.d) * k, scale), steps: Number(k), row: null, reachesFirstStep: true };
  }
  if (t.kind === 'mpg') {
    const { basePrice, mpg, decimals } = t.params;
    const B = dec(basePrice);
    if (qCmp(P, B) <= 0) return { rate: '0', steps: null, row: null, reachesFirstStep: false };
    const x = qMul(qDiv(qSub(P, B), dec(mpg)), q(10n ** BigInt(decimals)));
    const v = qFloor(qAdd(x, q(1n, 2n))); // half up (x > 0)
    return { rate: scaledText(v, decimals), steps: null, row: null, reachesFirstStep: true };
  }
  let row = -1;
  t.params.rows.forEach((r, i) => { if (qCmp(dec(r.atLeast), P) <= 0) row = i; });
  const r = t.params.rows[row];
  if (!r) return { rate: '0', steps: null, row: null, reachesFirstStep: false };
  return { rate: pyStr(r.rate), steps: null, row, reachesFirstStep: true };
}

// ---------------------------------------------------------------------------------------------------------------
// F5 fuel check
// ---------------------------------------------------------------------------------------------------------------
export interface OLine { description: string; amount: string }
export interface OBundle {
  invoice: { lines: OLine[] } | null;
  rate_confirmation: { linehaul_rate: string | null; fuel_surcharge: string | null } | null;
}
export interface OSeries { key: 'diesel_us'; importId: string; sha256: string; sourceUrl: string; retrievedAt: string; observations: Obs[] }
export interface OInput { shipDate: string; miles: string | null; table: OTable; series: OSeries | null }
export interface OResult {
  checkVersion: 'fsc-v1'; status: string; priceSeries: 'diesel_us' | null;
  postedDate: string | null; price: string | null; effectiveFrom: string | null; effectiveTo: string | null;
  rate: string | null; expected: string | null; billed: string | null; difference: string | null;
  direction: 'overcharge' | 'underbilled' | null;
  alternative: { postedDate: string; price: string; weeks: number; later: boolean } | null;
  calculation: string[];
  priceImport: { id: string; sha256: string; retrievedAt: string; sourceUrl: string } | null;
}
export interface OFinding { rule_id: string; title: string; direction: 'overcharge' | 'underbilled'; amount: string; explanation: string; calculation: string[]; confidence: number; needs_human_review: boolean }
export interface ODeps {
  classifyLine: (description: string) => string;
  /** null = no classifier; else the step-6 suggestion for a description */
  suggest: ((description: string) => { abstained: boolean; category: string | null }) | null;
  tolerance: string;
  seriesLabel: string;
  citation: string;
}

const lineCents = (a: string): bigint => { const c = centsHalfEven(dec(a)); if (qCmp(dec(a), q(c, 100n)) !== 0) throw new RangeError(`oracle supports 2-decimal amounts only: ${a}`); return c; };

/** Step-5 unique lines: first occurrence per (trimmed lower-case description, numeric amount), in line order. */
export function oUnique(lines: readonly OLine[]): OLine[] {
  const seen: { key: string; c: bigint }[] = [];
  const out: OLine[] = [];
  for (const ln of lines) {
    const key = ln.description.trim().toLowerCase();
    const c = lineCents(ln.amount);
    if (seen.some((s) => s.key === key && s.c === c)) continue;
    seen.push({ key, c });
    out.push(ln);
  }
  return out;
}

const empty = (status: string): OResult => ({
  checkVersion: 'fsc-v1', status, priceSeries: null, postedDate: null, price: null, effectiveFrom: null, effectiveTo: null,
  rate: null, expected: null, billed: null, difference: null, direction: null, alternative: null, calculation: [], priceImport: null,
});

export function oCheckFuel(b: OBundle, input: OInput | null, deps: ODeps): { result: OResult; finding: OFinding | null } {
  if (!input) return { result: empty('no_inputs'), finding: null };
  const t = input.table;
  if (t.archived) return { result: empty('table_archived'), finding: null };
  if (b.rate_confirmation && b.rate_confirmation.fuel_surcharge !== null) return { result: empty('contract_amount'), finding: null };
  const unique = b.invoice ? oUnique(b.invoice.lines) : [];
  const fuel: { ln: OLine; suggested: boolean }[] = [];
  for (const ln of unique) {
    const cls = deps.classifyLine(ln.description);
    if (cls === 'fuel') fuel.push({ ln, suggested: false });
    else if (cls === 'other' && deps.suggest) {
      const s = deps.suggest(ln.description);
      if (!s.abstained && s.category === 'fuel') fuel.push({ ln, suggested: true });
    }
  }
  if (fuel.length === 0) return { result: empty('no_fuel_line'), finding: null };
  const series = input.series;
  const post = series ? oPosting(series.observations, input.shipDate, t.effectiveOffsetDays) : null;
  if (!series || !post) return { result: empty('price_unavailable'), finding: null };
  const ev = oEvaluate(t, post.price);
  const billedC = fuel.reduce((s, f) => s + lineCents(f.ln.amount), 0n);
  const billed = centsText(billedC);
  const base: OResult = {
    ...empty('x'), priceSeries: 'diesel_us', postedDate: post.postedDate, price: post.price, effectiveFrom: post.effectiveFrom, effectiveTo: post.effectiveTo,
    rate: ev.rate, billed, priceImport: { id: series.importId, sha256: series.sha256, retrievedAt: series.retrievedAt, sourceUrl: series.sourceUrl },
  };
  if (t.unit === 'per_mile' && input.miles === null) return { result: { ...base, status: 'miles_missing' }, finding: null };
  let L: { c: bigint; basis: string } | null = null;
  if (t.unit === 'percent') {
    const rc = b.rate_confirmation;
    if (rc && rc.linehaul_rate !== null) L = { c: lineCents(rc.linehaul_rate), basis: 'rate confirmation' };
    else {
      const lh = unique.filter((ln) => deps.classifyLine(ln.description) === 'linehaul');
      if (lh.length) L = { c: lh.reduce((s, ln) => s + lineCents(ln.amount), 0n), basis: 'invoice linehaul lines' };
    }
    if (!L || L.c <= 0n) return { result: { ...base, status: 'no_linehaul' }, finding: null };
  }
  const expectedFor = (rate: string): bigint => (t.unit === 'per_mile'
    ? centsHalfEven(qMul(dec(input.miles ?? '0'), dec(rate)))
    : centsHalfEven(qDiv(qMul(dec(rate), q(L ? L.c : 0n, 100n)), q(100n))));
  const expC = expectedFor(ev.rate);
  const expected = centsText(expC);
  const diffC = billedC - expC;
  const unitText = (x: string) => (t.unit === 'per_mile' ? `$${x} per mile` : `${x}%`);
  const head = `Fuel table '${plain80(t.name)}' v${t.version}: `;
  let line3: string;
  if (t.kind === 'step') {
    const p = t.params;
    if (!ev.reachesFirstStep) line3 = `${head}$${post.price} does not reach the first step (base $${pyStr(p.basePrice)}); rate ${unitText('0')}.`;
    else if (p.bracket === 'above_base') line3 = `${head}ceil(($${post.price} - $${pyStr(p.basePrice)}) / $${pyStr(p.stepSize)}) = ${ev.steps ?? '?'} step(s) x ${unitText(pyStr(p.ratePerStep))} = ${unitText(ev.rate)}.`;
    else line3 = `${head}1 + floor(($${post.price} - $${pyStr(p.basePrice)}) / $${pyStr(p.stepSize)}) = ${ev.steps ?? '?'} step(s) x ${unitText(pyStr(p.ratePerStep))} = ${unitText(ev.rate)}.`;
  } else if (t.kind === 'mpg') {
    const p = t.params;
    line3 = ev.reachesFirstStep
      ? `${head}($${post.price} - $${pyStr(p.basePrice)}) / ${pyStr(p.mpg)} mpg = ${unitText(ev.rate)} (rounded half up to ${p.decimals} decimals).`
      : `${head}$${post.price} does not reach the first step (base $${pyStr(p.basePrice)}); rate ${unitText('0')}.`;
  } else {
    const rows = t.params.rows;
    const r = ev.row === null ? undefined : rows[ev.row];
    line3 = r ? `${head}row from $${pyStr(r.atLeast)} applies: ${unitText(ev.rate)}.` : `${head}$${post.price} is below the first row ($${pyStr(rows[0]?.atLeast ?? '0')}); rate ${unitText('0')}.`;
  }
  const line4 = t.unit === 'per_mile'
    ? `Expected: ${pyStr(input.miles ?? '0')} miles x ${unitText(ev.rate)} = $${expected}.`
    : `Expected: ${ev.rate}% x linehaul $${centsText(L ? L.c : 0n)} (${L ? L.basis : ''}) = $${expected}.`;
  const calc = [
    `Ship date ${input.shipDate}: the ${deps.seriesLabel} posted ${post.postedDate} applies ${post.effectiveFrom} to ${post.effectiveTo} (${ruleText(t.effectiveOffsetDays)}).`,
    `Price posted ${post.postedDate}: $${post.price} per gallon (${deps.citation}; file sha256 ${series.sha256.slice(0, 12)}).`,
    line3,
    line4,
    `Billed fuel lines: ${fuel.map((f) => `'${f.ln.description}' $${f.ln.amount}${f.suggested ? ' (suggested fuel line)' : ''}`).join(', ')} = $${billed}.`,
    `Difference: $${billed} - $${expected} = $${centsText(diffC)}.`,
  ];
  const abs = diffC < 0n ? -diffC : diffC;
  if (abs <= lineCents(deps.tolerance)) return { result: { ...base, status: 'within_tolerance', expected, difference: centsText(diffC), calculation: calc }, finding: null };
  let alternative: OResult['alternative'] = null;
  for (const [off, later] of [[-1, false], [-2, false], [-3, false], [1, true]] as const) {
    const o = series.observations[post.index + off];
    if (!o) continue;
    if (expectedFor(oEvaluate(t, o.value).rate) === billedC) { alternative = { postedDate: o.date, price: o.value, weeks: Math.abs(off), later }; break; }
  }
  if (alternative) calc.push(`The billed amount equals the table result for the price posted ${alternative.postedDate} ($${alternative.price}), ${alternative.weeks} week(s) ${alternative.later ? 'later' : 'earlier'} than the applicable posting.`);
  const direction = diffC > 0n ? 'overcharge' : 'underbilled';
  const finding: OFinding = {
    rule_id: 'FSC-INDEX-MISMATCH', title: 'Fuel surcharge differs from the fuel table (review)', direction, amount: centsText(abs),
    explanation: `Billed fuel surcharge $${billed} vs $${expected} from fuel table '${plain80(t.name)}' for ship date ${input.shipDate}. Verify the table, the miles and the ship date before disputing.`,
    calculation: calc, confidence: 0.7, needs_human_review: true,
  };
  return { result: { ...base, status: 'finding', expected, difference: centsText(diffC), direction, alternative, calculation: calc }, finding };
}

/** `plain(name, 80)` for the plain ASCII names the oracle generates (identity; longer names are not generated). */
function plain80(s: string): string {
  if (!/^[ -~]{1,80}$/.test(s) || s !== s.trim()) throw new RangeError('oracle only supports trimmed printable ASCII names <= 80');
  return s;
}
