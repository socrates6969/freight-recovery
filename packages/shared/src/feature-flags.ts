/**
 * Feature flag registry v1 (Q4). Plain data: the ONLY flags that exist. A flag can only gate a Recovery
 * Intelligence feature; no flag gates authentication, CSRF, tenant isolation, rate limits or audit.
 * Adding a key is a deliberate change (registry test + migration row).
 */

export interface FlagDefinition {
  readonly key: string;
  readonly description: string;
  readonly defaultEnabled: boolean;
  /** Returned to tenant users by GET /features. */
  readonly tenantVisible: boolean;
}

/** Ordered by key. */
export const FEATURE_FLAGS = Object.freeze([
  Object.freeze({ key: 'intelligence.provenance', description: 'Provenance summary on the claim sheet', defaultEnabled: true, tenantVisible: true }),
  Object.freeze({ key: 'intelligence.similar_claims', description: 'Similar past claims on the claim sheet', defaultEnabled: true, tenantVisible: true }),
  Object.freeze({ key: 'intelligence.worklist', description: 'Prioritised worklist page', defaultEnabled: true, tenantVisible: true }),
] as const satisfies readonly FlagDefinition[]);

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number]['key'];

export const FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] = Object.freeze(FEATURE_FLAGS.map((f) => f.key));

export function isKnownFlag(key: unknown): key is FeatureFlagKey {
  return typeof key === 'string' && (FEATURE_FLAG_KEYS as readonly string[]).includes(key);
}

export function flagDefinition(key: FeatureFlagKey): FlagDefinition {
  const def = FEATURE_FLAGS.find((f) => f.key === key);
  if (!def) throw new RangeError('unknown flag');
  return def;
}
