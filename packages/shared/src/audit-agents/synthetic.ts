/**
 * SYNTHETIC evaluation set for the audit-agent team. Every carrier, contract, lane, price and invoice
 * here is invented ("Synthetic Carrier A/B/C", contracts SYN-*, a made-up diesel series). Nothing is
 * customer data. The set is generated from a seed, so the measured numbers are reproducible.
 *
 * Each case is either clean (correctly billed per the synthetic contract) or carries ONE injected
 * overcharge of a known kind and a known dollar amount. Clean cases include hard negatives: a reweigh
 * WITH a certificate, a minimum charge correctly applied, an FAK lane billed at the FAK class, detention
 * earned and billed correctly, approved accessorials, and two stop-offs printed on identical lines.
 */
import { Dec, add, div, gt, lt, mul, q2, sub, sumDec } from '../analysis/py-decimal.js';
import { addDays } from '../fuel/week.js';
import type { FscTableSpec } from '../fuel/table.js';
import type { PriceSeriesData } from '../outlook/constants.js';

import type { FuelContext } from './checks.js';
import type { IntakeInput } from './intake.js';
import { runAuditTeam, type AuditCase, type TeamOptions } from './orchestrator.js';
import type { Contract, NormalizedInvoice, NormalizedLine, ShipmentEvidence } from './types.js';

export const INJECTION_KINDS = [
  'duplicate_invoice',
  'fsc_wrong_base',
  'unauthorized_detention',
  'reweigh_no_evidence',
  'rate_above_contract',
  'arithmetic_error',
  'fsc_wrong_week',
  'unauthorized_accessorial',
  'class_error',
] as const;
export type InjectionKind = (typeof INJECTION_KINDS)[number];

/** Rule ids that correctly explain each injected kind (a consequential fuel overcharge is part of it). */
export const RULES_BY_KIND: Readonly<Record<InjectionKind, readonly string[]>> = {
  duplicate_invoice: ['AUD-DUP-INVOICE'],
  fsc_wrong_base: ['AUD-FSC-BASE'],
  unauthorized_detention: ['DET-OVERBILLED', 'AUD-ACC-UNAUTH'],
  reweigh_no_evidence: ['AUD-REWEIGH', 'AUD-FSC-ON-OVERCHARGE'],
  rate_above_contract: ['INV-LINEHAUL-RATE', 'AUD-LTL-RATE', 'AUD-FSC-ON-OVERCHARGE'],
  arithmetic_error: ['INV-TOTAL-MISMATCH', 'AUD-LINE-MATH'],
  fsc_wrong_week: ['AUD-FSC-WRONG-WEEK'],
  unauthorized_accessorial: ['AUD-ACC-UNAUTH'],
  class_error: ['AUD-CLASS', 'AUD-FSC-ON-OVERCHARGE'],
};

export interface SyntheticCase {
  id: string;
  /** null: clean invoice. */
  injected: InjectionKind | null;
  /** Dollars the injected overcharge adds (exact), `0.00` for clean cases. */
  expectedRecovery: string;
  note: string;
  auditCase: AuditCase;
}

const D = (s: string): Dec => Dec.parse(s);
const S = (x: Dec): string => q2(x).toString();
const pct = (p: string, base: Dec): Dec => q2(div(mul(D(p), base), Dec.fromInt(100)));
const AS_OF = '2026-10-22';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DETENTION = { freeHours: '2', ratePerHour: '60.00', maxHours: '8', clause: 'SYN-A s.6 Detention: 2 free hours, $60.00/h, max 8 h' };

