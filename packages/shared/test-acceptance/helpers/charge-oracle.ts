// REQ-20261011-charge-intelligence: test-owned oracle for Part C C3 (features, similarity, suggestions) and C11
// (leave-one-carrier-out evaluation). Written from the C3/C11 text only; it does not import the product's
// classifier. Ranking and the threshold use exact BigInt arithmetic; the reported similarity is one IEEE double
// division of the exact integers, rounded with Math.round(x * 1000) / 1000 (C3).
// Pure (no imports) so it also runs under `node --experimental-strip-types` for cross-checks.

export type Cat = 'detention' | 'linehaul' | 'fuel' | 'accessorial' | 'other';
export interface SeedEntry { text: string; label: Cat | string; source: string }
export interface TenantLabel { id: string; description: string; category: Cat | string }
export interface OExample {
  text: string; category: string; origin: 'seed' | 'tenant'; source: string | null; labelId: string | null;
  norm: string; f: Map<string, number>; n2: bigint; seedIndex: number;
}
export interface ONearest { text: string; category: string; origin: 'seed' | 'tenant'; source: string | null; sourceLabel: string; labelId: string | null }
export interface OSuggestion { category: string | null; similarity: number; abstained: boolean; reason: null | 'empty' | 'no_match' | 'below_threshold'; nearest: ONearest | null }

export const TENANT_SOURCE_LABEL = "Your team's label";

export function oNormText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^ +| +$/g, '');
}

/** C3 (fix round 1): the first 200 characters of normText, with a trailing space removed. */
export const O_QUERY_TEXT_MAX = 200;
export const oFeatureText = (s: string): string => oNormText(s).slice(0, O_QUERY_TEXT_MAX).replace(/ $/, '');

export function oFeatures(s: string): Map<string, number> {
  const n = oFeatureText(s);
  const m = new Map<string, number>();
  if (n === '') return m;
  const p = ` ${n} `;
  for (let k = 3; k <= 5; k++) for (let i = 0; i + k <= p.length; i++) { const g = p.slice(i, i + k); m.set(g, (m.get(g) ?? 0) + 1); }
  for (const w of n.split(' ')) { const key = `w:${w}`; m.set(key, (m.get(key) ?? 0) + 2); }
  return m;
}
export const oNorm2 = (f: Map<string, number>): bigint => { let s = 0n; for (const v of f.values()) s += BigInt(v) * BigInt(v); return s; };
export function oDot(a: Map<string, number>, b: Map<string, number>): bigint {
  const [x, y] = a.size <= b.size ? [a, b] : [b, a];
  let s = 0n;
  for (const [k, v] of x) { const w = y.get(k); if (w !== undefined) s += BigInt(v) * BigInt(w); }
  return s;
}
export const oRound3 = (x: number): number => Math.round(x * 1000) / 1000;
export const oSim = (dot: bigint, q2: bigint, e2: bigint): number => (dot === 0n ? 0 : Number(dot) / Math.sqrt(Number(q2 * e2)));

/** C3 example order: tenant labels by normalized text (code-unit order), then the seed minus overridden names. */
export function oExamples(seed: readonly SeedEntry[], labels: readonly TenantLabel[] = []): OExample[] {
  const t = labels.map((l) => ({ l, norm: oNormText(l.description) })).sort((a, b) => (a.norm < b.norm ? -1 : a.norm > b.norm ? 1 : 0));
  const tn = new Set(t.map((x) => x.norm));
  const out: OExample[] = t.map(({ l, norm }) => {
    const f = oFeatures(l.description);
    return { text: l.description, category: l.category, origin: 'tenant', source: null, labelId: l.id, norm, f, n2: oNorm2(f), seedIndex: -1 };
  });
  seed.forEach((e, i) => {
    const norm = oNormText(e.text);
    if (tn.has(norm)) return;
    const f = oFeatures(e.text);
    out.push({ text: e.text, category: e.label, origin: 'seed', source: e.source, labelId: null, norm, f, n2: oNorm2(f), seedIndex: i });
  });
  return out;
}

export interface ORaw { ex: OExample | null; dot: bigint; q2: bigint; empty: boolean }
/** Nearest example by exact integer comparison; earlier example wins ties. */
export function oNearestRaw(examples: readonly OExample[], q: string): ORaw {
  const qf = oFeatures(q);
  const q2 = oNorm2(qf);
  if (qf.size === 0) return { ex: null, dot: 0n, q2, empty: true };
  let best: OExample | null = null;
  let bd = 0n;
  for (const e of examples) {
    const d = oDot(qf, e.f);
    if (d <= 0n) continue;
    if (best === null || d * d * best.n2 > bd * bd * e.n2) { best = e; bd = d; }
  }
  return { ex: best, dot: bd, q2, empty: false };
}
export const oAccepted = (r: ORaw): boolean => r.ex !== null && 100n * r.dot * r.dot >= 9n * r.q2 * r.ex.n2;

