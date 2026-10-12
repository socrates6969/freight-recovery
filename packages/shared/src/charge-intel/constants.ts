/**
 * Step 6 charge intelligence constants (REQ-20261011-charge-intelligence, Part C C1). Plain data, no
 * imports: exported from the package root (the web needs the categories and versions; the seed set
 * and the classifier stay behind the `@fr/shared/charge-intel` subpath).
 */

/** Version of the nearest-example charge classifier (char 3-5-grams + word tokens, cosine, 1-NN). */
export const CHARGE_CLASSIFIER_VERSION = 'charge-knn-v1';

/** Version of the seed label set (public carrier tariff charge names). */
export const SEED_VERSION = 'tariff-seed-v1';

/** Suggestion threshold tau = 3/10 (shown as 0.30). Decisions use the exact rational below. */
export const SUGGESTION_THRESHOLD = 0.3;
export const SUGGESTION_THRESHOLD_NUM = 3;
export const SUGGESTION_THRESHOLD_DEN = 10;

/** Charge categories (the step-5 `classifyLine` classes). */
export const CHARGE_CATEGORIES = Object.freeze(['detention', 'linehaul', 'fuel', 'accessorial', 'other'] as const);
export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number];

/**
 * Features use at most this many characters of the normalized text (fix round 1, S1): a longer invoice
 * description is classified by its first 200 normalized characters. Labels are <= 200 already.
 */
export const CHARGE_QUERY_TEXT_MAX = 200;

/**
 * At most this many influencing tenant label ids are reported per analysis (fix round 1, S3; the audit
 * sanitizer keeps 50 array items).
 */
export const LEARNED_LABEL_IDS_MAX = 50;

/** Labels per tenant (service check; bounds the CPU of one classification). */
export const CHARGE_LABELS_MAX = 2000;

/** Rule ids of findings produced by the learned layer (never by the step-5 rules). */
export const LEARNED_RULE_IDS = Object.freeze(['LRN-ACCESSORIAL-REVIEW'] as const);
export type LearnedRuleId = (typeof LEARNED_RULE_IDS)[number];

export function isChargeCategory(value: unknown): value is ChargeCategory {
  return typeof value === 'string' && (CHARGE_CATEGORIES as readonly string[]).includes(value);
}