export const SYN_CONTRACTS: readonly Contract[] = [
  {
    id: 'SYN-A-2026',
    carrier: 'Synthetic Carrier A',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    lanes: [
      ['A-L1', 'Dallas TX', 'Memphis TN', '1450.00'],
      ['A-L2', 'Atlanta GA', 'Charlotte NC', '980.00'],
      ['A-L3', 'Phoenix AZ', 'Denver CO', '2210.00'],
      ['A-L4', 'Houston TX', 'Kansas City MO', '1760.00'],
    ].map(([id, o, d, lh]) => ({ id: id ?? '', origin: o ?? '', destination: d ?? '', mode: 'TL' as const, linehaul: lh ?? null, ratePerCwt: null, fakClass: null, minimumCharge: null, clause: `SYN-A Schedule 1 lane ${id ?? ''}` })),
    fuel: { type: 'percent', percent: '18', clause: 'SYN-A s.4 Fuel: 18% of linehaul' },
    accessorials: [
      { code: 'LUMPER', names: ['lumper'], maxAmount: '250.00', requiresAuthorization: true, clause: 'SYN-A s.7.1 Lumper: prior approval and receipt, max $250' },
      { code: 'STOPOFF', names: ['stop off', 'stop-off'], maxAmount: '100.00', requiresAuthorization: false, clause: 'SYN-A s.7.2 Stop-off: max $100 per stop' },
      { code: 'DRIVERASSIST', names: ['driver assist'], maxAmount: '150.00', requiresAuthorization: true, clause: 'SYN-A s.7.3 Driver assist: prior approval, max $150' },
    ],
    detention: DETENTION,
    reweighRequiresCertificate: false,
    claimWindowDays: 180,
  },
  {
    id: 'SYN-B-2026',
    carrier: 'Synthetic Carrier B',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    lanes: [
      ['B-L1', 'Chicago IL', 'Columbus OH', null],
      ['B-L2', 'Chicago IL', 'Detroit MI', '70'],
      ['B-L3', 'Indianapolis IN', 'St Louis MO', null],
      ['B-L4', 'Milwaukee WI', 'Minneapolis MN', '70'],
    ].map(([id, o, d, fak]) => ({
      id: id ?? '',
      origin: o ?? '',
      destination: d ?? '',
      mode: 'LTL' as const,
      linehaul: null,
      ratePerCwt: { '50': '18.40', '70': '22.60', '85': '26.90', '100': '31.20' },
      fakClass: fak ?? null,
      minimumCharge: '185.00',
      clause: `SYN-B Tariff 2 lane ${id ?? ''}${fak === null ? '' : ' (FAK 70)'}`,
    })),
    fuel: { type: 'percent', percent: '25', clause: 'SYN-B s.3 Fuel: 25% of linehaul' },
    accessorials: [
      { code: 'LIFTGATE', names: ['liftgate'], maxAmount: '95.00', requiresAuthorization: false, clause: 'SYN-B s.9 Liftgate: max $95' },
      { code: 'RESIDENTIAL', names: ['residential'], maxAmount: '120.00', requiresAuthorization: false, clause: 'SYN-B s.9 Residential: max $120' },
      { code: 'INSIDE', names: ['inside delivery'], maxAmount: '140.00', requiresAuthorization: true, clause: 'SYN-B s.9 Inside delivery: prior approval, max $140' },
    ],
    detention: null,
    reweighRequiresCertificate: true,
    claimWindowDays: 180,
  },
  {
    id: 'SYN-C-2026',
    carrier: 'Synthetic Carrier C',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    lanes: [
      ['C-L1', 'Reno NV', 'Boise ID', '1320.00'],
      ['C-L2', 'Omaha NE', 'Tulsa OK', '1180.00'],
    ].map(([id, o, d, lh]) => ({ id: id ?? '', origin: o ?? '', destination: d ?? '', mode: 'TL' as const, linehaul: lh ?? null, ratePerCwt: null, fakClass: null, minimumCharge: null, clause: `SYN-C Schedule A lane ${id ?? ''}` })),
    fuel: { type: 'table', tableId: 'SYN-FSC-1', clause: 'SYN-C s.5 Fuel: per-mile table SYN-FSC-1 on the weekly diesel index' },
    accessorials: [{ code: 'STOPOFF', names: ['stop off', 'stop-off'], maxAmount: '100.00', requiresAuthorization: false, clause: 'SYN-C s.8 Stop-off: max $100' }],
    detention: { ...DETENTION, clause: 'SYN-C s.6 Detention: 2 free hours, $60.00/h, max 8 h' },
    reweighRequiresCertificate: false,
    claimWindowDays: 180,
  },
];

const MILES: Readonly<Record<string, string>> = { 'C-L1': '430', 'C-L2': '390' };

export const SYN_FUEL_TABLE: FscTableSpec = {
  id: 'SYN-FSC-1',
  name: 'Synthetic per-mile step table',
  version: 1,
  kind: 'step',
  unit: 'per_mile',
  priceSeries: 'diesel_us',
  effectiveOffsetDays: 0,
  params: { basePrice: '1.25', stepSize: '0.05', ratePerStep: '0.01', bracket: 'above_base' },
  archived: false,
};

