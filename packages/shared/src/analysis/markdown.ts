/**
 * Port of `_render_markdown` in `freight_recovery/evidence/packet.py` (spec A5). Untrusted text goes
 * through `plain`/`md`. The API does not persist this rendering (it is compared with Python in parity).
 */
import type { ExtractedBundle } from '../extraction.js';
import { md, plain } from '../text-sanitize.js';

import type { AnalysisPerspective, EvidenceDoc, RecoveryResult } from './types.js';

export const PACKET_DISCLAIMER =
  'MVP / pre-product output. Extracted values and calculations are unverified against real customer data and must be reviewed by a person before any dispute is sent. This is not legal or financial advice.';

const SHA_LIMIT = 64;
const WARNING_LIMIT = 400;
const EXPLANATION_LIMIT = 600;
const STEP_LIMIT = 400;
/** Python `f"{c:.2f}"` of the fixed engine confidences. */
const CONFIDENCE_TEXT: ReadonlyMap<number, string> = new Map([
  [0.6, '0.60'],
  [0.85, '0.85'],
  [0.9, '0.90'],
  [0.95, '0.95'],
]);

function conf2(c: number): string {
  return CONFIDENCE_TEXT.get(c) ?? c.toFixed(2);
}

/** `_render_markdown(load, perspective, docs, bundle, result, letter)`. */
export function renderPacketMarkdown(
  load: string | null,
  perspective: AnalysisPerspective,
  docs: readonly EvidenceDoc[],
  bundle: ExtractedBundle,
  result: RecoveryResult,
  letter: string,
): string {
  const out = [
    `# Evidence Packet - Load ${md(load || 'N/A')}`,
    '',
    `> ${PACKET_DISCLAIMER}`,
    '',
    `**Perspective:** ${perspective}  `,
    `**Recoverable (confirmed findings only, pre-review estimate):** $${result.recoverable_total}  `,
    `**Pending human review (NOT claimed):** $${result.pending_review_total}`,
    '',
    '## Source documents',
  ];
  for (const d of docs) out.push(`- \`${plain(d.filename)}\` (${md(d.doc_type)}) sha256 \`${plain(d.sha256, SHA_LIMIT)}\``);
  if (bundle.warnings.length > 0) {
    out.push('', '## Extraction warnings');
    for (const w of bundle.warnings) out.push(`- ${md(w, WARNING_LIMIT)}`);
  }
  out.push('', '## Findings');
  if (result.findings.length === 0) out.push('No recoverable findings for this perspective.');
  result.findings.forEach((f, i) => {
    const review = f.needs_human_review ? ' **[needs human review]**' : '';
    out.push(
      `### ${i + 1}. ${md(f.title)} - $${f.amount}${review}`,
      `Rule \`${plain(f.rule_id)}\`, confidence ${conf2(f.confidence)}. ${md(f.explanation, EXPLANATION_LIMIT)}`,
      '',
      'Calculation:',
    );
    for (const step of f.calculation) out.push(`- ${md(step, STEP_LIMIT)}`);
    out.push('');
  });
  if (result.ignored_findings.length > 0) {
    out.push('## Other-direction findings (not included in total)');
    for (const f of result.ignored_findings) out.push(`- ${md(f.title)}: $${f.amount} (${f.direction})`);
    out.push('');
  }
  out.push('## Draft demand letter', '', '```', letter, '```', '');
  return out.join('\n');
}
