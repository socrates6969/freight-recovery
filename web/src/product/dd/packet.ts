/** Markdown packet of the public D&D audit. Untrusted text goes through the shared sanitizers. */
import { DD_CHECK_LABELS, DD_CHECK_STATUS_LABELS, DD_PACKET_DISCLAIMER } from '@fr/shared';
import { md, plain } from '@fr/shared/text-sanitize';

import { confidenceText } from '../freight/packet';
import { reasonText } from './DdResults';

import type { DdOutcome } from './model';

export function renderDdPacket(o: DdOutcome): string {
  const { invoice, result } = o;
  const out: string[] = [
    `# scoup.ai ocean D&D audit - Invoice ${md(invoice.invoiceNumber)}`,
    '',
    `> ${DD_PACKET_DISCLAIMER} Generated in your browser; nothing was uploaded or stored.`,
    '',
    `**Generated:** ${o.generatedAt}  `,
    `**Billing party:** ${md(invoice.billingPartyName)} (${invoice.billingPartyType}); **billed party:** ${md(invoice.billedPartyName)}  `,
    `**Invoice date:** ${invoice.invoiceDate ?? 'N/A'}; **due:** ${invoice.dueDate ?? 'N/A'}; **total due:** ${invoice.totalDue ? `$${invoice.totalDue}` : 'N/A'}  `,
    `**Tariff:** ${o.tariff ? `${md(o.tariff.data.name)} (${md(o.tariff.provenance.document)}, retrieved ${o.tariff.provenance.retrieved})` : 'none attached'}  `,
    `**Rules:** ${result.rulesVersion}  `,
    `**Confirmed findings (pre-review estimate):** $${result.recoverable}  `,
    `**Pending human review (not claimed):** $${result.pendingReview}`,
    '',
    '## Checks',
    '',
    '| Check | Container | Status | Reason |',
    '|---|---|---|---|',
  ];
  for (const c of result.checks) {
    out.push(`| ${DD_CHECK_LABELS[c.id]} | ${c.containerIndex === null ? 'invoice' : `#${c.containerIndex + 1}`} | ${DD_CHECK_STATUS_LABELS[c.status]} | ${c.reason ? md(reasonText(c.reason) ?? '') : ''} |`);
  }
  out.push('', '## Containers', '', '| # | Container | Type | Size | Charged | Tariff expected | Free time end | Chargeable days |', '|--:|---|---|---|--:|--:|---|--:|');
  for (const c of result.containers) {
    const cents = (v: number | null): string => (v === null ? 'n/a' : `$${(v / 100).toFixed(2)}`);
    out.push(`| ${c.index + 1} | ${md(c.label)} | ${c.chargeType} | ${c.sizeType} | ${cents(c.chargedCents)} | ${cents(c.expectedCents)} | ${c.freeTimeEnd ?? 'n/a'} | ${c.chargeableDays ?? 'n/a'} |`);
  }
  out.push('', '## Findings');
  if (result.findings.length === 0) out.push('No findings.');
  result.findings.forEach((f, i) => {
    out.push('', `### ${i + 1}. ${md(f.title)} - $${f.amount}${f.needsHumanReview ? ' **[needs human review]**' : ''}`, `Rule \`${plain(f.ruleId)}\`, ${confidenceText(f.confidence)}. ${md(f.explanation, 600)}`);
    if (f.calculation.length > 0) {
      out.push('', 'Calculation:');
      for (const step of f.calculation) out.push(`- ${md(step, 400)}`);
    }
    if (f.citations.length > 0) {
      out.push('', 'Cited values:');
      for (const c of f.citations) out.push(`- ${c.source} \`${plain(c.pointer)}\`: ${md(c.excerpt)}`);
    }
    if (f.clause) out.push('', `Clause (${f.clause.source}, ${md(f.clause.label)}): ${md(f.clause.excerpt, 400)}`);
  });
  out.push('', '## Draft letter', '', '```', o.letter, '```', '');
  return out.join('\n');
}