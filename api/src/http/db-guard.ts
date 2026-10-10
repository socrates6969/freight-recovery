/**
 * Recognise refusals raised by the database guard triggers (four-eyes, migration 20261011000000_four_eyes;
 * step-5 analysis, migration 20261012000000_analysis). A match needs SQLSTATE P0001 AND an EXACT message
 * (never a substring); the database message is never forwarded to the client.
 */

/** SQLSTATE of `RAISE EXCEPTION ... USING ERRCODE = 'P0001'`. */
export const GUARD_SQLSTATE = 'P0001';
export const FOUR_EYES_DB_MESSAGES: ReadonlySet<string> = new Set(['four_eyes_required']);
export const ANALYSIS_DB_MESSAGES: ReadonlySet<string> = new Set(['claim_transition_invalid', 'analysis_packet_invalid']);

/** Bound on how far the error chain is followed (cause / meta / driverAdapterError links). */
const MAX_ERROR_CHAIN_DEPTH = 5;
const ERROR_CHAIN_LINKS = ['cause', 'meta', 'driverAdapterError'] as const;

/** True iff the node is a trigger raise with SQLSTATE `sqlstate` and a message in `messages` (exact match). */
function isTriggerRaiseNode(o: Record<string, unknown>, sqlstate: string, messages: ReadonlySet<string>): boolean {
  // Prisma 7 + @prisma/adapter-pg: PrismaClientKnownRequestError (P2039/P2010) carries
  // meta.driverAdapterError.cause = { kind: 'postgres', originalCode, originalMessage, code, message }.
  if (o.originalCode === sqlstate && typeof o.originalMessage === 'string' && messages.has(o.originalMessage)) return true;
  // A plain pg DatabaseError (raw driver) carries the SQLSTATE in `code` and the exact raise text in `message`.
  return o.code === sqlstate && typeof o.message === 'string' && messages.has(o.message);
}

/** Walk the error and the errors linked from it within MAX_ERROR_CHAIN_DEPTH hops. */
export function isTriggerRaise(err: unknown, sqlstate: string, messages: ReadonlySet<string>): boolean {
  const seen = new Set<object>();
  const walk = (v: unknown, depth: number): boolean => {
    if (depth > MAX_ERROR_CHAIN_DEPTH || typeof v !== 'object' || v === null || seen.has(v)) return false;
    seen.add(v);
    const o = v as Record<string, unknown>;
    if (isTriggerRaiseNode(o, sqlstate, messages)) return true;
    return ERROR_CHAIN_LINKS.some((k) => walk(o[k], depth + 1));
  };
  return walk(err, 0);
}

/** The four-eyes trigger raise: SQLSTATE P0001 and message exactly `four_eyes_required`. */
export function isFourEyesDbError(err: unknown): boolean {
  return isTriggerRaise(err, GUARD_SQLSTATE, FOUR_EYES_DB_MESSAGES);
}

/** A step-5 analysis guard raise: SQLSTATE P0001 and message exactly `claim_transition_invalid` or `analysis_packet_invalid`. */
export function isAnalysisDbError(err: unknown): boolean {
  return isTriggerRaise(err, GUARD_SQLSTATE, ANALYSIS_DB_MESSAGES);
}
