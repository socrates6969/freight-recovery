/**
 * Orchestrator of the audit-agent team for one invoice:
 *
 *   intake -> contract & tariff -> audit checks (deterministic) -> evidence -> reviewer -> claim draft
 *
 * The deterministic path is complete on its own; `llm` (optional) adds judgment where rules run out:
 * free-text intake, mapping unknown charge names, a second-opinion review that can only be stricter, and
 * the claim's opening paragraph. Nothing is sent: the output is a draft for a person to approve.
 */
import { runAuditChecks, type FuelContext } from './checks.js';
import { runContractAgent } from './contract.js';
import { attachEvidence, draftClaim } from './evidence.js';
import { runIntakeAgent, type IntakeInput } from './intake.js';
import type { LlmClient } from './llm.js';
import { runReviewerAgent } from './reviewer.js';
import type { AppliedTerms, AuditFinding, ClaimDraft, Contract, NormalizedInvoice, ReviewVerdict, ShipmentEvidence } from './types.js';

export interface AuditCase {
  invoice: IntakeInput;
  evidence: ShipmentEvidence;
  contracts: readonly Contract[];
  /** Invoices already received (cross-invoice duplicate check). */
  history: readonly NormalizedInvoice[];
  fuel: FuelContext | null;
  /** Review date `YYYY-MM-DD` (claim-window check). */
  asOf: string;
}

export interface AgentStep {
  agent: 'intake' | 'contract' | 'audit' | 'evidence' | 'reviewer' | 'claim';
  ok: boolean;
  note: string;
}

export interface AuditTeamReport {
  invoice: NormalizedInvoice | null;
  terms: AppliedTerms | null;
  findings: AuditFinding[];
  verdicts: ReviewVerdict[];
  claim: ClaimDraft | null;
  steps: AgentStep[];
}

export interface TeamOptions {
  llm?: LlmClient | null;
  tolerance?: string;
}

/** Run the full team on one case. */
export async function runAuditTeam(c: AuditCase, opts: TeamOptions = {}): Promise<AuditTeamReport> {
  const llm = opts.llm ?? null;
  const steps: AgentStep[] = [];
  const empty = (note: string): AuditTeamReport => ({ invoice: null, terms: null, findings: [], verdicts: [], claim: null, steps: [...steps, { agent: 'intake', ok: false, note }] });

  const intake = await runIntakeAgent(c.invoice, llm);
  if (intake.invoice === null) return empty(intake.warnings.join('; ') || 'no invoice');
  const inv = intake.invoice;
  steps.push({ agent: 'intake', ok: true, note: `${inv.source}: ${inv.lines.length} line(s)${inv.warnings.length > 0 ? `; ${inv.warnings.join('; ')}` : ''}` });

  const terms = await runContractAgent(inv, c.contracts, llm);
  if (terms === null) {
    steps.push({ agent: 'contract', ok: false, note: `no contract for ${inv.carrier} on ${inv.shipDate ?? inv.invoiceDate}` });
    return { invoice: inv, terms: null, findings: [], verdicts: [], claim: null, steps };
  }
  steps.push({ agent: 'contract', ok: true, note: `contract ${terms.contractId}, lane ${terms.lane?.id ?? 'none'}${terms.warnings.length > 0 ? `; ${terms.warnings.join('; ')}` : ''}` });

  const raw = runAuditChecks({ invoice: inv, evidence: c.evidence, terms, history: c.history, fuel: c.fuel, ...(opts.tolerance === undefined ? {} : { tolerance: opts.tolerance }) });
  steps.push({ agent: 'audit', ok: true, note: `${raw.length} finding(s): ${raw.map((f) => f.ruleId).join(', ') || 'none'}` });

  const findings = attachEvidence(inv, c.evidence, terms, raw);
  steps.push({ agent: 'evidence', ok: true, note: 'document trail attached' });

  const verdicts = await runReviewerAgent({ invoice: inv, evidence: c.evidence, terms, history: c.history, findings, asOf: c.asOf, ...(opts.tolerance === undefined ? {} : { tolerance: opts.tolerance }) }, llm);
  const count = (s: ReviewVerdict['status']): number => verdicts.filter((v) => v.status === s).length;
  steps.push({ agent: 'reviewer', ok: true, note: `${count('confirmed')} confirmed, ${count('needs_review')} need review, ${count('rejected')} rejected` });

  const claim = await draftClaim(inv, terms, findings, verdicts, c.asOf, llm);
  steps.push({ agent: 'claim', ok: true, note: `claim $${claim.confirmedTotal} by ${claim.claimDeadline}` });
  return { invoice: inv, terms, findings, verdicts, claim, steps };
}