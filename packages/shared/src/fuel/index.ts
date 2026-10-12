/**
 * `@fr/shared/fuel` (REQ-20261011-fuel-outlook): the step-7 fuel-surcharge check. Fuel-table evaluation,
 * the week rule, `checkFuel` and `buildEvidenceFuel`. The package root re-exports only the constants,
 * copy and DTOs.
 */
export * from './constants.js';
export * from './copy.js';
export * from '../fuel-dto.js';
export * from '../outlook/constants.js';
export * from '../outlook/copy.js';
export * from '../outlook-dto.js';
export { DAY, addDays, applicablePosting, civilFromDays, fromDays, parseCivilDate, toDays, weekRuleText, weekdayIndex, type ApplicablePosting, type PostingObservation } from './week.js';
export { checkFscTableSpec, evaluateFscTable, expectedAmount, scaled, type FscEvaluation, type FscTableSpec } from './table.js';
export { checkFuel, computeFuelCheck, type FuelAnalysisFinding, type FuelCheckComputation, type FuelCheckInput } from './check.js';
export { buildEvidenceFuel, type FuelEvidence, type FuelEvidenceOutcome, type FuelRecoveryResult } from './evidence.js';