/** A made-up weekly diesel series (Mondays of 2026), NOT the public index. */
export const SYN_DIESEL: PriceSeriesData = {
  key: 'diesel_us',
  importId: 'synthetic',
  sha256: '0'.repeat(64),
  sourceUrl: 'synthetic://diesel-us',
  retrievedAt: '2026-10-22T00:00:00Z',
  observations: Array.from({ length: 52 }, (_, i) => {
    const mills = 3500 + ((i * 37) % 11) * 30;
    return { date: addDays('2026-01-05', 7 * i), value: `${Math.floor(mills / 1000)}.${String(mills % 1000).padStart(3, '0')}` };
  }),
};

const FUEL: FuelContext = { table: SYN_FUEL_TABLE, series: SYN_DIESEL };

function tableRate(price: string): Dec {
  // Independent oracle of the step table: ceil((price - 1.25) / 0.05) steps x $0.01.
  const mills = Number(price.replace('.', ''));
  const steps = Math.max(0, Math.ceil((mills - 1250) / 50));
  return D((steps / 100).toFixed(2));
}

function postingIndex(shipDate: string): number {
  let idx = -1;
  SYN_DIESEL.observations.forEach((o, i) => {
    if (o.date <= shipDate) idx = i;
  });
  return idx;
}

interface Built {
  inv: NormalizedInvoice;
  ev: ShipmentEvidence;
}

const line = (description: string, amount: Dec, code: string | null = null, quantity: string | null = null, rate: string | null = null): NormalizedLine => ({ description, amount: S(amount), code, quantity, rate });

function finish(inv: NormalizedInvoice): NormalizedInvoice {
  return { ...inv, total: S(sumDec(inv.lines.map((l) => D(l.amount)))) };
}

