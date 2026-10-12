/**
 * `@fr/shared/analysis`: the step-5 rules engine and evidence renderers (TypeScript port of the Python
 * reference `freight_recovery.rules` / `freight_recovery.evidence`, byte-level parity on the domain of
 * Part C P6). Pure: no Node built-ins, no Zod, no floating-point money arithmetic.
 */
export {
  AnalysisInputError,
  DEFAULT_ANALYSIS_SETTINGS,
  RULES_VERSION,
  RULE_IDS,
  type AnalysisPerspective,
  type AnalysisSettings,
  type DetentionCalc,
  type EvidenceDoc,
  type FindingDirection,
  type LineClass,
  type RecoveryResult,
  type RuleFinding,
  type RuleId,
} from './types.js';
export { applyRules, applyRulesTraced, computeDetention, type TracedResult } from './engine.js';
export { classifyLine, type FindingTrace } from './invoice-checks.js';
export { DRAFT_BANNER, buildDemandLetter } from './letter.js';
export { PACKET_DISCLAIMER, renderPacketMarkdown } from './markdown.js';
export { buildEvidence, buildEvidenceTraced, packetLoadNumber, type Evidence } from './evidence.js';
export { ANALYSIS_NOTE, ANALYSIS_TEXT, ANALYZE_AUTHOR_NOTE } from './copy.js';
export { LocalDateTime } from './local-datetime.js';
// Step 6 (REQ-20261011-charge-intelligence, S2): tariff-style detention calculator (RD10; not wired in yet).
export { computeTariffDetention, type TariffDetentionResult, type TariffDetentionTerms } from './tariff-detention.js';