export function oSuggest(examples: readonly OExample[], q: string, sourceLabels: Record<string, { label: string }>): OSuggestion {
  const r = oNearestRaw(examples, q);
  if (r.empty) return { category: null, similarity: 0, abstained: true, reason: 'empty', nearest: null };
  if (r.ex === null) return { category: null, similarity: 0, abstained: true, reason: 'no_match', nearest: null };
  const e = r.ex;
  const nearest: ONearest = {
    text: e.text, category: e.category, origin: e.origin, source: e.source,
    sourceLabel: e.origin === 'seed' ? (sourceLabels[e.source as string]?.label ?? `??${e.source}`) : TENANT_SOURCE_LABEL, labelId: e.labelId,
  };
  const similarity = oRound3(oSim(r.dot, r.q2, e.n2));
  return oAccepted(r)
    ? { category: e.category, similarity, abstained: false, reason: null, nearest }
    : { category: null, similarity, abstained: true, reason: 'below_threshold', nearest };
}

/** Raw similarity (unrounded) between a query and its nearest example, for the eval error list. */
export const oSimOf = (r: ORaw): number => (r.ex === null ? 0 : oSim(r.dot, r.q2, r.ex.n2));

const CATS4 = ['detention', 'linehaul', 'fuel', 'accessorial'] as const;
export interface OPerCarrier { source: string; label: string; examples: number; top1Correct: number; accessorialTotal: number; accessorialTop1: number; accessorialRecognised: number; abstained: number; wrongSuggested: number }
export interface OError { text: string; source: string; expected: string; predicted: string | null; similarity: number; nearestText: string | null; nearestSource: string | null; suggested: boolean }
function must<T>(v: T | undefined, what: string): T { if (v === undefined) throw new Error(`oracle: unknown key ${what}`); return v; }

/** C11 leave-one-carrier-out report fields (everything except the constant header fields). */
export function oLoco(seed: readonly SeedEntry[], sourceOrder: readonly string[], sourceLabels: Record<string, { label: string }>, keyword: (t: string) => string) {
  const ex = oExamples(seed);
  const top1 = { correct: 0, total: 0, byCategory: Object.fromEntries(CATS4.map((c) => [c, { correct: 0, total: 0 }])) as Record<string, { correct: number; total: number }> };
  const at = { suggested: 0, correct: 0, wrong: 0, abstained: 0, byCategory: Object.fromEntries(CATS4.map((c) => [c, { recognised: 0, abstained: 0, wrong: 0, total: 0 }])) as Record<string, { recognised: number; abstained: number; wrong: number; total: number }> };
  const dn = { top1Correct: 0, suggested: 0, correct: 0, wrong: 0, abstained: 0, accessorialRecognised: 0 };
  const kw = { correct: 0, accessorialRecognised: 0 };
  let pipe = 0;
  const per = new Map<string, OPerCarrier>(sourceOrder.map((s) => [s, { source: s, label: sourceLabels[s]?.label ?? `??${s}`, examples: 0, top1Correct: 0, accessorialTotal: 0, accessorialTop1: 0, accessorialRecognised: 0, abstained: 0, wrongSuggested: 0 }]));
  const errors: OError[] = [];
  seed.forEach((e, i) => {
    const cands = ex.filter((x) => x.source !== e.source);
    const r = oNearestRaw(cands, e.text);
    const predicted = r.ex?.category ?? null;
    const ok = predicted === e.label;
    const sug = oAccepted(r);
    const tc = must(top1.byCategory[e.label], e.label);
    top1.total++; tc.total++;
    if (ok) { top1.correct++; tc.correct++; }
    const bc = must(at.byCategory[e.label], e.label); bc.total++;
    if (sug) { at.suggested++; if (ok) { at.correct++; bc.recognised++; } else { at.wrong++; bc.wrong++; } } else { at.abstained++; bc.abstained++; }
    // distinct-name variant
    const qn = oNormText(e.text);
    const r2 = oNearestRaw(cands.filter((x) => x.norm !== qn), e.text);
    const ok2 = (r2.ex?.category ?? null) === e.label;
    const sug2 = oAccepted(r2);
    if (ok2) dn.top1Correct++;
    if (sug2) { dn.suggested++; if (ok2) { dn.correct++; if (e.label === 'accessorial') dn.accessorialRecognised++; } else dn.wrong++; } else dn.abstained++;
    const k = keyword(e.text);
    if (k === e.label) kw.correct++;
    if (e.label === 'accessorial' && k === 'accessorial') kw.accessorialRecognised++;
    if (e.label === 'accessorial' && (k === 'accessorial' || (k === 'other' && sug && predicted === 'accessorial'))) pipe++;
    const pc = must(per.get(e.source), e.source);
    pc.examples++;
    if (ok) pc.top1Correct++;
    if (e.label === 'accessorial') { pc.accessorialTotal++; if (ok) pc.accessorialTop1++; if (sug && ok) pc.accessorialRecognised++; }
    if (!sug) pc.abstained++;
    if (sug && !ok) pc.wrongSuggested++;
    if (!ok) errors.push({ text: e.text, source: e.source, expected: e.label, predicted, similarity: oRound3(oSimOf(r)), nearestText: r.ex?.text ?? null, nearestSource: r.ex?.source ?? null, suggested: sug });
    void i;
  });
  return { examples: seed.length, carriers: new Set(seed.map((e) => e.source)).size, top1, atThreshold: at, distinctName: dn, keywordBaseline: kw, pipelineAccessorialCovered: pipe, perCarrier: [...per.values()], errors };
}

