/**
 * C9: public tariff presets (starting points for a tenant tariff; never applied automatically).
 *
 * Provenance: published figures retrieved 2026-10-11 from the carriers' public US tariff documents (CMA CGM
 * only through a trade publication, marked `secondary`). Owner decision on real public data recorded in
 * REQ-20261011-ocean-dd; verify against the current tariff before use. Tariff PDFs are not committed
 * (decision D10). Each preset's `data` passes `DdTariffData`.
 */
import type { DdTariffDataDto } from '../ocean-dd-dto.js';

export interface DdTariffPresetProvenance {
  readonly carrier: string;
  readonly document: string;
  readonly url: string;
  readonly retrieved: string;
  readonly effective: string | null;
  readonly sha256: string | null;
  readonly verification: 'primary' | 'primary_search_extract' | 'secondary';
  readonly assumptions: readonly string[];
}

export interface DdTariffPreset {
  readonly id: string;
  readonly data: DdTariffDataDto;
  readonly provenance: DdTariffPresetProvenance;
}

const RETRIEVED = '2026-10-11';
const MON_FRI = [1, 2, 3, 4, 5];
const MON_SAT = [1, 2, 3, 4, 5, 6];

/** The same rate for 20DV, 40DV, 40HC, 45HC (in that key order). */
const allDry = (rate: string): Record<string, string> => ({ '20DV': rate, '40DV': rate, '40HC': rate, '45HC': rate });

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x);
  }
  return v;
}

const MAERSK_URL = 'https://www.maersk.com/~/media_sc9/maersk/local-information/files/north-america/united-states-of-america/import/us-import-detention-tariff-effective-01-jan-2026.pdf';
const MSC_URL = 'https://www.msc.com/-/media/files/msc-cargo/local-information/america/united-states/detention-demurrage-and-per-diem-charges.pdf';
const HAPAG_URL = 'https://www.hapag-lloyd.com/content/dam/website/downloads/detention_demurrage/USA_Detention_Effective_October_01_2025.pdf';
const CMA_URL = 'https://blogs.tradlinx.com/same-box-same-delay-80-vs-360-a-day-how-us-demurrage-tiers-vary-by-carrier/';

