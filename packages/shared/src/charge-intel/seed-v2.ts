/**
 * Seed label set `tariff-seed-v2` of the charge classifier (REQ-20261019-seed-v2; hive run ml-curves,
 * 2026-10-20): `tariff-seed-v1` unchanged (the first 175 entries, same object references, same order)
 * followed by 81 charge NAMES copied from two further public tariffs (SEED_V2_ADDED), each labelled
 * detention / fuel / linehaul / accessorial under the v1 rule (detention = waiting or detention of driver
 * or equipment; fuel = fuel surcharge; linehaul = base transportation rate; everything else accessorial).
 * Charge names only; no rates, tariff text, customer, shipment or invoice data. Owner decisions of
 * 2026-10-19: seed-v2 approved; real public tariff data allowed in the repo with attribution (OQ1).
 *
 * Provenance of the additions (SEED_V2_SOURCES, SEED_V2_PROVENANCE): every name was checked against the
 * text of the archived source document on 2026-10-20 (hive runs/ml-curves/seedv2_verification.json). Item
 * titles that the source prints with an en or em dash are written with an ASCII hyphen (the normalized text,
 * and so every feature, is identical). Three GSA titles that the earlier candidate list had cut at a line
 * break are completed. From the GSA tariff only items that state a charge or appear under "Allowable
 * Charges" are kept; seven rule-only item titles of the candidate list were dropped. The J.B. Hunt guide of
 * the candidate list was not adopted: its page forbids reproduction without written consent, no archive
 * exists and it measured no gain. Labels: one labeller (scoup-ml, 2026-10-19) reviewed by a second
 * (ml-curves, 2026-10-20, not blind); no disagreement.
 *
 * Appending keeps every v1 tie-break (an earlier example still wins a tie). Generated from the checked list;
 * do not edit entries by hand (the evaluation gate and the attribution depend on the exact strings and
 * order). Exported only from the `@fr/shared/charge-intel` subpath, never from the package root.
 */
import type { ChargeCategory } from './constants.js';
import { SEED_SOURCES, SEED_V1, type SeedSource } from './seed-v1.js';

const RETRIEVED = '2026-10-19';

/** All sources of seed-v2: the six v1 sources (the same objects) followed by the two added ones. */
export const SEED_V2_SOURCES = Object.freeze({
  ...SEED_SOURCES,
  gsa_2021: Object.freeze({
    label: 'GSA Uniform Rules Tariff 200-A (2021)',
    document: 'U.S. General Services Administration Uniform Rules Tariff No. 200-A (GSA No. 200-A), accessorial and terminal services',
    effective: '2021-10-01',
    url: 'https://origin-www.gsa.gov/system/files/GSA%20No_200-A%20Uniform%20Rules%20Tariff.pdf',
    retrieved: RETRIEVED,
  }),
  fedex_2026: Object.freeze({
    label: 'FedEx Freight accessorials, Canada (2026)',
    document: 'FedEx Freight "The extras from the experts" accessorial services sheet (intra-Canada)',
    effective: '2026-01-05',
    url: 'https://www.fedexfreight.com/content/dam/web/us/documents/fxf-gri-updates-english2026.pdf',
    retrieved: RETRIEVED,
  }),
} as const satisfies Readonly<Record<string, SeedSource>>);

export type SeedSourceIdV2 = keyof typeof SEED_V2_SOURCES;

/** One labelled seed-v2 example (every v1 example is one). */
export interface SeedExampleV2 {
  readonly text: string;
  readonly label: Exclude<ChargeCategory, 'other'>;
  readonly source: SeedSourceIdV2;
}

/** Archive, digest, extraction method and reuse terms of an added source. */
export interface SeedProvenance {
  readonly archive: string;
  readonly sha256: string;
  readonly extraction: string;
  readonly terms: string;
}

