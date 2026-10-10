/**
 * Port of `freight_recovery/evidence/letter.py` (spec A5): the deterministic DRAFT demand letter. Only
 * confirmed findings (not needing human review) are listed and counted. Untrusted text goes through
 * `plain`. Never sent by the system.
 */
import type { ExtractedBundle } from '../extraction.js';
import { plain } from '../text-sanitize.js';

import type { RecoveryResult } from './types.js';

export const DRAFT_BANNER = 'DRAFT - FOR HUMAN REVIEW. NOT SENT. NOT LEGAL ADVICE.';

const TODAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const EXPLANATION_LIMIT = 600;

/** `build_demand_letter(bundle, result, today, window_days)`; `today` is `YYYY-MM-DD`. */
export function buildDemandLetter(bundle: ExtractedBundle, result: RecoveryResult, today: string, windowDays = 90): string {
  if (!TODAY.test(today)) throw new RangeError('today must be YYYY-MM-DD');
  const inv = bundle.invoice;
  // Python `x or "N/A"`: an empty string counts as missing.
  const load = plain(inv?.load_number || 'N/A');
  const invNo = plain(inv?.invoice_number || 'N/A');
  const carrier = plain(inv?.carrier || 'Carrier');
  const shipper = plain(inv?.shipper || 'Shipper');
  const confirmed = result.findings.filter((f) => !f.needs_human_review);

  let to: string;
  let from: string;
  let ask: string;
  let intro: string;
  if (result.perspective === 'shipper') {
    to = carrier;
    from = shipper;
    ask = `We request a credit or refund of $${result.recoverable_total} against invoice ${invNo} (load ${load}).`;
    intro = 'Our audit of the above invoice against the signed rate confirmation and delivery records found the following billing discrepancies:';
  } else {
    to = shipper;
    from = carrier;
    ask = `We request payment of $${result.recoverable_total} in accessorial/detention charges for load ${load} (reference invoice ${invNo}).`;
    intro = 'Delivery records and the signed rate confirmation support the following charges that were not billed or were under-billed:';
  }

  const lines = [DRAFT_BANNER, '', `Date: ${today}`, `To: ${to}`, `From: ${from}`, `Re: Load ${load} / Invoice ${invNo} - billing dispute`, '', intro, ''];
  confirmed.forEach((f, i) => {
    lines.push(`${i + 1}. ${plain(f.title)}: $${f.amount}`);
    lines.push(`   ${plain(f.explanation, EXPLANATION_LIMIT)}`);
  });
  if (confirmed.length === 0) {
    lines.push('(No confirmed discrepancies. Do not send; items below the review threshold are listed only in the internal evidence packet.)');
    ask = 'No amount is requested: there are no confirmed findings.';
  }
  lines.push(
    '',
    ask,
    'Supporting documents and calculations are attached in the evidence packet.',
    `Please respond within 30 days. (Reminder for sender: confirm the contractual dispute window - assumed ${windowDays} days from invoice date; verify before sending.)`,
    '',
    'Sincerely,',
    '[Name / Title / Contact - to be completed by sender]',
  );
  return lines.join('\n');
}
