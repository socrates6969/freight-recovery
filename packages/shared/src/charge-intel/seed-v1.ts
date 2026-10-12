/**
 * Seed label set `tariff-seed-v1` of the charge classifier (REQ-20261011-charge-intelligence, C2).
 *
 * Provenance: 175 billable charge NAMES copied verbatim from six public carrier rules / accessorial
 * tariffs (see SEED_SOURCES for document, effective date, URL and retrieval date 2026-10-11), each
 * labelled detention / fuel / linehaul / accessorial. Charge names only; no rates, tariff text, customer,
 * shipment or invoice data. Using these public names is an owner decision of 2026-10-10 recorded in
 * REQ-20261011-charge-intelligence. Generated from the run's seed JSON by a one-off script; do not edit
 * entries by hand (the evaluation gate and the attribution depend on the exact strings and order).
 *
 * Exported only from the `@fr/shared/charge-intel` subpath, never from the package root (keeps the
 * seed out of the web bundle).
 */
import type { ChargeCategory } from './constants.js';

export interface SeedSource {
  /** Short display label (shown next to a nearest example). */
  readonly label: string;
  /** Title of the public document. */
  readonly document: string;
  /** Effective date stated by the document (YYYY-MM-DD). */
  readonly effective: string;
  /** Public URL the document was retrieved from. */
  readonly url: string;
  /** Retrieval date (YYYY-MM-DD). */
  readonly retrieved: string;
}

const RETRIEVED = '2026-10-11';

/** The six public sources, in order of first appearance in the seed. */
export const SEED_SOURCES = Object.freeze({
  magnum_2026: Object.freeze({
    label: 'Magnum LTL Rules Tariff 125 (2026)',
    document: 'Magnum LTL 125 Rules and Special Services Tariff',
    effective: '2026-04-01',
    url: 'https://magnumlog.com/wp-content/uploads/2026/04/2026-Rules-Tariff-125-04.01.26.pdf',
    retrieved: RETRIEVED,
  }),
  gardewine_2025: Object.freeze({
    label: 'Gardewine GWN Tariff 100 (2025)',
    document: 'Gardewine GWN Tariff 100 General Rules, Domestic Canada LTL',
    effective: '2025-12-01',
    url: 'https://gardewine.com/wp-content/uploads/2026/06/GWN_RULES_TARIFF_100_DEC_2025_FINAL-V2.pdf',
    retrieved: RETRIEVED,
  }),
  dohrn_2025: Object.freeze({
    label: 'Dohrn Rules Tariff DHRN 100 (2025)',
    document: 'Dohrn Transfer Company accessorial recap, Rules Tariff DHRN 100 series',
    effective: '2025-01-20',
    url: 'https://dohrn.com/wp-content/uploads/2025/01/Dohrn-Rules-Tariff-Effective-01.20.2025.pdf',
    retrieved: RETRIEVED,
  }),
  states_2023: Object.freeze({
    label: 'States Logistics LTL accessorials (2023)',
    document: 'States Logistics Services LTL Accessorials and Miscellaneous Charges',
    effective: '2023-11-30',
    url: 'https://stateslogistics.com/wp-content/uploads/2024/07/LTLAccessorialMiscServices.pdf',
    retrieved: RETRIEVED,
  }),
  xpo_2025: Object.freeze({
    label: 'XPO Tariff CNWY 199-AJ.4 (2025)',
    document: 'XPO Logistics Freight Tariff CNWY 199-AJ.4, accessorial services',
    effective: '2025-11-03',
    url: 'https://www.xpo.com/cdn/download_files/s1/p2831/CNWY_199-AJ.4_Eff_11.3.2025.pdf',
    retrieved: RETRIEVED,
  }),
  estes_2025: Object.freeze({
    label: 'Estes accessorial charges (2025)',
    document: 'Estes Express Lines Accessorial Charges (Rules Tariff EXLA 105)',
    effective: '2025-11-17',
    url: 'https://www.estes-express.com/downloads/EXLAaccessorialCharges.pdf',
    retrieved: RETRIEVED,
  }),
} as const satisfies Readonly<Record<string, SeedSource>>);

export type SeedSourceId = keyof typeof SEED_SOURCES;

/** One labelled seed example. */
export interface SeedExample {
  readonly text: string;
  readonly label: Exclude<ChargeCategory, 'other'>;
  readonly source: SeedSourceId;
}

