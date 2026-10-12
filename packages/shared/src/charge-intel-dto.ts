/**
 * Step 6 charge intelligence contract (REQ-20261011-charge-intelligence, Part C C6 and C11): strict
 * request schemas, strict response schemas and the evaluation report. Exported from the package root;
 * imports no seed data and no classifier code.
 */
import { z } from 'zod';

import { normText } from './analysis/py-text.js';
import { CHARGE_CATEGORIES, CHARGE_CLASSIFIER_VERSION, SEED_VERSION, SUGGESTION_THRESHOLD } from './charge-intel/constants.js';
import { isDecimalString } from './decimal.js';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, singleLine } from './dto.js';

/** Bounds of a label description and of its normalized text. */
export const CHARGE_LABEL_TEXT_MAX = 200;

const uuid = z.uuid();
const count = z.int().min(0);
const intFromQuery = z.coerce.number().int();
const evalCategories = ['detention', 'linehaul', 'fuel', 'accessorial'] as const;

export const ChargeCategorySchema = z.enum(CHARGE_CATEGORIES);

export const NearestExample = z.strictObject({
  text: z.string(),
  category: ChargeCategorySchema,
  origin: z.enum(['seed', 'tenant']),
  source: z.string().nullable(),
  sourceLabel: z.string(),
  labelId: z.string().nullable(),
});
export type NearestExample = z.infer<typeof NearestExample>;

export const ChargeSuggestion = z.strictObject({
  category: ChargeCategorySchema.nullable(),
  similarity: z.number().min(0).max(1),
  abstained: z.boolean(),
  reason: z.enum(['empty', 'no_match', 'below_threshold']).nullable(),
  nearest: NearestExample.nullable(),
});
export type ChargeSuggestion = z.infer<typeof ChargeSuggestion>;

export const ChargeLineView = z.strictObject({
  index: z.int().min(0),
  description: z.string(),
  amount: z.string().refine(isDecimalString, { message: 'not a decimal string' }),
  ruleCategory: ChargeCategorySchema,
  suggestion: ChargeSuggestion,
  label: z.strictObject({ id: uuid, category: ChargeCategorySchema }).nullable(),
});
export type ChargeLineViewDto = z.infer<typeof ChargeLineView>;

export const ChargeLinesResponse = z.strictObject({
  claimId: uuid,
  classifierVersion: z.literal(CHARGE_CLASSIFIER_VERSION),
  seedVersion: z.literal(SEED_VERSION),
  threshold: z.literal(SUGGESTION_THRESHOLD),
  lines: z.array(ChargeLineView),
  // Hardening (REQ-20261012-hardening, C3): team labels recorded by the claim's analysis (null: not analysed).
  influence: z
    .strictObject({
      labels: z.array(z.strictObject({ labelId: uuid, description: z.string().nullable(), category: ChargeCategorySchema.nullable() })),
    })
    .nullable(),
});
export type ChargeLinesResponseDto = z.infer<typeof ChargeLinesResponse>;

export const SetChargeLabelBody = z.strictObject({
  description: singleLine(1, CHARGE_LABEL_TEXT_MAX).refine(
    (v) => {
      const n = normText(v);
      return n !== '' && n.length <= CHARGE_LABEL_TEXT_MAX;
    },
    { message: 'description has no letters or digits' },
  ),
  category: ChargeCategorySchema,
});
export type SetChargeLabelInput = z.output<typeof SetChargeLabelBody>;

export const ChargeLabel = z.strictObject({
  id: uuid,
  description: z.string(),
  normalizedText: z.string(),
  category: ChargeCategorySchema,
  version: z.int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ChargeLabelDto = z.infer<typeof ChargeLabel>;

export const SetChargeLabelResponse = z.strictObject({
  label: ChargeLabel,
  outcome: z.enum(['created', 'changed', 'unchanged']),
});
export type SetChargeLabelResponseDto = z.infer<typeof SetChargeLabelResponse>;

export const ChargeLabelsQuery = z.strictObject({
  page: intFromQuery.min(1).default(1),
  pageSize: intFromQuery.min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export type ChargeLabelsQueryInput = z.output<typeof ChargeLabelsQuery>;

export const ChargeLabelsList = z.strictObject({
  items: z.array(ChargeLabel),
  page: z.int().min(1),
  pageSize: z.int().min(1).max(PAGE_SIZE_MAX),
  total: count,
});
export type ChargeLabelsListDto = z.infer<typeof ChargeLabelsList>;

const byCategory = <T extends z.ZodType>(s: T) =>
  z.strictObject({ detention: s, linehaul: s, fuel: s, accessorial: s });

export const ChargeEvalReport = z.strictObject({
  evaluation: z.literal('leave-one-carrier-out'),
  classifierVersion: z.literal(CHARGE_CLASSIFIER_VERSION),
  seedVersion: z.literal(SEED_VERSION),
  threshold: z.literal(SUGGESTION_THRESHOLD),
  note: z.string(),
  examples: count,
  carriers: count,
  top1: z.strictObject({ correct: count, total: count, byCategory: byCategory(z.strictObject({ correct: count, total: count })) }),
  atThreshold: z.strictObject({
    suggested: count,
    correct: count,
    wrong: count,
    abstained: count,
    byCategory: byCategory(z.strictObject({ recognised: count, abstained: count, wrong: count, total: count })),
  }),
  distinctName: z.strictObject({ top1Correct: count, suggested: count, correct: count, wrong: count, abstained: count, accessorialRecognised: count }),
  keywordBaseline: z.strictObject({ correct: count, accessorialRecognised: count }),
  pipelineAccessorialCovered: count,
  perCarrier: z.array(
    z.strictObject({
      source: z.string(),
      label: z.string(),
      examples: count,
      top1Correct: count,
      accessorialTotal: count,
      accessorialTop1: count,
      accessorialRecognised: count,
      abstained: count,
      wrongSuggested: count,
    }),
  ),
  errors: z.array(
    z.strictObject({
      text: z.string(),
      source: z.string(),
      expected: z.enum(evalCategories),
      predicted: ChargeCategorySchema.nullable(),
      similarity: z.number().min(0).max(1),
      nearestText: z.string().nullable(),
      nearestSource: z.string().nullable(),
      suggested: z.boolean(),
    }),
  ),
});
export type ChargeEvalReportDto = z.infer<typeof ChargeEvalReport>;
