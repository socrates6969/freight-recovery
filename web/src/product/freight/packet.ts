/**
 * Markdown evidence packet of the public freight check. Untrusted text (descriptions, names) goes through the
 * shared sanitizers; amounts are the engine's exact decimal strings.
 */
import { md, plain } from '@fr/shared/text-sanitize';

import type { FreightOutcome } from './model';

export const APP_DISCLAIMER =
  'Generated in your browser by scoup.ai from the values you entered. Findings are fixed-rule checks for human review, not verified results, and not legal or financial advice. Nothing was uploaded or stored.';

/** A finding's confidence is a fixed per-rule setting, not a measured probability. */
export function confidenceText(confidence: number): string {
  return `rule setting ${confidence.toFixed(2)} (fixed per rule; not a measured probability)`;
}

const na = (v: string | null): string => (v === null || v === '' ? 'N/A' : md(v));

export function renderFreightPacket(o: FreightOutcome): string {
  const { bundle, result } = o;
  const inv = bundle.invoice;
  const rc = bundle.rate_confirmation;
  const bol = bundle.bol;
  const out: string[] = [
    `# scoup.ai freight invoice check - Load ${na(inv?.load_number ?? rc?.load_number ?? null)}`,
    '',
    `> ${APP_DISCLAIMER}`,
    '',
    `**Generated:** ${o.generatedAt}  `,
    `**Perspective:** ${result.perspective}  `,
    `**Rules:** rules-v1, detention increment ${o.settings.detentionIncrementMinutes} min, tolerance $${o.settings.amountTolerance}  `,
    `**Confirmed findings (pre-review estimate):** $${result.recoverable_total}  `,
    `**Pending human review (not claimed):** $${result.pending_review_total}`,
    '',
    '## Inputs',
    '',
    '### Invoice',
    `- Invoice number: ${na(inv?.invoice_number ?? null)}; date: ${na(inv?.invoice_date ?? null)}`,
    `- Carrier: ${na(inv?.carrier ?? null)}; shipper: ${na(inv?.shipper ?? null)}`,
    `- Total on invoice: ${inv?.total ? `$${inv.total}` : 'N/A'}`,
    '',
    '| # | Description | Amount |',
    '|--:|---|--:|',
  ];
  (inv?.lines ?? []).forEach((l, i) => out.push(`| ${i + 1} | ${md(l.description)} | $${l.amount} |`));
  out.push('', '### Rate confirmation');
  if (rc) {
    out.push(
      `- Linehaul rate: ${rc.linehaul_rate ? `$${rc.linehaul_rate}` : 'N/A'}; fuel surcharge: ${rc.fuel_surcharge ? `$${rc.fuel_surcharge}` : 'N/A'}`,
      `- Detention: ${rc.detention_free_hours ?? 'N/A'} free hour(s), $${rc.detention_rate_per_hour ?? 'N/A'} per hour, maximum ${rc.detention_max_hours ?? 'N/A'} hour(s)`,
      `- Authorized accessorials: ${rc.authorized_accessorials.length ? rc.authorized_accessorials.map((a) => md(a)).join(', ') : 'none listed'}`,
    );
  } else out.push('- Not provided.');
  out.push('', '### Time records');
  if (bol) {
    out.push(
      `- Facility: ${na(bol.facility)}`,
      `- Appointment: ${na(bol.appointment_time)}; arrival: ${na(bol.arrival_time)}; departure: ${na(bol.departure_time)}`,
    );
  } else out.push('- Not provided (detention was not recomputed).');

  out.push('', '## Findings');
  if (result.findings.length === 0) out.push('No findings for this perspective.');
  result.findings.forEach((f, i) => {
    out.push(
      '',
      `### ${i + 1}. ${md(f.title)} - $${f.amount}${f.needs_human_review ? ' **[needs human review]**' : ''}`,
      `Rule \`${plain(f.rule_id)}\`, ${confidenceText(f.confidence)}. ${md(f.explanation, 600)}`,
    );
    if (f.calculation.length > 0) {
      out.push('', 'Calculation:');
      for (const step of f.calculation) out.push(`- ${md(step, 400)}`);
    }
  });
  if (result.ignored_findings.length > 0) {
    out.push('', '## Findings in the other direction (not counted)');
    result.ignored_findings.forEach((f) => out.push(`- ${md(f.title)}: $${f.amount} (${f.direction}, rule \`${plain(f.rule_id)}\`)`));
  }
  out.push('', '## Draft letter', '', '```', o.letter, '```', '');
  return out.join('\n');
}