class Gen {
  private pro = 700000;
  constructor(private readonly r: () => number) {}
  pick<T>(xs: readonly T[]): T {
    const x = xs[Math.floor(this.r() * xs.length)];
    if (x === undefined) throw new Error('empty pick');
    return x;
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.r() * (hi - lo + 1));
  }
  shipDate(): string {
    return addDays('2026-06-01', this.int(0, 110));
  }
  nextPro(prefix: string): string {
    this.pro += this.int(1, 9);
    return `${prefix}${this.pro}`;
  }
  base(c: Contract, laneId: string, mode: 'TL' | 'LTL'): { inv: NormalizedInvoice; ev: ShipmentEvidence } {
    const lane = c.lanes.find((l) => l.id === laneId);
    if (lane === undefined) throw new Error('lane');
    const ship = this.shipDate();
    const pro = this.nextPro(c.id.slice(4, 5));
    return {
      inv: {
        invoiceNumber: `INV-${pro}`,
        carrier: c.carrier,
        scac: `SYN${c.id.slice(4, 5)}`,
        proNumber: pro,
        loadNumber: `LD-${pro}`,
        bolNumber: `BOL-${pro}`,
        invoiceDate: addDays(ship, 5),
        shipDate: ship,
        origin: lane.origin,
        destination: lane.destination,
        mode,
        miles: MILES[laneId] ?? null,
        billedWeightLbs: null,
        billedClass: null,
        lines: [],
        total: null,
        source: 'fields',
        warnings: [],
      },
      ev: { bolNumber: `BOL-${pro}`, bolWeightLbs: null, bolClass: null, appointmentTime: null, arrivalTime: null, departureTime: null, reweighCertificate: null, authorizedAccessorials: [] },
    };
  }
  /** Clean TL invoice for contract A or C. `opts` force optional features. */
  tl(cIdx: 0 | 2, opts: { detentionHours?: number; accessorial?: boolean; lumper?: boolean; twoStops?: boolean } = {}): Built {
    const c = SYN_CONTRACTS[cIdx] as Contract;
    const lane = this.pick(c.lanes);
    const { inv, ev } = this.base(c, lane.id, 'TL');
    const lh = D(lane.linehaul ?? '0');
    inv.lines.push(line('Linehaul', lh));
    const det = opts.detentionHours ?? (this.r() < 0.4 ? this.int(1, 3) : 0);
    const day = inv.shipDate ?? '';
    ev.appointmentTime = `${day}T08:00:00`;
    ev.arrivalTime = `${day}T07:45:00`;
    ev.departureTime = det > 0 ? `${day}T${String(10 + det).padStart(2, '0')}:00:00` : `${day}T09:30:00`;
    if (det > 0) inv.lines.push(line('Detention', mul(Dec.fromInt(det), D('60.00')), null, String(det), '60.00'));
    if (opts.twoStops === true) {
      inv.lines.push(line('Stop off', D('75.00'), 'STOPOFF'), line('Stop off', D('75.00'), 'STOPOFF'));
    } else if (opts.accessorial === true || this.r() < 0.35) {
      inv.lines.push(line('Stop-off charge', D(this.pick(['75.00', '100.00'])), 'STOPOFF', '1', null));
    }
    if (cIdx === 0 && (opts.lumper === true || (opts.lumper === undefined && this.r() < 0.3))) {
      inv.lines.push(line('Lumper fee', D(this.pick(['150.00', '210.00'])), 'LUMPER'));
      ev.authorizedAccessorials.push('LUMPER');
    }
    if (cIdx === 0) inv.lines.push(line('Fuel surcharge', pct('18', lh)));
    else {
      const p = SYN_DIESEL.observations[postingIndex(day)];
      inv.lines.push(line('Fuel surcharge', q2(mul(D(inv.miles ?? '0'), tableRate(p?.value ?? '0.000')))));
    }
    return { inv: finish(inv), ev };
  }
  /** Clean LTL invoice for contract B. */
  ltl(opts: { nonFak?: boolean; weight?: number; reweighWithCert?: boolean; accessorial?: boolean } = {}): Built {
    const c = SYN_CONTRACTS[1] as Contract;
    const lane = opts.nonFak === true ? this.pick(c.lanes.filter((l) => l.fakClass === null)) : this.pick(c.lanes);
    const { inv, ev } = this.base(c, lane.id, 'LTL');
    const bolClass = this.pick(['50', '70', '85', '100']);
    const rated = lane.fakClass ?? bolClass;
    const R = lane.ratePerCwt?.[rated] ?? '0';
    const w = opts.weight ?? this.int(3, 40) * 100;
    const billedW = opts.reweighWithCert === true ? w + 200 : w;
    ev.bolWeightLbs = String(w);
    ev.bolClass = bolClass;
    if (opts.reweighWithCert === true) ev.reweighCertificate = `RW-${inv.proNumber ?? ''}`;
    inv.billedWeightLbs = String(billedW);
    inv.billedClass = rated;
    const computed = q2(div(mul(D(R), Dec.fromInt(billedW)), Dec.fromInt(100)));
    const lh = lt(computed, D('185.00')) ? D('185.00') : computed;
    inv.lines.push(lh === computed ? line('Linehaul', lh, null, String(billedW / 100), R) : line('Minimum charge', lh));
    if (opts.accessorial === true || this.r() < 0.4) {
      const acc = this.pick([['Liftgate service', '75.00', 'LIFTGATE'], ['Liftgate service', '95.00', 'LIFTGATE'], ['Residential delivery', '120.00', 'RESIDENTIAL']] as const);
      inv.lines.push(line(acc[0], D(acc[1]), acc[2]));
    }
    inv.lines.push(line('Fuel surcharge', pct('25', lh)));
    return { inv: finish(inv), ev };
  }
}

function linehaulOf(inv: NormalizedInvoice): Dec {
  return sumDec(inv.lines.filter((l) => /linehaul|minimum charge/iu.test(l.description)).map((l) => D(l.amount)));
}

function setFuel(inv: NormalizedInvoice, amount: Dec): void {
  inv.lines = inv.lines.map((l) => (l.description === 'Fuel surcharge' ? { ...l, amount: S(amount) } : l));
}

