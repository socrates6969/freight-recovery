/**
 * Port of `build_packet` in `freight_recovery/evidence/packet.py` (spec A5): rules result, load number,
 * draft letter and Markdown for one bundle. The letter date is the UTC date of `now` (RD6).
 */
import type { ExtractedBundle } from '../extraction.js';

import { applyRulesTraced } from './engine.js';
import type { FindingTrace } from './invoice-checks.js';
import { buildDemandLetter } from './letter.js';
import { PACKET_DISCLAIMER, renderPacketMarkdown } from './markdown.js';
import type { AnalysisPerspective, AnalysisSettings, EvidenceDoc, RecoveryResult } from './types.js';

export interface Evidence {
  load_number: string | null;
  perspective: AnalysisPerspective;
  generated_at: string;
  documents: EvidenceDoc[];
  result: RecoveryResult;
  demand_letter: string;
  markdown: string;
  disclaimer: string;
}

/** First non-empty load number of invoice, rate confirmation, bill of lading (Python `next(...)`). */
export function packetLoadNumber(bundle: ExtractedBundle): string | null {
  for (const x of [bundle.invoice, bundle.rate_confirmation, bundle.bol]) if (x !== null && x.load_number) return x.load_number;
  return null;
}

/** `YYYY-MM-DD` of an instant in UTC. */
export function utcDate(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new RangeError('invalid date');
  return now.toISOString().slice(0, 10);
}

/** buildEvidence plus the per-finding traces (aligned with `result.findings`) used for citations. */
export function buildEvidenceTraced(
  docs: readonly EvidenceDoc[],
  bundle: ExtractedBundle,
  perspective: AnalysisPerspective,
  settings: AnalysisSettings,
  now: Date,
): { evidence: Evidence; traces: FindingTrace[] } {
  const { result, traces } = applyRulesTraced(bundle, perspective, settings);
  const load = packetLoadNumber(bundle);
  const letter = buildDemandLetter(bundle, result, utcDate(now), settings.disputeWindowDays);
  return {
    evidence: {
      load_number: load,
      perspective: result.perspective,
      generated_at: now.toISOString(),
      documents: [...docs],
      result,
      demand_letter: letter,
      markdown: renderPacketMarkdown(load, result.perspective, docs, bundle, result, letter),
      disclaimer: PACKET_DISCLAIMER,
    },
    traces,
  };
}

/** `build_packet`: result, letter and Markdown for one bundle. */
export function buildEvidence(docs: readonly EvidenceDoc[], bundle: ExtractedBundle, perspective: AnalysisPerspective, settings: AnalysisSettings, now: Date): Evidence {
  return buildEvidenceTraced(docs, bundle, perspective, settings, now).evidence;
}
