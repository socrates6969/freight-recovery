/**
 * Command line for the audit-agent team (not exported from the package; Node only).
 *
 *   npx tsx packages/shared/src/audit-agents/cli.ts --eval [seed]      SYNTHETIC precision/recall report
 *   npx tsx packages/shared/src/audit-agents/cli.ts --case case.json   run the team on one case (JSON AuditCase)
 *   npx tsx packages/shared/src/audit-agents/cli.ts --schemas          JSON Schemas of the agent contracts
 *
 * The deterministic team runs offline. With ANTHROPIC_API_KEY set and `--llm`, the judgment agents use
 * the Messages API (model `AUDIT_AGENT_MODEL`, override with AUDIT_AGENT_MODEL env).
 */
import { readFileSync } from 'node:fs';

import { AUDIT_AGENT_MODEL, createAnthropicClient, type LlmClient } from './llm.js';
import { runAuditTeam, type AuditCase } from './orchestrator.js';
import { evaluateAuditTeam } from './synthetic.js';
import { agentJsonSchemas } from './types.js';

function llmFromEnv(args: readonly string[]): LlmClient | null {
  const key = process.env['ANTHROPIC_API_KEY'];
  if (!args.includes('--llm') || key === undefined || key === '') return null;
  return createAnthropicClient({ apiKey: key, fetch: (url, init) => fetch(url, init), model: process.env['AUDIT_AGENT_MODEL'] ?? AUDIT_AGENT_MODEL });
}

async function main(args: readonly string[]): Promise<number> {
  const llm = llmFromEnv(args);
  if (args[0] === '--eval') {
    const report = await evaluateAuditTeam(args[1] === undefined || args[1].startsWith('--') ? undefined : Number(args[1]), { llm });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.clean.withConfirmed === 0 ? 0 : 1;
  }
  if (args[0] === '--case' && args[1] !== undefined) {
    const c = JSON.parse(readFileSync(args[1], 'utf8')) as AuditCase;
    process.stdout.write(`${JSON.stringify(await runAuditTeam(c, { llm }), null, 2)}\n`);
    return 0;
  }
  if (args[0] === '--schemas') {
    process.stdout.write(`${JSON.stringify(agentJsonSchemas(), null, 2)}\n`);
    return 0;
  }
  process.stderr.write('usage: cli.ts --eval [seed] | --case <file.json> | --schemas  [--llm]\n');
  return 2;
}

process.exitCode = await main(process.argv.slice(2));