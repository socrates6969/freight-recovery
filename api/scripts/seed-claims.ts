/**
 * Deterministic synthetic claim generator for the seed (C7). Pure: same output for the same PRNG seed.
 * No person data anywhere (no drivers, phones, plates). Rule ids mirror the Python rules package.
 */
import { packetTotals } from '../src/claims/content-hash.js';

export const PRNG_SEED = 20261008;

export type SeedStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SEND_READY';

export interface SeedSource {
  ordinal: number;
  filename: string;
  docType: 'INVOICE' | 'RATE_CONFIRMATION' | 'BILL_OF_LADING' | 'OTHER';
  sha256: string;
  sizeBytes: number;
}

export interface SeedFinding {
  ordinal: number;
  ruleId: string;
  title: string;
  direction: 'OVERCHARGE' | 'UNDERBILLED';
  amountCents: number;
  explanation: string;
  calculation: string[];
  confidence: number;
  needsHumanReview: boolean;
  citations: { sourceOrdinal: number; locator: string; excerpt: string }[];
  clause: { sourceOrdinal: number; label: string; locator: string; excerpt: string } | null;
}

export interface SeedClaim {
  claimNumber: string;
  loadNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  carrierName: string;
  shipperName: string;
  perspective: 'SHIPPER' | 'CARRIER';
  status: SeedStatus;
  generatedAt: string;
  createdAt: string;
  verifierStatus: 'NOT_RUN' | 'PASSED' | 'FAILED' | 'NEEDS_REVIEW';
  verifierNote: string | null;
  disclaimer: string;
  demandLetter: string;
  sources: SeedSource[];
  timeline: { ordinal: number; occurredAt: string; kind: string; label: string; sourceOrdinal: number | null }[];
  findings: SeedFinding[];
  recoverableCents: number;
  pendingReviewCents: number;
  amountClaimedCents: number;
}

export const DISCLAIMER =
  'MVP / pre-product output. Extracted values and calculations are unverified against real customer data and must be reviewed by a person before any dispute is sent. This is not legal or financial advice.';

