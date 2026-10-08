/** Raised when code tries to step outside its tenant scope. Always a 500 (bug), never user-visible detail. */
export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function assertUuid(value: unknown, what: string): asserts value is string {
  if (!isUuid(value)) throw new TenantScopeError(`${what} must be a UUID`);
}
