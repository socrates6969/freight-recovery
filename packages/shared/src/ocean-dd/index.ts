/**
 * Step 8 (REQ-20261011-ocean-dd): ocean demurrage and detention invoice audit. Pure, deterministic functions
 * (no clock, network, files or environment), exported from the `@fr/shared` root (Part C C1).
 */
export * from './constants.js';
export {
  DD_DAY_MAX,
  DD_DAY_MIN,
  ddAddDays,
  ddDateFromDayNumber,
  ddDayNumber,
  ddDaysBetween,
  ddIsoWeekday,
  isDdDate,
} from './dates.js';
export { computeFreeTimeEnd, computeTariffCharge, ddDateList, type DdChargeableDate, type DdTariffCharge, type DdTariffChargeArgs } from './tariff.js';
export {
  auditDdInvoice,
  ddContainerLabel,
  ddExcerpt,
  resolveDdPointer,
  type DdAuditInput,
  type DdCitationSource,
} from './audit.js';
export { buildDdDisputeLetter } from './letter.js';
export { DD_CSV_COLUMNS, parseDdCsv, type DdCsvColumn, type DdCsvError, type DdCsvResult } from './csv.js';
export { DD_TARIFF_PRESETS, type DdTariffPreset, type DdTariffPresetProvenance } from './presets.js';
export { DD_REGULATION_TEXT, type DdRegulationKey } from './regulation.js';
export * from './copy.js';