/** mulberry32: tiny deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CARRIERS = [
  'Northwind Haulage Co',
  'Blue Ridge Transport',
  'Lakeshore Carriers',
  'Summit Line Logistics',
  'Prairie Express Freight',
  'Harbor Point Trucking',
  'Cascade Freight Co',
  'Ironwood Linehaul',
];
const SHIPPERS = ['Widget Co', 'Globex Components', 'Initrode Supply', 'Vandelay Packaging', 'Kestrel Industrial Parts', 'Brightwater Distribution'];

function dollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

interface RuleTemplate {
  ruleId: string;
  title: string;
  direction: 'OVERCHARGE' | 'UNDERBILLED';
  perspective: 'SHIPPER' | 'CARRIER';
  make: (rnd: () => number) => { amountCents: number; explanation: string; calculation: string[]; citation: SeedFinding['citations'][number]; clause: NonNullable<SeedFinding['clause']> };
}

const RULES: RuleTemplate[] = [
  {
    ruleId: 'INV-LINEHAUL-RATE',
    title: 'Linehaul billed above rate confirmation',
    direction: 'OVERCHARGE',
    perspective: 'SHIPPER',
    make: (rnd) => {
      const agreed = 120000 + Math.floor(rnd() * 80) * 1000;
      const over = 5000 + Math.floor(rnd() * 30) * 500;
      return {
        amountCents: over,
        explanation: `Invoice linehaul ${dollars(agreed + over)} vs agreed ${dollars(agreed)}.`,
        calculation: [`${dollars(agreed + over)} - ${dollars(agreed)} = ${dollars(over)}.`],
        citation: { sourceOrdinal: 1, locator: 'invoice.txt:L7', excerpt: `Charge: Linehaul | ${(agreed + over) / 100}` },
        clause: { sourceOrdinal: 2, label: 'Contracted linehaul rate', locator: 'rate_confirmation.txt:L4', excerpt: `Linehaul Rate: ${agreed / 100}` },
      };
    },
  },
  {
    ruleId: 'INV-FUEL-SURCHARGE',
    title: 'Fuel surcharge billed above agreed amount',
    direction: 'OVERCHARGE',
    perspective: 'SHIPPER',
    make: (rnd) => {
      const agreed = 12000 + Math.floor(rnd() * 60) * 100;
      const over = 1500 + Math.floor(rnd() * 40) * 100;
      return {
        amountCents: over,
        explanation: `Invoice fuel surcharge ${dollars(agreed + over)} vs agreed ${dollars(agreed)}.`,
        calculation: [`${dollars(agreed + over)} - ${dollars(agreed)} = ${dollars(over)}.`],
        citation: { sourceOrdinal: 1, locator: 'invoice.txt:L8', excerpt: `Charge: Fuel Surcharge | ${(agreed + over) / 100}` },
        clause: { sourceOrdinal: 2, label: 'Agreed fuel surcharge', locator: 'rate_confirmation.txt:L5', excerpt: `Fuel Surcharge: ${agreed / 100}` },
      };
    },
  },
  {
    ruleId: 'INV-ACCESSORIAL-UNAUTH',
    title: 'Accessorial not authorized on rate confirmation',
    direction: 'OVERCHARGE',
    perspective: 'SHIPPER',
    make: (rnd) => {
      const amt = 7500 + Math.floor(rnd() * 20) * 500;
      const name = rnd() < 0.5 ? 'Lumper' : 'Liftgate';
      return {
        amountCents: amt,
        explanation: `'${name}' (${dollars(amt)}) is not listed as authorized on the rate confirmation.`,
        calculation: ["Authorized accessorials: ['Detention'].", `Charged: '${name}' = ${dollars(amt)}.`],
        citation: { sourceOrdinal: 1, locator: 'invoice.txt:L10', excerpt: `Charge: ${name} | ${amt / 100}` },
        clause: { sourceOrdinal: 2, label: 'Authorized accessorials', locator: 'rate_confirmation.txt:L9', excerpt: 'Authorized Accessorials: Detention' },
      };
    },
  },
  {
    ruleId: 'INV-DUPLICATE',
    title: 'Invoice appears to duplicate a prior invoice',
    direction: 'OVERCHARGE',
    perspective: 'SHIPPER',
    make: (rnd) => {
      const amt = 90000 + Math.floor(rnd() * 60) * 1000;
      return {
        amountCents: amt,
        explanation: `Same load, amount ${dollars(amt)} and charge lines as an earlier invoice.`,
        calculation: ['Matched load number, total and line items against the prior invoice.', `Duplicate amount = ${dollars(amt)}.`],
        citation: { sourceOrdinal: 1, locator: 'invoice.txt:L2', excerpt: 'Invoice Number: (duplicate of earlier invoice)' },
        clause: { sourceOrdinal: 2, label: 'One invoice per load', locator: 'rate_confirmation.txt:L2', excerpt: 'Load Number: (single movement)' },
      };
    },
  },
  {
    ruleId: 'INV-TOTAL-MISMATCH',
    title: 'Invoice total does not match the sum of charges',
    direction: 'OVERCHARGE',
    perspective: 'SHIPPER',
    make: (rnd) => {
      const diff = 1000 + Math.floor(rnd() * 50) * 100;
      return {
        amountCents: diff,
        explanation: `Stated total exceeds the sum of charge lines by ${dollars(diff)}.`,
        calculation: ['Summed all charge lines.', `Stated total - sum of lines = ${dollars(diff)}.`],
        citation: { sourceOrdinal: 1, locator: 'invoice.txt:L11', excerpt: 'Total: (stated total)' },
        clause: { sourceOrdinal: 2, label: 'Agreed charges', locator: 'rate_confirmation.txt:L4', excerpt: 'Linehaul Rate: (agreed)' },
      };
    },
  },
  {
    ruleId: 'DET-OVERBILLED',
    title: 'Detention billed above supported amount',
    direction: 'OVERCHARGE',
    perspective: 'SHIPPER',
    make: (rnd) => {
      const billed = 20000 + Math.floor(rnd() * 20) * 2500;
      const earned = Math.floor(rnd() * 6) * 2500;
      return {
        amountCents: billed - earned,
        explanation: `Invoice billed ${dollars(billed)} detention; gate times and rate-con terms support only ${dollars(earned)}.`,
        calculation: ['Dwell computed from gate times on the bill of lading.', 'Less 2 h free time.', `Earned = ${dollars(earned)}; invoiced = ${dollars(billed)}.`],
        citation: { sourceOrdinal: 1, locator: 'invoice.txt:L9', excerpt: `Charge: Detention | ${billed / 100}` },
        clause: { sourceOrdinal: 2, label: 'Detention free time', locator: 'rate_confirmation.txt:L6', excerpt: 'Detention Free Hours: 2' },
      };
    },
  },
  {
    ruleId: 'DET-UNBILLED',
    title: 'Detention earned but not billed',
    direction: 'UNDERBILLED',
    perspective: 'CARRIER',
    make: (rnd) => {
      const quarters = 4 + Math.floor(rnd() * 16);
      const amt = quarters * 1250;
      return {
        amountCents: amt,
        explanation: `Gate times and rate-con terms support ${dollars(amt)} of detention; $0 was billed.`,
        calculation: [`Billable time after 2 h free = ${quarters * 15} min.`, `${(quarters / 4).toFixed(2)} h x $50.00/h = ${dollars(amt)}.`],
        citation: { sourceOrdinal: 3, locator: 'bol.txt:L6', excerpt: 'Departure Time: (gate out)' },
        clause: { sourceOrdinal: 2, label: 'Detention rate', locator: 'rate_confirmation.txt:L7', excerpt: 'Detention Rate Per Hour: 50.00' },
      };
    },
  },
  {
    ruleId: 'DET-UNDERBILLED',
    title: 'Detention billed below supported amount',
    direction: 'UNDERBILLED',
    perspective: 'CARRIER',
    make: (rnd) => {
      const quarters = 2 + Math.floor(rnd() * 10);
      const amt = quarters * 1250;
      return {
        amountCents: amt,
        explanation: `Detention billed ${dollars(5000)} but gate times support ${dollars(5000 + amt)}.`,
        calculation: ['Dwell computed from gate times.', `Shortfall = ${dollars(amt)}.`],
        citation: { sourceOrdinal: 1, locator: 'invoice.txt:L9', excerpt: 'Charge: Detention | 50.00' },
        clause: { sourceOrdinal: 2, label: 'Detention rate', locator: 'rate_confirmation.txt:L7', excerpt: 'Detention Rate Per Hour: 50.00' },
      };
    },
  },
];

function pick<T>(rnd: () => number, xs: readonly T[]): T {
  const x = xs[Math.floor(rnd() * xs.length)];
  if (x === undefined) throw new Error('empty list');
  return x;
}

function hex64(rnd: () => number): string {
  let s = '';
  for (let i = 0; i < 64; i += 1) s += Math.floor(rnd() * 16).toString(16);
  return s;
}

function iso(d: Date): string {
  return d.toISOString();
}

function letterFor(c: { carrierName: string; shipperName: string; loadNumber: string | null; invoiceNumber: string | null }, findings: SeedFinding[], recoverable: number): string {
  const lines = findings
    .filter((f) => !f.needsHumanReview)
    .map((f, i) => `${i + 1}. ${f.title}: ${dollars(f.amountCents)}\n   ${f.explanation}`);
  return [
    'DRAFT - FOR HUMAN REVIEW. NOT SENT. NOT LEGAL ADVICE.',
    '',
    `To: ${c.carrierName}`,
    `From: ${c.shipperName}`,
    `Re: Load ${c.loadNumber ?? 'N/A'} / Invoice ${c.invoiceNumber ?? 'N/A'} - billing review`,
    '',
    'Our audit found the following items:',
    '',
    ...(lines.length > 0 ? lines : ['(No confirmed discrepancies.)']),
    '',
    `Total requested: ${dollars(recoverable)}.`,
    '',
    'Sincerely,',
    '[Name / Title / Contact - to be completed by sender]',
  ].join('\n');
}

interface GenOptions {
  claimNumber: string;
  status: SeedStatus;
  index: number;
  rnd: () => number;
  pendingFinding: boolean;
  shipperOnly?: boolean;
}

export function generateClaim(o: GenOptions): SeedClaim {
  const { rnd } = o;
  const perspective: 'SHIPPER' | 'CARRIER' = o.shipperOnly || o.pendingFinding || rnd() < 0.75 ? 'SHIPPER' : 'CARRIER';
  const rules = RULES.filter((r) => r.perspective === perspective);
  const n = 1 + Math.floor(rnd() * Math.min(4, rules.length));
  const chosen: RuleTemplate[] = [];
  while (chosen.length < n) {
    const r = pick(rnd, rules);
    if (!chosen.includes(r)) chosen.push(r);
  }
  const loadNumber = `LD-${6000 + o.index * 7}`;
  const invoiceNumber = `INV-${3000 + o.index * 13}`;
  const base = new Date(Date.UTC(2026, 6, 1 + o.index * 2, 8, 0, 0));
  const invoiceDate = new Date(base.getTime() + 7 * 86400000);
  const findings: SeedFinding[] = chosen.map((r, i) => {
    const m = r.make(rnd);
    return {
      ordinal: i + 1,
      ruleId: r.ruleId,
      title: r.title,
      direction: r.direction,
      amountCents: m.amountCents,
      explanation: m.explanation,
      calculation: m.calculation,
      confidence: Math.round((0.7 + rnd() * 0.29) * 1000) / 1000,
      needsHumanReview: false,
      citations: [m.citation],
      clause: m.clause,
    };
  });
  if (o.pendingFinding) {
    const first = findings[0];
    if (first) {
      first.needsHumanReview = true;
      first.confidence = 0.6;
    }
  }
  const totals = packetTotals(findings);
  const carrierName = pick(rnd, CARRIERS);
  const shipperName = pick(rnd, SHIPPERS);
  const arrivalOffsetMin = Math.floor(rnd() * 40) - 20;
  const dwellMin = 120 + Math.floor(rnd() * 240);
  const arrival = new Date(base.getTime() + arrivalOffsetMin * 60000);
  const departure = new Date(arrival.getTime() + dwellMin * 60000);
  const createdAt = new Date(Date.UTC(2026, 8, 1, 9, 0, 0) + o.index * 3600000 * 7);
  return {
    claimNumber: o.claimNumber,
    loadNumber,
    invoiceNumber,
    invoiceDate: iso(invoiceDate),
    carrierName,
    shipperName,
    perspective,
    status: o.status,
    generatedAt: iso(new Date(createdAt.getTime() - 3600000)),
    createdAt: iso(createdAt),
    verifierStatus: 'NOT_RUN',
    verifierNote: null,
    disclaimer: DISCLAIMER,
    demandLetter: letterFor({ carrierName, shipperName, loadNumber, invoiceNumber }, findings, totals.recoverableCents),
    sources: [
      { ordinal: 1, filename: 'invoice.txt', docType: 'INVOICE', sha256: hex64(rnd), sizeBytes: 200 + Math.floor(rnd() * 200) },
      { ordinal: 2, filename: 'rate_confirmation.txt', docType: 'RATE_CONFIRMATION', sha256: hex64(rnd), sizeBytes: 180 + Math.floor(rnd() * 120) },
      { ordinal: 3, filename: 'bol.txt', docType: 'BILL_OF_LADING', sha256: hex64(rnd), sizeBytes: 150 + Math.floor(rnd() * 80) },
    ],
    timeline: [
      { ordinal: 1, occurredAt: iso(base), kind: 'APPOINTMENT', label: 'Appointment time', sourceOrdinal: 3 },
      { ordinal: 2, occurredAt: iso(arrival), kind: 'ARRIVAL', label: 'Arrived at facility', sourceOrdinal: 3 },
      { ordinal: 3, occurredAt: iso(departure), kind: 'DEPARTURE', label: 'Departed facility', sourceOrdinal: 3 },
      { ordinal: 4, occurredAt: iso(invoiceDate), kind: 'INVOICE', label: `Invoice ${invoiceNumber} issued`, sourceOrdinal: 1 },
    ],
    findings,
    ...totals,
  };
}

/** Attacker-style strings for the hostile claims (rendering safety tests). */
export const HOSTILE = {
  script: '<script>alert("xss")</script>',
  img: '<img src=x onerror=alert(1)>',
  jsUrl: 'javascript:alert(document.cookie)',
  markdown: '[click me](javascript:alert(1)) **bold** <b>html</b>',
  bidi: 'Invoice \u202Egnp.exe\u202C total \u2066isolated\u2069',
  long: `LONG-${'A'.repeat(4995)}`,
};