// ---- C12 tariff detention oracle (independent; integer cents, half-even) ----
export interface OTerms { freeMinutes: number; incrementMinutes: number; rounding: 'down' | 'up'; ratePerIncrement: string; minimumCharge: string | null; maximumCharge: string | null }
/** Decimal text (^[0-9]+(\.[0-9]{1,6})?$) -> [integer micro-units]. */
export const oMicros = (d: string): bigint => { const [a = '0', b = ''] = d.split('.'); return BigInt(a) * 1_000_000n + BigInt((b + '000000').slice(0, 6)); };
/** Half-even round of micro-units to cents. */
export function oCentsHalfEven(micros: bigint): bigint {
  const q = micros / 10_000n; const r = micros % 10_000n;
  if (r > 5_000n || (r === 5_000n && q % 2n === 1n)) return q + 1n;
  return q;
}
export const oCentsText = (c: bigint): string => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
export function oTariff(startIso: string, depIso: string, t: OTerms): { increments: number; billableMinutes: number; amount: string; minimumApplied: boolean; maximumApplied: boolean } {
  const sec = (s: string) => Date.parse(`${s}Z`) / 1000;
  const over = sec(depIso) - sec(startIso) - 60 * t.freeMinutes;
  const zero = { increments: 0, billableMinutes: 0, amount: '0.00', minimumApplied: false, maximumApplied: false };
  if (over <= 0) return zero;
  const unit = 60 * t.incrementMinutes;
  const n = t.rounding === 'down' ? Math.floor(over / unit) : Math.ceil(over / unit);
  if (n === 0) return zero;
  let a = oCentsHalfEven(BigInt(n) * oMicros(t.ratePerIncrement));
  let minimumApplied = false; let maximumApplied = false;
  if (t.minimumCharge !== null && a < oCentsHalfEven(oMicros(t.minimumCharge))) { a = oCentsHalfEven(oMicros(t.minimumCharge)); minimumApplied = true; }
  if (t.maximumCharge !== null && a > oCentsHalfEven(oMicros(t.maximumCharge))) { a = oCentsHalfEven(oMicros(t.maximumCharge)); maximumApplied = true; }
  return { increments: n, billableMinutes: n * t.incrementMinutes, amount: oCentsText(a), minimumApplied, maximumApplied };
}

/** Deterministic PRNG (mulberry32) for recorded-seed corpora. */
export function oRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Pinned digest of the C2 seed (text, label, source of the 175 entries in order) computed from
 * `<run dir>/data/seed-charge-names-6carriers.json` (file sha256 29126034cfb9...225f). The data file itself is not
 * copied into the repo; when `CHARGE_SEED_JSON` points at it the tests also compare entry by entry.
 */
export const SEED_DIGEST_SHA256 = 'a0154b6e08afd139cf48f0ed5d9746f055acb05e24883afe4cdbc68e96150d2c';
export const seedDigestInput = (seed: readonly SeedEntry[]): string => JSON.stringify(seed.map((e) => [e.text, e.label, e.source]));