export const SEED_V2_PROVENANCE: Readonly<Record<'gsa_2021' | 'fedex_2026', SeedProvenance>> = Object.freeze({
  gsa_2021: Object.freeze({
    archive: 'hive runs/scoup-ml/e4_sources/gsa_200A.pdf (121 pages, retrieved 2026-10-19)',
    sha256: '053aac16023c4c0f4ef46c8338ac735a24adefe65b7bd2a99167618bfd1a1c43',
    extraction:
      'Item titles from the table of contents, checked against the body text (2026-10-20); items under "Allowable Charges" or stating a charge kept, rule-only items dropped; dashes written as ASCII hyphens.',
    terms: 'Work of the U.S. Government (17 U.S.C. 105). Charge names only, no rates.',
  }),
  fedex_2026: Object.freeze({
    archive: 'hive runs/scoup-ml/e4_sources/fxf_gri_2026.pdf (2 pages, retrieved 2026-10-19)',
    sha256: '7863bf5870f09fa05275662ab6289832c49769e723ed462fb752ee990a667014',
    extraction: 'Service names from the accessorial table, checked against the text (2026-10-20); the em dash of one title written as an ASCII hyphen.',
    terms: 'The document states it is for informational purposes only and states no reuse licence. Charge names only, no rates.',
  }),
});

const e = (text: string, label: SeedExampleV2['label'], source: SeedSourceIdV2): SeedExampleV2 => Object.freeze({ text, label, source });