export function hostileClaim(claimNumber: string, index: number, rnd: () => number): SeedClaim {
  const c = generateClaim({ claimNumber, status: 'PENDING_REVIEW', index, rnd, pendingFinding: false, shipperOnly: true });
  const v = index % 2 === 0;
  c.carrierName = v ? `${HOSTILE.script} Carrier` : `${HOSTILE.bidi}`;
  c.shipperName = v ? HOSTILE.img : `${HOSTILE.markdown}`;
  c.loadNumber = v ? HOSTILE.jsUrl : `LD-<svg/onload=alert(1)>`;
  c.findings = c.findings.map((f, i) => ({
    ...f,
    title: i === 0 ? `${HOSTILE.script}${f.title}` : `${HOSTILE.bidi} ${f.title}`,
    explanation: i === 0 ? `${HOSTILE.markdown} ${HOSTILE.long}` : `${HOSTILE.img} ${f.explanation}`,
    calculation: [...f.calculation, HOSTILE.img],
    citations: f.citations.map((x) => ({ ...x, excerpt: `${HOSTILE.script} ${x.excerpt}` })),
    clause: f.clause ? { ...f.clause, excerpt: `${HOSTILE.jsUrl} ${HOSTILE.bidi}`, label: `<i>${f.clause.label}</i>` } : null,
  }));
  c.sources = c.sources.map((s) => ({ ...s, filename: v ? `<img src=x onerror=alert(1)>${s.filename}` : `..\\..\\${HOSTILE.bidi}.txt` }));
  c.demandLetter = `${HOSTILE.script}\n${HOSTILE.markdown}\n${HOSTILE.bidi}\n${HOSTILE.jsUrl}\n${HOSTILE.long}`;
  return c;
}
