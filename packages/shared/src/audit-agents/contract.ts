/**
 * Contract and tariff agent: finds the contract, lane, fuel terms, accessorial schedule and detention
 * terms that govern one invoice, and maps each accessorial line to a schedule code. Lookups are
 * deterministic; the optional LLM is asked only to map a charge description that neither the printed code
 * nor the schedule names match, and it may answer only with a schedule code from the list (or null). Such a
 * mapping (`by: 'llm'`) is advisory: the audit checks treat the line as off-schedule, never as authorized.
 */
import { z } from 'zod';

import { classifyLine } from '../analysis/invoice-checks.js';
import { normText } from '../analysis/py-text.js';
import { addDays } from '../fuel/week.js';

import { askJson, fence, type LlmClient } from './llm.js';
import type { AppliedTerms, Contract, Lane, LineCode, NormalizedInvoice, NormalizedLine } from './types.js';

export type LineKind = 'linehaul' | 'fuel' | 'detention' | 'accessorial' | 'discount';

/** Kind of a billed line for the audit checks (the step-5 classifier plus LTL wording). */
export function lineKind(line: NormalizedLine): LineKind {
  if (line.amount.startsWith('-')) return 'discount';
  const d = normText(line.description);
  if (d.includes('minimum charge') || d.includes('freight charge') || d.includes('base rate')) return 'linehaul';
  const cls = classifyLine(line.description);
  if (cls === 'linehaul' || cls === 'fuel' || cls === 'detention') return cls;
  return 'accessorial';
}

const placeKey = (s: string | null): string => normText(s ?? '');

/** Contract for the invoice's carrier whose effective dates contain the ship date (else invoice date). */
export function selectContract(inv: NormalizedInvoice, contracts: readonly Contract[]): Contract | null {
  const day = inv.shipDate ?? inv.invoiceDate;
  const carrier = normText(inv.carrier);
  const scac = normText(inv.scac ?? '');
  return (
    contracts.find((c) => {
      const name = normText(c.carrier);
      return (name === carrier || (scac !== '' && name === scac)) && c.effectiveFrom <= day && day <= c.effectiveTo;
    }) ?? null
  );
}

export function selectLane(inv: NormalizedInvoice, contract: Contract): Lane | null {
  const o = placeKey(inv.origin);
  const d = placeKey(inv.destination);
  return contract.lanes.find((l) => l.mode === inv.mode && placeKey(l.origin) === o && placeKey(l.destination) === d) ?? null;
}

function mapByRules(line: NormalizedLine, contract: Contract): LineCode['by'] | null {
  const code = normText(line.code ?? '');
  if (code !== '' && contract.accessorials.some((a) => normText(a.code) === code)) return 'code';
  const d = normText(line.description);
  return contract.accessorials.some((a) => a.names.some((n) => d.includes(normText(n)))) ? 'keyword' : null;
}

function codeByRules(line: NormalizedLine, contract: Contract): string | null {
  const code = normText(line.code ?? '');
  const byCode = contract.accessorials.find((a) => normText(a.code) === code);
  if (code !== '' && byCode !== undefined) return byCode.code;
  const d = normText(line.description);
  return contract.accessorials.find((a) => a.names.some((n) => d.includes(normText(n))))?.code ?? null;
}

const CONTRACT_SYSTEM = [
  'You are the contract and tariff agent of a freight-invoice audit team.',
  'Map the charge description to exactly one accessorial code from the schedule, or null when none fits.',
  'Answer with JSON only: {"code": "<code from the list>" | null, "reason": "<one sentence>"}.',
].join(' ');

/** Run the contract and tariff agent. Returns null when no contract governs the invoice. */
export async function runContractAgent(
  inv: NormalizedInvoice,
  contracts: readonly Contract[],
  llm: LlmClient | null = null,
): Promise<AppliedTerms | null> {
  const contract = selectContract(inv, contracts);
  if (contract === null) return null;
  const warnings: string[] = [];
  const lane = selectLane(inv, contract);
  if (lane === null) warnings.push(`no ${inv.mode} lane in contract ${contract.id} for ${inv.origin ?? '?'} -> ${inv.destination ?? '?'}`);

  const codes = contract.accessorials.map((a) => a.code);
  const answer = z.strictObject({ code: z.enum(codes as [string, ...string[]]).nullable(), reason: z.string().max(400) });
  const lineCodes: LineCode[] = [];
  for (const [i, line] of inv.lines.entries()) {
    if (lineKind(line) !== 'accessorial') continue;
    const by = mapByRules(line, contract);
    if (by !== null) {
      lineCodes.push({ line: i, code: codeByRules(line, contract), by });
      continue;
    }
    const schedule = contract.accessorials.map((a) => `${a.code}: ${a.names.join(' / ')}`).join('\n');
    const llmAnswer =
      codes.length === 0
        ? null
        : await askJson(llm, { agent: 'contract', system: CONTRACT_SYSTEM, user: `Schedule:\n${schedule}\n\n${fence('CHARGE', line.description)}` }, answer);
    lineCodes.push(llmAnswer === null || llmAnswer.code === null ? { line: i, code: null, by: 'none' } : { line: i, code: llmAnswer.code, by: 'llm' });
  }
  return {
    contractId: contract.id,
    lane,
    fuel: contract.fuel,
    accessorials: contract.accessorials,
    lineCodes,
    detention: contract.detention,
    reweighRequiresCertificate: contract.reweighRequiresCertificate,
    claimDeadline: addDays(inv.invoiceDate, contract.claimWindowDays),
    warnings,
  };
}