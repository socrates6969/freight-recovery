/**
 * C7: the draft D&D dispute letter. Never sent automatically; every untrusted value passes through `plain`.
 */
import type { DdAuditResultDto, DdInvoiceDataDto } from '../ocean-dd-dto.js';
import { plain } from '../text-sanitize.js';

import { DD_DISPUTE_MIN_DAYS } from './constants.js';
import { ddAddDays, isDdDate } from './dates.js';

/** Cap of one B/L number in the Re line. */
const BL_LIMIT = 40;
/** Cap of a finding explanation in the letter. */
const EXPLANATION_LIMIT = 600;

/** C7: lines joined by `\n`. `today` must be a `YYYY-MM-DD` date, else RangeError. */
export function buildDdDisputeLetter(invoice: DdInvoiceDataDto, result: DdAuditResultDto, today: string): string {
  if (!isDdDate(today)) throw new RangeError('today must be a YYYY-MM-DD date');
  const bls = invoice.billOfLadingNumbers.length === 0 ? 'N/A' : invoice.billOfLadingNumbers.map((b) => plain(b, BL_LIMIT)).join(', ');
  const items: string[] = [];
  result.findings.forEach((f, i) => {
    items.push(`${i + 1}. ${plain(f.title)}: $${f.amount}${f.needsHumanReview ? ' (needs review)' : ''}`);
    items.push(`   ${plain(f.explanation, EXPLANATION_LIMIT)}`);
  });
  const deadline = (): string =>
    invoice.invoiceDate === null
      ? 'the invoice date is missing'
      : `based on the invoice date ${invoice.invoiceDate}, request by ${ddAddDays(invoice.invoiceDate, Math.max(DD_DISPUTE_MIN_DAYS, invoice.disputeRequestDays ?? 0))}`;
  const amounts =
    result.findings.length === 0
      ? ['No amount is requested: there are no findings.']
      : [
          `Confirmed amount: $${result.recoverable}. Amount for review: $${result.pendingReview}.`,
          'We request a credit, refund or waiver of these amounts. Supporting calculations are attached in the evidence packet.',
          'Under 46 CFR 541.8(b) the billing party must attempt to resolve the request "within thirty (30) calendar days of receiving such a request or at a later date as agreed upon by both parties."',
          `(Reminder for sender: remove items that do not apply. 46 CFR 541.8(a) allows at least 30 calendar days from the invoice date to request mitigation, refund or waiver; ${deadline()}. Check the dates before sending.)`,
        ];
  return [
    'DRAFT - FOR HUMAN REVIEW. NOT SENT. NOT LEGAL ADVICE.',
    '',
    `Date: ${today}`,
    `To: ${plain(invoice.billingPartyName)}`,
    `From: ${plain(invoice.billedPartyName)}`,
    `Re: Invoice ${plain(invoice.invoiceNumber)} / B/L ${bls} - request for fee mitigation, refund or waiver`,
    '',
    'We reviewed the above demurrage and detention invoice against 46 CFR Part 541, 46 CFR 545.5 and the applicable tariff, and ask you to review the following items:',
    '',
    ...(items.length === 0 ? ['(No items found. Do not send.)'] : items),
    '',
    ...amounts,
    '',
    'Sincerely,',
    '[Name / Title / Contact - to be completed by sender]',
  ].join('\n');
}