export const DD_TARIFF_PRESETS: readonly DdTariffPreset[] = deepFreeze([
  {
    id: 'maersk-us-import-detention-2026',
    data: {
      name: 'Maersk US import detention (2026)',
      carrier: 'Maersk',
      chargeType: 'DETENTION',
      direction: 'IMPORT',
      ruleReference: 'Maersk US import detention tariff effective 01 Jan 2026',
      sourceUrl: MAERSK_URL,
      sourceRetrievedOn: RETRIEVED,
      freeDays: 4,
      freeDayBasis: 'working',
      startDayRule: 'included',
      chargeDayBasis: 'calendar',
      workingWeekdays: [...MON_SAT],
      tiers: [
        { days: 4, rates: allDry('210.00') },
        { days: 4, rates: allDry('260.00') },
        { days: null, rates: allDry('290.00') },
      ],
    },
    provenance: {
      carrier: 'Maersk',
      document: 'US import detention tariff effective 01 Jan 2026',
      url: MAERSK_URL,
      retrieved: RETRIEVED,
      effective: '2026-01-01',
      sha256: null,
      verification: 'primary_search_extract',
      assumptions: ['The day of gate-out counts as free day 1 when it is a working day.', 'Tariff days 5-8, 9-12 and 13+ are the 1st-4th, 5th-8th and 9th+ chargeable days.'],
    },
  },
  {
    id: 'msc-us-import-demurrage',
    data: {
      name: 'MSC US import demurrage (all ports except Baltimore)',
      carrier: 'MSC',
      chargeType: 'DEMURRAGE',
      direction: 'IMPORT',
      ruleReference: 'MSC detention, demurrage and per diem charges, A.1 import containers',
      sourceUrl: MSC_URL,
      sourceRetrievedOn: RETRIEVED,
      freeDays: 4,
      freeDayBasis: 'working',
      startDayRule: 'included',
      chargeDayBasis: 'calendar',
      workingWeekdays: [...MON_FRI],
      tiers: [
        { days: 5, rates: { '20DV': '65.00', '40DV': '80.00', '40HC': '80.00', '45HC': '80.00' } },
        { days: null, rates: { '20DV': '120.00', '40DV': '150.00', '40HC': '150.00', '45HC': '150.00' } },
      ],
    },
    provenance: {
      carrier: 'MSC',
      document: 'Detention, demurrage and per diem charges (United States)',
      url: MSC_URL,
      retrieved: RETRIEVED,
      effective: null,
      sha256: '7ee60b305cb409687e18a465327416b7796437a031ff1e22fc1ad2c6909bb4e3',
      verification: 'primary',
      assumptions: [
        'The tariff does not say whether chargeable days are calendar days; calendar days assumed.',
        'Working days assumed Monday to Friday.',
        'The first day of free time is assumed to count.',
      ],
    },
  },
  {
    id: 'hapag-lloyd-us-import-detention-mh-2025',
    data: {
      name: 'Hapag-Lloyd US import detention, merchant haulage (excl. California)',
      carrier: 'Hapag-Lloyd',
      chargeType: 'DETENTION',
      direction: 'IMPORT',
      ruleReference: 'Hapag-Lloyd USA Detention effective October 1, 2025, Import Merchant Haulage, Regular',
      sourceUrl: HAPAG_URL,
      sourceRetrievedOn: RETRIEVED,
      freeDays: 4,
      freeDayBasis: 'working',
      startDayRule: 'additional',
      chargeDayBasis: 'calendar',
      workingWeekdays: [...MON_FRI],
      tiers: [
        { days: 3, rates: allDry('200.00') },
        { days: 3, rates: allDry('250.00') },
        { days: null, rates: allDry('300.00') },
      ],
    },
    provenance: {
      carrier: 'Hapag-Lloyd',
      document: 'USA - Detention, effective October 1, 2025',
      url: HAPAG_URL,
      retrieved: RETRIEVED,
      effective: '2025-10-01',
      sha256: '5aea8cf368504f3e62446bbc2616931ef22c62e03e72f21448dce83ce662bfdd',
      verification: 'primary',
      assumptions: [
        'Free time is the day of interchange plus 4 working days (DOI+4WD).',
        'Working days depend on the terminal; Monday to Friday assumed.',
        'Per the May 2026 guide, bank holidays and shutout days do not count as free time and shutout days are not charged.',
      ],
    },
  },
  {
    id: 'cma-cgm-us-import-demurrage-standard',
    data: {
      name: 'CMA CGM US import demurrage, standard US ports (40 ft dry)',
      carrier: 'CMA CGM',
      chargeType: 'DEMURRAGE',
      direction: 'IMPORT',
      ruleReference: 'CMA CGM US import demurrage, standard US ports (as reported)',
      sourceUrl: CMA_URL,
      sourceRetrievedOn: RETRIEVED,
      freeDays: 4,
      freeDayBasis: 'working',
      startDayRule: 'included',
      chargeDayBasis: 'calendar',
      workingWeekdays: [...MON_FRI],
      tiers: [
        { days: 5, rates: { '40DV': '295.00', '40HC': '295.00' } },
        { days: 5, rates: { '40DV': '355.00', '40HC': '355.00' } },
        { days: null, rates: { '40DV': '395.00', '40HC': '395.00' } },
      ],
    },
    provenance: {
      carrier: 'CMA CGM',
      document: 'US import demurrage, standard US ports (reported by a trade publication)',
      url: CMA_URL,
      retrieved: RETRIEVED,
      effective: '2026-02-22',
      sha256: null,
      verification: 'secondary',
      assumptions: [
        'Rates from a trade publication, not from the CMA CGM tariff itself; verify before use.',
        'Tariff days 5-9, 10-14 and 15+ are the 1st-5th, 6th-10th and 11th+ chargeable days.',
        'Working days assumed Monday to Friday.',
      ],
    },
  },
] satisfies DdTariffPreset[]);