/** Serialise an invoice as the CSV intake format. */
export function toCsv(inv: NormalizedInvoice): string {
  const head = 'invoice_number,carrier,scac,pro,load,bol,invoice_date,ship_date,origin,destination,mode,miles,weight,class,line_description,line_code,line_quantity,line_rate,line_amount,total';
  const q = (v: string | null): string => (v === null ? '' : /[",]/u.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  const rows = inv.lines.map((l) =>
    [inv.invoiceNumber, inv.carrier, inv.scac, inv.proNumber, inv.loadNumber, inv.bolNumber, inv.invoiceDate, inv.shipDate, inv.origin, inv.destination, inv.mode, inv.miles, inv.billedWeightLbs, inv.billedClass, l.description, l.code, l.quantity, l.rate, l.amount, inv.total].map(q).join(','),
  );
  return [head, ...rows].join('\n');
}

/** Serialise an invoice as the EDI 210 subset read by `parseEdi210`. */
export function toEdi210(inv: NormalizedInvoice): string {
  const cents = (v: string): string => q2(D(v)).coef.toString();
  const ymd = (d: string | null): string => (d ?? '').replaceAll('-', '');
  const place = (p: string | null): string[] => {
    const parts = (p ?? '').split(' ');
    return [parts.slice(0, -1).join(' '), parts.at(-1) ?? ''];
  };
  const segs = [
    'ST*210*0001',
    `B3**${inv.invoiceNumber}*${inv.proNumber ?? ''}*PP**${ymd(inv.invoiceDate)}*${cents(inv.total ?? '0')}****${inv.scac ?? ''}`,
    ...(inv.bolNumber === null ? [] : [`N9*BM*${inv.bolNumber}`]),
    ...(inv.loadNumber === null ? [] : [`N9*LO*${inv.loadNumber}`]),
    ...(inv.miles === null ? [] : [`N9*MI*${inv.miles}`]),
    ...(inv.shipDate === null ? [] : [`G62*86*${ymd(inv.shipDate)}`]),
    `N1*CA*${inv.carrier}`,
    `N1*SH*Synthetic Shipper`,
    `N4*${place(inv.origin).join('*')}`,
    `N1*CN*Synthetic Consignee`,
    `N4*${place(inv.destination).join('*')}`,
  ];
  inv.lines.forEach((l, i) => {
    segs.push(`LX*${i + 1}`, `L5*${i + 1}*${l.description}`);
    const perCwt = inv.mode === 'LTL' && l.rate !== null && l.quantity !== null && inv.billedWeightLbs !== null;
    if (perCwt) segs.push(`L0*${i + 1}**FR*${inv.billedWeightLbs ?? ''}*G`);
    else if (l.quantity !== null) segs.push(`L0*${i + 1}*${l.quantity}`);
    if (inv.mode === 'LTL' && inv.billedClass !== null && i === 0) segs.push(`L7*${i + 1}******${inv.billedClass}`);
    segs.push(`L1*${i + 1}*${l.rate ?? ''}*${perCwt ? 'PH' : l.rate === null ? 'FR' : 'PU'}*${cents(l.amount)}****${l.code ?? ''}`);
  });
  segs.push(`L3*${inv.billedWeightLbs ?? ''}*G***${cents(inv.total ?? '0')}`, 'SE*0*0001');
  return `${segs.join('~')}~`;
}

/** Build the synthetic set: `clean` clean cases plus `perKind` cases of each injected kind. */
export function buildSyntheticSet(seed = 20261022, clean = 45, perKind = 10): { cases: SyntheticCase[]; history: NormalizedInvoice[] } {
  const g = new Gen(rng(seed));
  const history: NormalizedInvoice[] = [];
  const priors: Built[] = [];
  for (let i = 0; i < 30; i += 1) {
    const b = i % 3 === 0 ? g.ltl() : g.tl(i % 3 === 1 ? 0 : 2);
    priors.push(b);
    history.push(b.inv);
  }
  const cases: SyntheticCase[] = [];
  const intake = (inv: NormalizedInvoice, n: number): IntakeInput => (n % 3 === 0 ? { kind: 'edi210', text: toEdi210(inv) } : n % 3 === 1 ? { kind: 'csv', text: toCsv(inv) } : { kind: 'fields', fields: inv });
  const push = (injected: InjectionKind | null, b: Built, expected: Dec, note: string): void => {
    const n = cases.length;
    cases.push({
      id: `SYN-${String(n + 1).padStart(3, '0')}`,
      injected,
      expectedRecovery: S(expected),
      note,
      auditCase: { invoice: intake(b.inv, n), evidence: b.ev, contracts: SYN_CONTRACTS, history, fuel: FUEL, asOf: AS_OF },
    });
  };
  const ZERO = Dec.fromInt(0);
  const cleanMakers: [string, () => Built][] = [
    ['TL contract A', () => g.tl(0)],
    ['TL contract C (fuel table)', () => g.tl(2)],
    ['LTL contract B', () => g.ltl()],
    ['TL with detention earned and billed', () => g.tl(0, { detentionHours: g.int(1, 3) })],
    ['LTL reweigh WITH certificate (hard negative)', () => g.ltl({ reweighWithCert: true, weight: g.int(12, 30) * 100 })],
    ['LTL minimum charge applied (hard negative)', () => g.ltl({ weight: 300 })],
    ['TL approved lumper', () => g.tl(0, { lumper: true })],
    ['TL two stop-offs on identical lines (hard negative)', () => g.tl(0, { twoStops: true })],
    ['LTL with accessorial', () => g.ltl({ accessorial: true })],
  ];
  for (let i = 0; i < clean; i += 1) {
    const [note, make] = cleanMakers[i % cleanMakers.length] as [string, () => Built];
    push(null, make(), ZERO, note);
  }
  for (const kind of INJECTION_KINDS) {
    for (let k = 0; k < perKind; k += 1) {
      if (kind === 'duplicate_invoice') {
        const src = priors[(k * 7) % priors.length] as Built;
        const inv: NormalizedInvoice = { ...src.inv, invoiceNumber: `${src.inv.invoiceNumber}-R`, invoiceDate: addDays(src.inv.invoiceDate, 20), lines: src.inv.lines.map((l) => ({ ...l })) };
        push(kind, { inv, ev: src.ev }, D(inv.total ?? '0'), 'same PRO billed again under a new invoice number');
      } else if (kind === 'fsc_wrong_base') {
        const ltl = k % 2 === 1;
        const b = ltl ? g.ltl({ accessorial: true }) : g.tl(0, { accessorial: true });
        const p = ltl ? '25' : '18';
        const lh = linehaulOf(b.inv);
        const nonFuel = sumDec(b.inv.lines.filter((l) => l.description !== 'Fuel surcharge').map((l) => D(l.amount)));
        const billed = pct(p, nonFuel);
        setFuel(b.inv, billed);
        push(kind, { inv: finish(b.inv), ev: b.ev }, sub(billed, pct(p, lh)), `fuel ${p}% applied to linehaul plus accessorials`);
      } else if (kind === 'unauthorized_detention') {
        const b = g.tl(k % 2 === 0 ? 0 : 2, { detentionHours: 0 });
        const fuelAt = b.inv.lines.findIndex((l) => l.description === 'Fuel surcharge');
        b.inv.lines.splice(fuelAt, 0, line('Detention', D('120.00'), null, '2', '60.00'));
        push(kind, { inv: finish(b.inv), ev: b.ev }, D('120.00'), 'detention billed; gate times show the truck left within free time');
      } else if (kind === 'reweigh_no_evidence') {
        const w = g.int(12, 30) * 100;
        const b = g.ltl({ weight: w });
        const lane = SYN_CONTRACTS[1]?.lanes.find((l) => l.origin === b.inv.origin && l.destination === b.inv.destination);
        const R = lane?.ratePerCwt?.[b.inv.billedClass ?? ''] ?? '0';
        const extra = g.int(2, 8) * 100;
        const billedW = w + extra;
        const lh0 = linehaulOf(b.inv);
        const lh1 = q2(div(mul(D(R), Dec.fromInt(billedW)), Dec.fromInt(100)));
        b.inv.billedWeightLbs = String(billedW);
        b.inv.lines = b.inv.lines.map((l) => (l.description === 'Linehaul' ? line('Linehaul', lh1, null, String(billedW / 100), R) : l));
        setFuel(b.inv, pct('25', lh1));
        push(kind, { inv: finish(b.inv), ev: b.ev }, add(sub(lh1, lh0), sub(pct('25', lh1), pct('25', lh0))), `billed ${billedW} lb vs BOL ${w} lb, no reweigh certificate`);
      } else if (kind === 'rate_above_contract') {
        if (k % 2 === 0) {
          const b = g.tl(0);
          const lh0 = linehaulOf(b.inv);
          const lh1 = add(lh0, Dec.fromInt(g.int(2, 12) * 25));
          b.inv.lines = b.inv.lines.map((l) => (l.description === 'Linehaul' ? line('Linehaul', lh1) : l));
          setFuel(b.inv, pct('18', lh1));
          push(kind, { inv: finish(b.inv), ev: b.ev }, add(sub(lh1, lh0), sub(pct('18', lh1), pct('18', lh0))), 'TL linehaul above the contract lane rate');
        } else {
          const w = g.int(12, 30) * 100;
          const b = g.ltl({ weight: w });
          const R = D(b.inv.lines.find((l) => l.description === 'Linehaul')?.rate ?? '0');
          const R1 = add(R, D('1.50'));
          const lh0 = linehaulOf(b.inv);
          const lh1 = q2(div(mul(R1, Dec.fromInt(w)), Dec.fromInt(100)));
          b.inv.lines = b.inv.lines.map((l) => (l.description === 'Linehaul' ? line('Linehaul', lh1, null, String(w / 100), R1.toString()) : l));
          setFuel(b.inv, pct('25', lh1));
          push(kind, { inv: finish(b.inv), ev: b.ev }, add(sub(lh1, lh0), sub(pct('25', lh1), pct('25', lh0))), 'LTL rate per cwt above the tariff');
        }
      } else if (kind === 'arithmetic_error') {
        const delta = Dec.fromInt(g.int(1, 9) * 10);
        if (k % 2 === 0) {
          const b = g.pick([() => g.tl(0), () => g.ltl(), () => g.tl(2)])();
          b.inv.total = S(add(D(b.inv.total ?? '0'), delta));
          push(kind, b, delta, 'stated total exceeds the sum of the lines');
        } else {
          const b = g.tl(0, { detentionHours: 3 });
          b.inv.lines = b.inv.lines.map((l) => (l.description === 'Detention' ? { ...l, amount: S(add(D(l.amount), delta)) } : l));
          push(kind, { inv: finish(b.inv), ev: b.ev }, delta, 'detention line amount is not quantity x rate');
        }
      } else if (kind === 'fsc_wrong_week') {
        let b = g.tl(2);
        let billed: Dec | null = null;
        for (let tries = 0; tries < 20 && billed === null; tries += 1) {
          const idx = postingIndex(b.inv.shipDate ?? '');
          const cur = tableRate(SYN_DIESEL.observations[idx]?.value ?? '0.000');
          const prev = tableRate(SYN_DIESEL.observations[idx - 1]?.value ?? '0.000');
          if (gt(prev, cur)) billed = q2(mul(D(b.inv.miles ?? '0'), prev));
          else b = g.tl(2);
        }
        if (billed === null) throw new Error('no wrong-week date found');
        const correct = D(b.inv.lines.find((l) => l.description === 'Fuel surcharge')?.amount ?? '0');
        setFuel(b.inv, billed);
        push(kind, { inv: finish(b.inv), ev: b.ev }, sub(billed, correct), 'fuel uses the previous week of the diesel index');
      } else if (kind === 'unauthorized_accessorial') {
        const b = g.tl(0, { lumper: false });
        const amount = D(g.pick(['140.00', '180.00', '225.00']));
        const fuelAt = b.inv.lines.findIndex((l) => l.description === 'Fuel surcharge');
        b.inv.lines.splice(fuelAt, 0, k % 2 === 0 ? line('Lumper fee', amount, 'LUMPER') : line('Driver assist unloading', D('100.00'), 'DRIVERASSIST'));
        push(kind, { inv: finish(b.inv), ev: b.ev }, k % 2 === 0 ? amount : D('100.00'), 'accessorial that needs approval billed without one');
      } else {
        const w = g.int(12, 30) * 100;
        const b = g.ltl({ nonFak: true, weight: w });
        b.ev.bolClass = '70';
        const lane = SYN_CONTRACTS[1]?.lanes.find((l) => l.origin === b.inv.origin && l.destination === b.inv.destination);
        const r70 = D(lane?.ratePerCwt?.['70'] ?? '0');
        const r85 = D(lane?.ratePerCwt?.['85'] ?? '0');
        const lh0 = q2(div(mul(r70, Dec.fromInt(w)), Dec.fromInt(100)));
        const lh1 = q2(div(mul(r85, Dec.fromInt(w)), Dec.fromInt(100)));
        b.inv.billedClass = '85';
        b.inv.lines = b.inv.lines.map((l) => (/linehaul|minimum/iu.test(l.description) ? line('Linehaul', lh1, null, String(w / 100), r85.toString()) : l));
        setFuel(b.inv, pct('25', lh1));
        push(kind, { inv: finish(b.inv), ev: b.ev }, add(sub(lh1, lh0), sub(pct('25', lh1), pct('25', lh0))), 'rated at class 85; BOL says class 70');
      }
    }
  }
  return { cases, history };
}

export interface KindStats {
  cases: number;
  detected: number;
  detectedConfirmed: number;
  dollarExact: number;
}

export interface EvalReport {
  synthetic: true;
  seed: number;
  cases: number;
  clean: { cases: number; withFlag: number; withConfirmed: number };
  findings: { flagged: number; flaggedTrue: number; confirmed: number; confirmedTrue: number };
  /** Share of flagged (confirmed + needs_review) findings that explain an injected overcharge. */
  precisionFlagged: number;
  /** Share of auto-confirmed findings that explain an injected overcharge. */
  precisionConfirmed: number;
  /** Injected cases with at least one correct flagged finding. */
  recallFlagged: number;
  /** Injected cases with at least one correct confirmed finding. */
  recallConfirmed: number;
  /** Injected cases whose confirmed correct findings add up to the injected dollars exactly. */
  dollarExactRecall: number;
  perKind: Record<InjectionKind, KindStats>;
  misses: string[];
  falsePositives: string[];
}

/** Run the team on the synthetic set and measure precision and recall of the flagging. */
export async function evaluateAuditTeam(seed = 20261022, opts: TeamOptions = {}, clean = 45, perKind = 10): Promise<EvalReport> {
  const { cases } = buildSyntheticSet(seed, clean, perKind);
  const perKindStats = Object.fromEntries(INJECTION_KINDS.map((k) => [k, { cases: 0, detected: 0, detectedConfirmed: 0, dollarExact: 0 }])) as Record<InjectionKind, KindStats>;
  const f = { flagged: 0, flaggedTrue: 0, confirmed: 0, confirmedTrue: 0 };
  const cleanStats = { cases: 0, withFlag: 0, withConfirmed: 0 };
  const misses: string[] = [];
  const fps: string[] = [];
  for (const c of cases) {
    const report = await runAuditTeam(c.auditCase, opts);
    const status = new Map(report.verdicts.map((v) => [v.findingId, v.status]));
    const ok = c.injected === null ? [] : RULES_BY_KIND[c.injected];
    const flagged = report.findings.filter((x) => status.get(x.id) !== 'rejected' && status.has(x.id));
    const confirmed = flagged.filter((x) => status.get(x.id) === 'confirmed');
    const isTrue = (x: { ruleId: string }): boolean => ok.includes(x.ruleId);
    f.flagged += flagged.length;
    f.flaggedTrue += flagged.filter(isTrue).length;
    f.confirmed += confirmed.length;
    f.confirmedTrue += confirmed.filter(isTrue).length;
    for (const x of flagged.filter((y) => !isTrue(y))) fps.push(`${c.id} (${c.injected ?? 'clean'}: ${c.note}): ${x.ruleId} $${x.amount} [${status.get(x.id) ?? ''}]`);
    if (c.injected === null) {
      cleanStats.cases += 1;
      if (flagged.length > 0) cleanStats.withFlag += 1;
      if (confirmed.length > 0) cleanStats.withConfirmed += 1;
      continue;
    }
    const s = perKindStats[c.injected];
    s.cases += 1;
    if (flagged.some(isTrue)) s.detected += 1;
    if (confirmed.some(isTrue)) s.detectedConfirmed += 1;
    const got = S(sumDec(confirmed.filter(isTrue).map((x) => D(x.amount))));
    if (got === c.expectedRecovery) s.dollarExact += 1;
    else misses.push(`${c.id} ${c.injected}: expected $${c.expectedRecovery}, confirmed $${got}; steps: ${report.steps.map((st) => st.note).join(' | ')}`);
  }
  const injected = cases.filter((c) => c.injected !== null).length;
  const sumK = (k: keyof KindStats): number => INJECTION_KINDS.reduce((a, kind) => a + perKindStats[kind][k], 0);
  const ratio = (a: number, b: number): number => (b === 0 ? 1 : a / b);
  return {
    synthetic: true,
    seed,
    cases: cases.length,
    clean: cleanStats,
    findings: f,
    precisionFlagged: ratio(f.flaggedTrue, f.flagged),
    precisionConfirmed: ratio(f.confirmedTrue, f.confirmed),
    recallFlagged: ratio(sumK('detected'), injected),
    recallConfirmed: ratio(sumK('detectedConfirmed'), injected),
    dollarExactRecall: ratio(sumK('dollarExact'), injected),
    perKind: perKindStats,
    misses,
    falsePositives: fps,
  };
}