/** The 81 added examples: GSA items in table-of-contents order, then the FedEx Freight sheet in print order. */
export const SEED_V2_ADDED: readonly SeedExampleV2[] = Object.freeze([
  e('TELEGRAMS OR TELEPHONE MESSAGES - CHARGES FOR', 'accessorial', 'gsa_2021'),
  e('RECONSIGNMENT OR DIVERSION', 'accessorial', 'gsa_2021'),
  e('RECONSIGNMENT OR DIVERSION AFTER TENDER OF DELIVERY CHANGE IN DESTINATION', 'accessorial', 'gsa_2021'),
  e('RECONSIGNMENT OR DIVERSION AFTER TENDER OF DELIVERY- SAME PLANT FACILITY', 'accessorial', 'gsa_2021'),
  e('RECONSIGNMENT OR DIVERSION- COSIGNOR OR COSIGNEE PICKUP AT TERMINAL', 'accessorial', 'gsa_2021'),
  e('REDELIVERY', 'accessorial', 'gsa_2021'),
  e('REDELIVERY- SEALING OF EQUIPMENT - PICKUP AT CARRIERS PREMISE', 'accessorial', 'gsa_2021'),
  e('STOPOFFS - TO COMPLETE LOADING OR FOR PARTIAL UNLOADING', 'accessorial', 'gsa_2021'),
  e('STOPOFFS - TO COMPLETE LOADING OR FOR PARTIAL UNLOADING- NORMAL', 'accessorial', 'gsa_2021'),
  e('STOPOFFS - TO COMPLETE LOADING OR FOR PARTIAL UNLOADING- EXCESSIVE DISTANCE', 'accessorial', 'gsa_2021'),
  e('STORAGE', 'accessorial', 'gsa_2021'),
  e('STORAGE- FREIGHT STORED IN PUBLIC WAREHOUSE BY CARRIER', 'accessorial', 'gsa_2021'),
  e('WEIGHT VERIFICATION', 'accessorial', 'gsa_2021'),
  e('WEIGHT - VERIFICATION- SECURE CERTIFIED PUBLIC SCALE WEIGHT ACTUAL CHARGES', 'accessorial', 'gsa_2021'),
  e('DOUBLES TRAILER FURNISHED FOR LOADING', 'accessorial', 'gsa_2021'),
  e('ARRIVAL NOTICE AND UNDELIVERED FREIGHT', 'accessorial', 'gsa_2021'),
  e('CHASSIS - OBTAINING OF', 'accessorial', 'gsa_2021'),
  e('ARBITRARY APPLICABLE ON IMPORT OR EXPORT TRAFFIC PICKED UP AT OR DELIVERED TO STEAMSHIP WHARVES OR DOCKS', 'accessorial', 'gsa_2021'),
  e('CUSTOMS OR IN BOND FREIGHT', 'accessorial', 'gsa_2021'),
  e('DELIVERY OF FREIGHT BILL PRIOR TO DELIVERY OF SHIPMENT', 'accessorial', 'gsa_2021'),
  e('DETENTION - VEHICLES WITH POWER UNITS', 'detention', 'gsa_2021'),
  e('DETENTION - VEHICLES WITH POWER UNITS - AFTER HOURS', 'detention', 'gsa_2021'),
  e('DETENTION - VEHICLES WITH POWER UNITS - HOLIDAYS', 'detention', 'gsa_2021'),
  e('DETENTION - VEHICLES WITHOUT POWER UNITS - SPOTTING OR DROPPING TRAILERS', 'detention', 'gsa_2021'),
  e('DIVERSION - MOTOR TO AIR TRANSPORTATION', 'accessorial', 'gsa_2021'),
  e('DIVERSION - MOTOR TO AIR TRANSPORTATION CHARGE FOR DELIVERY TO AIRPORT', 'accessorial', 'gsa_2021'),
  e('HYDRAULIC LIFT GATE SERVICE', 'accessorial', 'gsa_2021'),
  e('FORK-LIFT SERVICE', 'accessorial', 'gsa_2021'),
  e('EXCLUSIVE USE AND CONTROL OF VEHICLE', 'accessorial', 'gsa_2021'),
  e('EXCLUSIVE USE AND CONTROL OF VEHICLE- DOUBLE TRAILER', 'accessorial', 'gsa_2021'),
  e('EXPEDITED SERVICE', 'accessorial', 'gsa_2021'),
  e('EMERGENCY RESPONSES AFTER HOURS SERVICE CHARGE', 'accessorial', 'gsa_2021'),
  e('EXPORT OR IMPORT SHIPMENT REQUIREMENTS AT THE U.S. - CANADIAN BORDER', 'accessorial', 'gsa_2021'),
  e('EXTRA LABOR - LOADING OR UNLOADING', 'accessorial', 'gsa_2021'),
  e('EXTRA LABOR - LOADING OR UNLOADING- NORMAL BUSINESS HOURS', 'accessorial', 'gsa_2021'),
  e('EXTRA LABOR - LOADING OR UNLOADING- AFTER HOURS', 'accessorial', 'gsa_2021'),
  e('EXTRA LABOR - LOADING OR UNLOADING-HOLIDAY HOURS', 'accessorial', 'gsa_2021'),
  e('HANDLING FREIGHT AT POSITIONS NOT IMMEDIATELY ADJACENT TO VEHICLE', 'accessorial', 'gsa_2021'),
  e('LOADING OR UNLOADING - WATERBORNE TRAFFIC - PORT OF BALTIMORE, MD', 'accessorial', 'gsa_2021'),
  e('MARKING OR TAGGING FREIGHT - CHANGING MARKING OR TAGS', 'accessorial', 'gsa_2021'),
  e('SINGLE SHIPMENT CHARGE', 'accessorial', 'gsa_2021'),
  e('NOTIFICATION CHARGE', 'accessorial', 'gsa_2021'),
  e('OVERDIMENSION FREIGHT', 'accessorial', 'gsa_2021'),
  e('OVERWEIGHT FREIGHT', 'accessorial', 'gsa_2021'),
  e('PERMITS, SPECIAL', 'accessorial', 'gsa_2021'),
  e('PICKUP OR DELIVERY SERVICE', 'accessorial', 'gsa_2021'),
  e('PICKUP OR DELIVERY SERVICE- MORE THEN ONE LOADING OR UNLOADING SITE', 'accessorial', 'gsa_2021'),
  e('PICKUP OR DELIVERY SERVICE- PRIVATE RESIDENCE', 'accessorial', 'gsa_2021'),
  e('PICKUP OR DELIVERY SERVICE - AT PRIVATE RESIDENCES', 'accessorial', 'gsa_2021'),
  e('PICKUP OR DELIVERY SERVICE - SUNDAYS OR HOLIDAYS', 'accessorial', 'gsa_2021'),
  e('PICKUP OR DELIVERY SERVICE - SUNDAYS OR HOLIDAYS - BY HOURS', 'accessorial', 'gsa_2021'),
  e('PICKUP OR DELIVERY SERVICE - SUNDAYS OR HOLIDAYS- BY DAYS', 'accessorial', 'gsa_2021'),
  e('PICKUP/DELIVERY SERVICE - SUNDAYS OR HOLIDAYS - EMPTY VEHICLE(S)', 'accessorial', 'gsa_2021'),
  e('PICKUP OR DELIVERY SERVICE - SATURDAY OR AFTER 5 P.M. ON NORMAL BUSINESS DAYS', 'accessorial', 'gsa_2021'),
  e('PICKUP OR DELIVERY SERVICE - NEW YORK HARBOR AND PORT NEWARK, NJ', 'accessorial', 'gsa_2021'),
  e('SORTING OR SEGREGATING SERVICE AND CHARGES', 'accessorial', 'gsa_2021'),
  e('SERVICES - SIGNATURE AND TALLY RECORD SERVICE', 'accessorial', 'gsa_2021'),
  e('TRANSFER OF LADING', 'accessorial', 'gsa_2021'),
  e('VEHICLE OR SHIPPER-REQUESTED DOUBLES TRAILER FURNISHED BUT NOT USED', 'accessorial', 'gsa_2021'),
  e('SERVICES - CONSTANT SURVEILLANCE SERVICE', 'accessorial', 'gsa_2021'),
  e('SERVICES - DUAL DRIVER PROTECTIVE SERVICE', 'accessorial', 'gsa_2021'),
  e('SERVICES - DUAL DRIVER SERVICE', 'accessorial', 'gsa_2021'),
  e('SPECIAL SERVICE - SECURITY CHECK BY CONSIGNOR OR CONSIGNEE', 'accessorial', 'gsa_2021'),
  e('FUEL RELATED GENERAL RATE ADJUSTMENT', 'fuel', 'gsa_2021'),
  e('Carrier Liability Coverage', 'accessorial', 'fedex_2026'),
  e('Credit Card Payments', 'accessorial', 'fedex_2026'),
  e('Detention', 'detention', 'fedex_2026'),
  e('Exhibition Sites', 'accessorial', 'fedex_2026'),
  e('Extreme Length', 'accessorial', 'fedex_2026'),
  e('Hazardous Material Handling', 'accessorial', 'fedex_2026'),
  e('Inside Pickup or Delivery', 'accessorial', 'fedex_2026'),
  e('Liftgate Service', 'accessorial', 'fedex_2026'),
  e('Limited Access Pickup or Delivery', 'accessorial', 'fedex_2026'),
  e('Non-Business Time or Non-Business Days', 'accessorial', 'fedex_2026'),
  e('Notification Prior to Delivery', 'accessorial', 'fedex_2026'),
  e('Over Length', 'accessorial', 'fedex_2026'),
  e('Redelivery', 'accessorial', 'fedex_2026'),
  e('Regional Shopping Malls', 'accessorial', 'fedex_2026'),
  e('Residential Pickup or Delivery', 'accessorial', 'fedex_2026'),
  e('Storage - When Freight is Held by Carrier', 'accessorial', 'fedex_2026'),
  e('Weight (Reweigh)', 'accessorial', 'fedex_2026'),
]);

/** The 256 seed-v2 examples: `SEED_V1` (the same objects, same order) followed by `SEED_V2_ADDED`. */
export const SEED_V2: readonly SeedExampleV2[] = Object.freeze([...SEED_V1, ...SEED_V2_ADDED]);