const e = (text: string, label: SeedExample['label'], source: SeedSourceId): SeedExample => Object.freeze({ text, label, source });

/** The 175 seed examples, in the order of the source file. */
export const SEED_V1: readonly SeedExample[] = Object.freeze([
  e('DETENTION', 'detention', 'magnum_2026'),
  e('FUEL SURCHARGE', 'fuel', 'magnum_2026'),
  e('BLIND SHIPMENTS', 'accessorial', 'magnum_2026'),
  e('BORDER CROSSING FEE - CANADA', 'accessorial', 'magnum_2026'),
  e('CALIFORNIA COMPLIANCE SURCHARGE', 'accessorial', 'magnum_2026'),
  e('INVOICE CONVENIENCE FEE', 'accessorial', 'magnum_2026'),
  e('COLLECTION ON DELIVERY (COD) SHIPMENTS', 'accessorial', 'magnum_2026'),
  e('EXTRA LABOR - LOADING OR UNLOADING', 'accessorial', 'magnum_2026'),
  e('HANDLING CHARGE - CROSS DOCKING AT TERMINAL', 'accessorial', 'magnum_2026'),
  e('TRANSPORATIONS OF HAZARDOUS MATERIALS - HAZMAT', 'accessorial', 'magnum_2026'),
  e('HIGH COST ZONES / REMOTE ACCESS POINT', 'accessorial', 'magnum_2026'),
  e('TOLL FEE', 'accessorial', 'magnum_2026'),
  e('INSIDE PICKUP OR DELIVERY - HANDLING FREIGHT AT POSITIONS NOT IMMEDIATELY ADJACENT', 'accessorial', 'magnum_2026'),
  e('INSPECTION CORRECTION - WEIGHTS AND RESEARCH (W&R)', 'accessorial', 'magnum_2026'),
  e('MARKING OR TAGGING FREIGHT - CHANGING MARKINGS OR TAGS', 'accessorial', 'magnum_2026'),
  e('NOTIFICATION PRIOR TO DELIVERY', 'accessorial', 'magnum_2026'),
  e('OVERLENGTH FREIGHT - GREATEST DIMENSION', 'accessorial', 'magnum_2026'),
  e('PAPER INVOICE FEE', 'accessorial', 'magnum_2026'),
  e('PICKUP OR DELIVERY SERVICE - LIMITED ACCESS', 'accessorial', 'magnum_2026'),
  e('PICKUP OR DELIVERY SERVICE - NON-BUSINESS HOUR, SATURDAYS, SUNDAYS & HOLIDAYS', 'accessorial', 'magnum_2026'),
  e('PROTECTIVE SERVICE - PROTECT FROM FREEZE (PFF)', 'accessorial', 'magnum_2026'),
  e('RECONSIGNMENT OR DIVERSION', 'accessorial', 'magnum_2026'),
  e('RE-DELIVERY', 'accessorial', 'magnum_2026'),
  e('SORT AND SEGREGATION SERVICES', 'accessorial', 'magnum_2026'),
  e('SPECIAL SERVICE - LIFTGATE SERVICE (HAND UNLOAD/GROUND SERVICE)', 'accessorial', 'magnum_2026'),
  e('STORAGE', 'accessorial', 'magnum_2026'),
  e('VEHICLE ORDERED BUT NOT USED - TRUCK ORDERED NOT USED (TONU)', 'accessorial', 'magnum_2026'),
  e('DETENTION - VEHICLE WITHOUT POWER', 'detention', 'gardewine_2025'),
  e('DETENTION - DRIVER WAIT', 'detention', 'gardewine_2025'),
  e('APPLICATION OF FUEL SURCHARGE', 'fuel', 'gardewine_2025'),
  e('RECONSIGNMENT', 'accessorial', 'gardewine_2025'),
  e('DIVERSION', 'accessorial', 'gardewine_2025'),
  e('EXCLUSIVE USE OF VEHICLE & EXPEDITED SERVICE', 'accessorial', 'gardewine_2025'),
  e('REFUSED AND RE-DELIVERY OF FREIGHT', 'accessorial', 'gardewine_2025'),
  e('DUNNAGE RETURN', 'accessorial', 'gardewine_2025'),
  e('VEHICLES FURNISHED, BUT NOT USED', 'accessorial', 'gardewine_2025'),
  e('REFUSED AND RETURNED FREIGHT', 'accessorial', 'gardewine_2025'),
  e('DELIVERY BY APPOINTMENT', 'accessorial', 'gardewine_2025'),
  e('CALL PRIOR TO DELIVERY', 'accessorial', 'gardewine_2025'),
  e('HEAVY LIFT CHARGES', 'accessorial', 'gardewine_2025'),
  e('BONDED SHIPMENTS', 'accessorial', 'gardewine_2025'),
  e('LOADING OR UNLOADING - EXTRA LABOUR', 'accessorial', 'gardewine_2025'),
  e('MARKING OR TAGGING OF FREIGHT', 'accessorial', 'gardewine_2025'),
  e('CROSS DOCK FEES', 'accessorial', 'gardewine_2025'),
  e('PROTECTIVE SERVICE', 'accessorial', 'gardewine_2025'),
  e('SORTING or SEGREGATING FREIGHT', 'accessorial', 'gardewine_2025'),
  e('SECURING FREIGHT - BLOCKING, BRACING, ETC.', 'accessorial', 'gardewine_2025'),
  e('CHAIN OF SIGNATURE', 'accessorial', 'gardewine_2025'),
  e('LONG FREIGHT HANDLING', 'accessorial', 'gardewine_2025'),
  e('STORAGE', 'accessorial', 'gardewine_2025'),
  e('SPECIAL PICKUP OR DELIVERY EQUIPMENT (TRANSFER OF LADING)', 'accessorial', 'gardewine_2025'),
  e('WEIGHING AND REWEIGHING', 'accessorial', 'gardewine_2025'),
  e('PALLET RETURNS (EXCLUDING C.P.C. OR CHEP PALLETS)', 'accessorial', 'gardewine_2025'),
  e('C.P.C. OR CHEP PALLET RETURNS', 'accessorial', 'gardewine_2025'),
  e('DETENTION - VEHICLES WITH POWER UNITS', 'detention', 'dohrn_2025'),
  e('DETENTION-TRUCKLOAD SHIPMENTS', 'detention', 'dohrn_2025'),
  e('DETENTION-VEHICLES WITHOUT POWER UNITS', 'detention', 'dohrn_2025'),
  e('BLIND SHIPMENT CHARGE', 'accessorial', 'dohrn_2025'),
  e('BILLS OF LADING CORRECTION', 'accessorial', 'dohrn_2025'),
  e('COLLECT ON DELIVERY (COD) SHIPMENTS', 'accessorial', 'dohrn_2025'),
  e('DELIVERY SERVICE TO DISTRIBUTION CENTERS', 'accessorial', 'dohrn_2025'),
  e('DIVERSION OR RECONSIGNMENT OF FREIGHT', 'accessorial', 'dohrn_2025'),
  e('EXCLUSIVE USE OF VEHICLE', 'accessorial', 'dohrn_2025'),
  e('EXPEDITED SERVICE', 'accessorial', 'dohrn_2025'),
  e('GROCERY WAREHOUSE, DISTRIBUTION CENTER, LUMPER SERVICE, AND NO SERVICE LOCATIONS', 'accessorial', 'dohrn_2025'),
  e('HAZARDOUS MATERIALS CHARGE', 'accessorial', 'dohrn_2025'),
  e('HYDRAULIC LIFTGATE SERVICE', 'accessorial', 'dohrn_2025'),
  e('INSIDE PICK UP OR DELIVERY SERVICE or HANDLING FREIGHT NOT ADJACENT TO VEHICLE', 'accessorial', 'dohrn_2025'),
  e('INTERNATIONAL SECURITY SURCHARGE', 'accessorial', 'dohrn_2025'),
  e('MARKING OR TAGGING FREIGHT', 'accessorial', 'dohrn_2025'),
  e('Mackinac Bridge Charge', 'accessorial', 'dohrn_2025'),
  e('Manhatten Island Congestion Charge', 'accessorial', 'dohrn_2025'),
  e('NOTIFICATION PRIOR TO DELIVERY', 'accessorial', 'dohrn_2025'),
  e('OVER DIMENSION FREIGHT', 'accessorial', 'dohrn_2025'),
  e('PALLET INTERCHANGE CHARGE', 'accessorial', 'dohrn_2025'),
  e('PICK UP OR DELIVERY AT PRIVATE RESIDENCE OR LIMITED ACCESS LOCATION', 'accessorial', 'dohrn_2025'),
  e('PROTECTIVE SERVICE- PROTECT FROM FREEZING', 'accessorial', 'dohrn_2025'),
  e('REDELIVERY', 'accessorial', 'dohrn_2025'),
  e('REWEIGH AND INSPECTION', 'accessorial', 'dohrn_2025'),
  e('SORT AND SEGREGATE SERVICE', 'accessorial', 'dohrn_2025'),
  e('SPECIAL SERVICES - WEEKENDS, HOLIDAYS - HOURLY RATES / EXTRA LABOR', 'accessorial', 'dohrn_2025'),
  e('STOPPING OF TRUCKLOAD FOR PARTIAL LOADING OR PARTIAL UNLOADING', 'accessorial', 'dohrn_2025'),
  e('STORAGE', 'accessorial', 'dohrn_2025'),
  e('VEHICLE ORDERED BUT NOT USED', 'accessorial', 'dohrn_2025'),
  e('Detention With Power', 'detention', 'states_2023'),
  e('Detention Without Power', 'detention', 'states_2023'),
  e('Advancing Charges', 'accessorial', 'states_2023'),
  e('Arrival Notification and Appointment Delivery', 'accessorial', 'states_2023'),
  e('Bills of Lading Corrected', 'accessorial', 'states_2023'),
  e('Blind Shipment', 'accessorial', 'states_2023'),
  e('CA Compliance Fee', 'accessorial', 'states_2023'),
  e('Certified Weight Receipt', 'accessorial', 'states_2023'),
  e('Collect On Delivery (COD) Shipments', 'accessorial', 'states_2023'),
  e('Convention Centers', 'accessorial', 'states_2023'),
  e('Cross Border Administration', 'accessorial', 'states_2023'),
  e('Excess Value / Ad Valorem', 'accessorial', 'states_2023'),
  e('Exclusive Use and Control of Vehicle', 'accessorial', 'states_2023'),
  e('Lumper Charges/Sort & Seg', 'accessorial', 'states_2023'),
  e('Loading or Unloading, Extra Labor', 'accessorial', 'states_2023'),
  e('Expedited Delivery', 'accessorial', 'states_2023'),
  e('Guaranteed Delivery', 'accessorial', 'states_2023'),
  e('Inside Delivery', 'accessorial', 'states_2023'),
  e('Liftgate Service', 'accessorial', 'states_2023'),
  e('Detention - With Power', 'detention', 'xpo_2025'),
  e('Detention - Without Power', 'detention', 'xpo_2025'),
  e('Fuel Surcharge', 'fuel', 'xpo_2025'),
  e('Base Rates', 'linehaul', 'xpo_2025'),
  e('Appointment', 'accessorial', 'xpo_2025'),
  e('Blind Shipments', 'accessorial', 'xpo_2025'),
  e('C.O.D Shipments (including Order Notify)', 'accessorial', 'xpo_2025'),
  e('Construction and Utility Sites Pickup or Delivery', 'accessorial', 'xpo_2025'),
  e('Customs Broker Service', 'accessorial', 'xpo_2025'),
  e('Diversion to another Carrier', 'accessorial', 'xpo_2025'),
  e('Excessive Length Shipments', 'accessorial', 'xpo_2025'),
  e('Excessive Value/Liability Charge', 'accessorial', 'xpo_2025'),
  e('Exclusive Use', 'accessorial', 'xpo_2025'),
  e('Exhibition or Trade Show Shipments - Pickup or Delivery', 'accessorial', 'xpo_2025'),
  e('Extra Labor', 'accessorial', 'xpo_2025'),
  e('Freezable Protection', 'accessorial', 'xpo_2025'),
  e('Government Sites, Airports, Mines, Natural Gas, Oil Fields Pickup or Delivery', 'accessorial', 'xpo_2025'),
  e('Grocery Consolidation Service', 'accessorial', 'xpo_2025'),
  e('Guaranteed by Noon Service (G!12)', 'accessorial', 'xpo_2025'),
  e('Guaranteed Service (G!)', 'accessorial', 'xpo_2025'),
  e('Hazardous and Radioactive Materials', 'accessorial', 'xpo_2025'),
  e('High Cost Surcharge', 'accessorial', 'xpo_2025'),
  e('US-Canada Border Crossing Service Fee', 'accessorial', 'xpo_2025'),
  e('In Bond Freight - United States', 'accessorial', 'xpo_2025'),
  e('Inside Pick-up or Delivery', 'accessorial', 'xpo_2025'),
  e('Late Payment Charge', 'accessorial', 'xpo_2025'),
  e('Liftgate Service', 'accessorial', 'xpo_2025'),
  e('Loading/Unloading by Carrier', 'accessorial', 'xpo_2025'),
  e('Lumper Service Fee', 'accessorial', 'xpo_2025'),
  e('Must Arrive By Date Service', 'accessorial', 'xpo_2025'),
  e('Notification Prior to Delivery', 'accessorial', 'xpo_2025'),
  e('Palletizing, Sorting or Segregating', 'accessorial', 'xpo_2025'),
  e('Reconsignment or Diversion', 'accessorial', 'xpo_2025'),
  e('Redelivery', 'accessorial', 'xpo_2025'),
  e('Re-Labeling', 'accessorial', 'xpo_2025'),
  e('Remote Charge', 'accessorial', 'xpo_2025'),
  e('Removal of Pallet, Shrink Wrap, or other Debris', 'accessorial', 'xpo_2025'),
  e('Residential and Limited Access Pickup or Delivery', 'accessorial', 'xpo_2025'),
  e('Returned Check Fee', 'accessorial', 'xpo_2025'),
  e('Returned Undelivered Shipments', 'accessorial', 'xpo_2025'),
  e('Saturdays, Sundays, Holidays or After Business Hours Pickup or Delivery', 'accessorial', 'xpo_2025'),
  e('Storage', 'accessorial', 'xpo_2025'),
  e('Sufferance Warehouse Charges - Canada', 'accessorial', 'xpo_2025'),
  e('BILL OF LADING - CORRECTED', 'accessorial', 'estes_2025'),
  e('CALIFORNIA COMPLIANCE SURCHARGE', 'accessorial', 'estes_2025'),
  e('CANADIAN/MEXICAN BORDER PROCESSING FEE', 'accessorial', 'estes_2025'),
  e('COLLECT ON DELIVERY SHIPMENTS', 'accessorial', 'estes_2025'),
  e('CUSTOMS OR IN-BOND FREIGHT', 'accessorial', 'estes_2025'),
  e('CUSTOMS SUFFERANCE WAREHOUSE CLEARANCE', 'accessorial', 'estes_2025'),
  e('DANGEROUS ARTICLES', 'accessorial', 'estes_2025'),
  e('DETENTION (WITH POWER UNITS)', 'detention', 'estes_2025'),
  e('DETENTION (WITHOUT POWER UNITS)', 'detention', 'estes_2025'),
  e('DIVERSION - MOTOR TO AIR TRANSPORTATION', 'accessorial', 'estes_2025'),
  e('DIVERSION TO ANOTHER CARRIER', 'accessorial', 'estes_2025'),
  e('ESTES RETAIL GUARANTEED', 'accessorial', 'estes_2025'),
  e('EXHIBITION OR TRADE SHOW SHIPMENTS', 'accessorial', 'estes_2025'),
  e('EXTRA LABOR-LOADING OR UNLOADING', 'accessorial', 'estes_2025'),
  e('HAZARDOUS MATERIALS TRANSPORT', 'accessorial', 'estes_2025'),
  e('HIGH VALUE COVERAGE', 'accessorial', 'estes_2025'),
  e('LIFTGATE', 'accessorial', 'estes_2025'),
  e('LIMITED ACCESS LOCATIONS', 'accessorial', 'estes_2025'),
  e('MARKING OR TAGGING FREIGHT', 'accessorial', 'estes_2025'),
  e('MEXICAN BORDER DRAYAGE', 'accessorial', 'estes_2025'),
  e('NOTIFICATION PRIOR TO DELIVERY/SCHEDULED APPT.', 'accessorial', 'estes_2025'),
  e('OVERLENGTH CHARGE', 'accessorial', 'estes_2025'),
  e("PICKUP FROM CARRIER'S DOCK", 'accessorial', 'estes_2025'),
  e('PORT PICKUP/DELIVERY', 'accessorial', 'estes_2025'),
  e('POSITIONS NOT IMMEDIATELY ADJACENT TO VEHICLE', 'accessorial', 'estes_2025'),
  e('PROTECTION FROM FREEZING SERVICE', 'accessorial', 'estes_2025'),
  e('REDELIVERY', 'accessorial', 'estes_2025'),
  e('REMOTE LOCATIONS/HIGH COST DELIVERY SURCHARGE', 'accessorial', 'estes_2025'),
  e('RESIDENTIAL PICKUP/DELIVERY', 'accessorial', 'estes_2025'),
]);
