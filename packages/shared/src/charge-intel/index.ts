/**
 * `@fr/shared/charge-intel` (REQ-20261011-charge-intelligence): the step-6 charge classifier, its
 * attributed seed set, the learned analysis layer and the leave-one-carrier-out evaluation. The package
 * root re-exports only the constants, copy and DTOs (the seed and the classifier stay out of the web
 * bundle).
 */
export * from './constants.js';
export * from './copy.js';
export * from '../charge-intel-dto.js';
/** The step-5 `normText` (label keys are `normText(description)`). */
export { normText } from '../analysis/py-text.js';
export { SEED_SOURCES, SEED_V1, type SeedExample, type SeedSource, type SeedSourceId } from './seed-v1.js';
export { chargeFeatures, featureDot, featureNorm2, featureText, type ChargeFeatures } from './features.js';
export {
  TENANT_LABEL_SOURCE_LABEL,
  accepts,
  beats,
  buildChargeClassifier,
  buildChargeClassifierByScan,
  formatSimilarity,
  rankNearest,
  rawSimilarity,
  roundSimilarity,
  seedExamples,
  similarityText,
  type ChargeClassifier,
  type ChargeExample,
  type TenantLabelInput,
} from './classifier.js';
export { evaluateLeaveOneCarrierOut, type ChargeEvalReportData } from './evaluate.js';
export {
  LEARNED_CONFIDENCE,
  applyLearning,
  buildEvidenceLearned,
  type AnalysisFinding,
  type LearnedEvidence,
  type LearnedOutcome,
  type LearnedRecoveryResult,
} from './learned.js';
