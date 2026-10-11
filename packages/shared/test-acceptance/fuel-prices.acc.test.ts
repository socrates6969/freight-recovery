// REQ-20261011-fuel-outlook Tier L: T1 bundled history and provenance (CI-P01..P05; Part C F2) and T2 price CSV
// parser (CI-C01..C04; Part C F9). Expected values come from test-spec; the run-dir copies are compared when they
// are present (owner machine), otherwise the sha256 pins carry the byte-identity guarantee.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CITE_DIESEL, CITE_PPI, DATA_DIR, ROOT, RUN_DATA_DIR, SHA_DIESEL, SHA_PPI, URL_DIESEL, URL_PPI,
  loadModules, readData, runDataPresent, sha256, type OutlookMod, type Root,
} from './helpers/fuel-fixtures.js';

let O: OutlookMod;
let R: Root;
beforeAll(async () => {
  ({ O, R } = await loadModules());
});

describe('T1 bundled history and provenance (F2)', () => {
  it('CI-P01 exactly four files; sha256 and sizes pinned; no CR byte; byte-identical to the run-dir files', () => {
    expect(readdirSync(DATA_DIR).sort()).toEqual(['GASDESW.csv', 'PCU4841214841212.csv', 'README.md', 'manifest.json']);
    const d = readData('GASDESW.csv');
    const p = readData('PCU4841214841212.csv');
    expect([sha256(d), d.length]).toEqual([SHA_DIESEL, 28908]);
    expect([sha256(p), p.length]).toEqual([SHA_PPI, 7820]);
    expect(d.includes(0x0d)).toBe(false);
    expect(p.includes(0x0d)).toBe(false);
    if (runDataPresent()) {
      expect(d.equals(readFileSync(resolve(RUN_DATA_DIR, 'GASDESW.csv')))).toBe(true);
      expect(p.equals(readFileSync(resolve(RUN_DATA_DIR, 'PCU4841214841212.csv')))).toBe(true);
    }
  });
  it('CI-P02 manifest.json equals the contract (exact keys per entry)', () => {
    const m: unknown = JSON.parse(readData('manifest.json').toString('utf8'));
    expect(m).toStrictEqual({
      version: 1,
      files: [
        { series: 'diesel_us', file: 'GASDESW.csv', sha256: SHA_DIESEL, sourceUrl: URL_DIESEL, retrievedAt: '2026-10-11', rows: 1699, firstDate: '1994-03-21', lastDate: '2026-10-05' },
        { series: 'ppi_tl', file: 'PCU4841214841212.csv', sha256: SHA_PPI, sourceUrl: URL_PPI, retrievedAt: '2026-10-11', rows: 411, firstDate: '1992-06-01', lastDate: '2026-08-01' },
      ],
    });
  });
  it('CI-P03 .gitattributes marks api/data/public-prices/** as -text', () => {
    const ga = readFileSync(resolve(ROOT, '.gitattributes'), 'utf8');
    expect(ga.split(/\r?\n/).some((l) => /^api\/data\/public-prices\/\*\*\s+(?:\S+\s+)*-text(?:\s|$)/.test(l.trim()))).toBe(true);
  });
  it('CI-P04 README cites both sources verbatim, public domain, retrieval date, no customer data; only allowed URLs; no e-mail', () => {
    const md = readData('README.md').toString('utf8');
    expect(md).toContain(CITE_DIESEL);
    expect(md).toContain(CITE_PPI);
    expect(md).toMatch(/public domain/i);
    expect(md).toMatch(/citation requested/i);
    expect(md).toContain('2026-10-11');
    expect(md).toMatch(/no customer, carrier or shipment data/i);
    for (const f of readdirSync(DATA_DIR)) {
      const t = readData(f).toString('latin1');
      expect(t, `${f}: e-mail address`).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      for (const u of t.match(/[a-z][a-z0-9+.-]*:\/\/[^\s)>\]"'`]+/gi) ?? []) {
        const host = new URL(u).hostname.toLowerCase();
        expect(['fred.stlouisfed.org', 'eia.gov', 'bls.gov'].some((h) => host === h || host.endsWith(`.${h}`)), `${f}: URL ${u}`).toBe(true);
      }
    }
  });
  it('CI-P05 PRICE_SERIES equals the F2 table and is frozen', () => {
    const P = R.PRICE_SERIES as Record<string, Record<string, unknown>>;
    expect(Object.keys(P).sort()).toEqual(['diesel_us', 'ppi_tl']);
    expect(P.diesel_us).toMatchObject({ fredId: 'GASDESW', label: 'U.S. average diesel price', unit: 'USD per gallon', frequency: 'weekly', displayDecimals: 3, sourceUrl: URL_DIESEL, citation: CITE_DIESEL });
    expect(P.ppi_tl).toMatchObject({ fredId: 'PCU4841214841212', label: 'Producer price index, long-distance truckload', unit: 'index (Jun 1992 = 100)', frequency: 'monthly', displayDecimals: 1, sourceUrl: URL_PPI, citation: CITE_PPI });
    expect(Object.isFrozen(P)).toBe(true);
    expect(Object.isFrozen(P.diesel_us)).toBe(true);
    expect(Object.isFrozen(P.ppi_tl)).toBe(true);
    expect(R.PRICE_SERIES_KEYS).toEqual(['diesel_us', 'ppi_tl']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T2 parser
// ---------------------------------------------------------------------------------------------------------------
const enc = (s: string) => Buffer.from(s, 'latin1');
function csvError(fn: () => unknown): { code: unknown; line: unknown; name: string } {
  try {
    fn();
  } catch (e) {
    const x = e as { code?: unknown; line?: unknown; name?: string };
    if (O.PriceCsvError) expect(e).toBeInstanceOf(O.PriceCsvError);
    return { code: x.code, line: x.line, name: x.name ?? '' };
  }
  throw new Error('expected PriceCsvError, nothing was thrown');
}
const dieselLines = () => readData('GASDESW.csv').toString('latin1').split('\n'); // last element '' (final LF)
const join = (ls: string[]) => ls.join('\n');
const setLine = (i: number, v: string) => { const ls = dieselLines(); ls[i - 1] = v; return join(ls); };

describe('T2 price CSV parser (F9)', () => {
  it('CI-C01 both bundled files parse (rows, first/last, sha256, 3-decimal values)', () => {
    const d = O.parsePriceCsv(readData('GASDESW.csv'), 'diesel_us');
    expect(d.rows).toHaveLength(1699);
    expect(d.rows[0]).toEqual({ date: '1994-03-21', value: '1.106' });
    expect(d.rows.at(-1)).toEqual({ date: '2026-10-05', value: '6.199' });
    expect([d.sha256, d.firstDate, d.lastDate]).toEqual([SHA_DIESEL, '1994-03-21', '2026-10-05']);
    const p = O.parsePriceCsv(readData('PCU4841214841212.csv'), 'ppi_tl');
    expect(p.rows).toHaveLength(411);
    expect(p.rows.at(-1)).toEqual({ date: '2026-08-01', value: '215.105' });
    expect([p.sha256, p.firstDate, p.lastDate]).toEqual([SHA_PPI, '1992-06-01', '2026-08-01']);
    expect(p.rows.find((r) => r.date === '1992-06-01')?.value).toBe('100.000');
    for (const r of [...d.rows, ...p.rows]) expect(r.value).toMatch(/^\d{1,4}\.\d{3}$/);
  });
  it('F9 value text: fewer decimals are written with exactly 3', () => {
    const p = O.parsePriceCsv(enc(setLine(2, '1994-03-21,1.1')), 'diesel_us');
    expect(p.rows[0]).toEqual({ date: '1994-03-21', value: '1.100' });
  });
  const lines = dieselLines();
  const mondays = (n: number) => Array.from({ length: n }, (_, i) => `${new Date(Date.UTC(1990, 0, 1 + 7 * i)).toISOString().slice(0, 10)},1.000`);
  const cases: [string, () => Uint8Array, string, number | null | 'any'][] = [
    ['prepend UTF-8 BOM', () => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readData('GASDESW.csv')]), 'bom', 'any'],
    ['header date,GASDESW', () => enc(setLine(1, 'date,GASDESW')), 'bad_header', 1],
    ['header of the PPI series', () => enc(setLine(1, 'observation_date,PCU4841214841212')), 'bad_header', 1],
    ['row 2 value 1.1060', () => enc(setLine(2, '1994-03-21,1.1060')), 'bad_row', 2],
    ['row 2 value .', () => enc(setLine(2, '1994-03-21,.')), 'bad_row', 2],
    ['row 2 date 1994-02-30', () => enc(setLine(2, '1994-02-30,1.106')), 'bad_date', 2],
    ['swap rows 2 and 3', () => { const ls = [...lines]; [ls[1], ls[2]] = [ls[2] ?? '', ls[1] ?? '']; return enc(join(ls)); }, 'not_increasing', 3],
    ['delete row 3', () => enc(join(lines.filter((_, i) => i !== 2))), 'gap', 3],
    ['row 2 date a Tuesday', () => enc(setLine(2, '1994-03-22,1.106')), 'not_monday', 2],
    ['row 2 value 0.400', () => enc(setLine(2, '1994-03-21,0.400')), 'out_of_range', 2],
    ['byte 0xE9 in a value', () => { const b = Buffer.from(readData('GASDESW.csv')); b[b.indexOf('1.107')] = 0xe9; return b; }, 'not_ascii', 'any'],
    ['empty line as line 7', () => { const ls = [...lines]; ls.splice(6, 0, ''); return enc(join(ls)); }, 'bad_row', 7],
    ['1,048,577 bytes', () => { const b = Buffer.alloc(1048577, 0x30); b.write('observation_date,GASDESW\n'); return b; }, 'too_large', null],
    ['header only', () => enc('observation_date,GASDESW\n'), 'empty', null],
    ['5,001 consecutive Mondays', () => enc(`observation_date,GASDESW\n${mondays(5001).join('\n')}\n`), 'too_many_rows', null],
  ];
  it.each(cases)('CI-C02 %s -> code and line', (_label, bytes, code, line) => {
    const e = csvError(() => O.parsePriceCsv(bytes(), 'diesel_us'));
    expect(e.code).toBe(code);
    if (line !== 'any') expect(e.line).toBe(line);
  });
  it('CI-C02 5,000 consecutive Mondays still parse (upper bound inclusive)', () => {
    expect(O.parsePriceCsv(enc(`observation_date,GASDESW\n${mondays(5000).join('\n')}\n`), 'diesel_us').rows).toHaveLength(5000);
  });
  it('CI-C02 PPI: a date not on the 1st -> not_first_of_month; a missing month -> gap', () => {
    const pl = readData('PCU4841214841212.csv').toString('latin1').split('\n');
    const last = pl.length - 2; // index of the last data row ('' follows)
    const a = [...pl];
    a[last] = '2026-08-02,215.105';
    expect(csvError(() => O.parsePriceCsv(enc(join(a)), 'ppi_tl')).code).toBe('not_first_of_month');
    const b = pl.filter((_, i) => i !== 100);
    expect(csvError(() => O.parsePriceCsv(enc(join(b)), 'ppi_tl')).code).toBe('gap');
  });
  it('CI-C03 CRLF and a missing final newline parse to the same rows; sha256 is over the raw bytes', () => {
    const raw = readData('GASDESW.csv');
    const base = O.parsePriceCsv(raw, 'diesel_us');
    const crlf = Buffer.from(raw.toString('latin1').replace(/\n/g, '\r\n'), 'latin1');
    const noFinal = raw.subarray(0, raw.length - 1);
    for (const [label, b] of [['crlf', crlf], ['no final newline', noFinal]] as const) {
      const p = O.parsePriceCsv(b, 'diesel_us');
      expect(p.rows, label).toEqual(base.rows);
      expect(p.sha256, label).toBe(sha256(b));
      expect(p.sha256, label).not.toBe(base.sha256);
    }
  });
  it('CI-C04 a 1 MB adversarial line of digits and commas returns or throws within 1 s', () => {
    const body = `observation_date,GASDESW\n1994-03-21,${'1,'.repeat(499_000)}1\n`;
    expect(body.length).toBeLessThanOrEqual(1_048_576);
    const t0 = performance.now();
    try { O.parsePriceCsv(enc(body), 'diesel_us'); } catch { /* either outcome is fine; only the time is asserted */ }
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
