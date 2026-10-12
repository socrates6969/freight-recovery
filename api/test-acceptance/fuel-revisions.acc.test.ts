// REQ-20261011-fuel-outlook fix round 1 (1a95245), Tier L (no database): T18 CI-R01 paramsSha256 values (Part C
// F13) with a test-owned canonical-JSON oracle and node:crypto, cross-checked with the product's `fscParamsSha256`;
// CI-R05 `--accept-revisions` argument rules (Part C F9) through the importer's `parseArgs` and `main`.
import { beforeAll, describe, expect, it } from 'vitest';
import { oCanon, oParamsSha } from './helpers/canon-oracle.js';

type ParseArgs = (argv: readonly string[], today: string) => { mode: string; acceptRevisions?: boolean };
type Main = (argv: readonly string[], out: (s: string) => void, err: (s: string) => void, deps?: Record<string, unknown>) => Promise<number>;
let fscParamsSha256: (p: unknown) => string;
let parseArgs: ParseArgs;
let main: Main;
beforeAll(async () => {
  ({ fscParamsSha256 } = (await import('../src/intelligence/fuel.js')) as unknown as { fscParamsSha256: (p: unknown) => string });
  ({ parseArgs, main } = (await import('../src/platform/prices-cli.js')) as unknown as { parseArgs: ParseArgs; main: Main });
});

const oSha = oParamsSha;

const T1 = { basePrice: '1.20', stepSize: '0.06', ratePerStep: '0.01', bracket: 'above_base' };
const TP = { rows: [{ atLeast: '5.00', rate: '30' }, { atLeast: '6.00', rate: '32.5' }, { atLeast: '6.50', rate: '34' }] };
const TM = { basePrice: '1.25', mpg: '6', decimals: 3 };
const PINS: [string, unknown, string][] = [
  ['T1', T1, '04961e79258db6b0b90d91abffe44269ed433f203dece2e8883b5b0e1939181c'],
  ['TP', TP, 'a5cc80775c84a50b0900f9fe4168c89e6fa5b55833f78ead23338e99cf781be6'],
  ['TM', TM, 'afb0b9d8ea185fcd7eaa5da110de96851f3a4abdb6e209fa4d7aae1fc42938f4'],
];
const URL_D = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW';

describe('T18 CI-R01 paramsSha256 (F13)', () => {
  it('T1 canonical text is exact', () => {
    expect(oCanon(T1)).toBe('{"basePrice":"1.20","bracket":"above_base","ratePerStep":"0.01","stepSize":"0.06"}');
  });
  it.each(PINS)('%s: oracle and product both equal the pinned sha256', (_l, p, h) => {
    expect(oSha(p)).toBe(h);
    expect(fscParamsSha256(p)).toBe(h);
  });
  it('key order of the input object does not change the hash', () => {
    const rev = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).reverse());
    expect(fscParamsSha256(rev(T1))).toBe(PINS[0]?.[2]);
    expect(fscParamsSha256(rev(TM))).toBe(PINS[2]?.[2]);
    expect(fscParamsSha256({ rows: TP.rows.map((r) => ({ rate: r.rate, atLeast: r.atLeast })) })).toBe(PINS[1]?.[2]);
    // row order is content, not key order
    expect(fscParamsSha256({ rows: [...TP.rows].reverse() })).not.toBe(PINS[1]?.[2]);
  });
});

describe('T18 CI-R05 --accept-revisions argument rules (F9)', () => {
  const today = '2026-10-11';
  it('--list --accept-revisions is a usage error (parseArgs throws; main exits 2 before any database access)', async () => {
    expect(() => parseArgs(['--list', '--accept-revisions'], today)).toThrow();
    let err = '';
    const code = await main(['--list', '--accept-revisions'], () => undefined, (s) => { err += s; }, { env: {} });
    expect(code).toBe(2);
    expect(err).not.toMatch(/postgres(ql)?:\/\//);
  });
  it('accepted with --file, --bundled and --fetch; absent means false', () => {
    const file = ['--series', 'diesel_us', '--file', 'x.csv', '--source-url', URL_D, '--retrieved-at', '2026-10-11'];
    for (const [label, argv] of [['--file', file], ['--bundled', ['--bundled']], ['--fetch', ['--series', 'diesel_us', '--fetch']]] as const) {
      expect(parseArgs([...argv, '--accept-revisions'], today), label).toMatchObject({ acceptRevisions: true });
      expect(parseArgs([...argv], today), label).toMatchObject({ acceptRevisions: false });
    }
    expect(parseArgs(['--list'], today)).toMatchObject({ mode: 'list' });
  });
});
