/**
 * Feature flag registry v1 (Q4; step 6 adds the charge-suggestions flag; REQ-20261020-dd-deadline adds the routing shadow, the only default-OFF flag). Plain data: the ONLY flags that exist. A flag can only gate a Recovery
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
  // Step 6 (REQ-20261011-charge-intelligence): kill switch of charge suggestions, team labels and the learned layer.
  Object.freeze({ key: 'intelligence.charge_suggestions', description: 'Charge-line suggestions and team labels', defaultEnabled: true, tenantVisible: true }),
  // Step 7 (REQ-20261011-fuel-outlook): cost outlook page and fuel tables / fuel-surcharge check.
  Object.freeze({ key: 'intelligence.cost_outlook', description: 'Cost outlook from public price data', defaultEnabled: true, tenantVisible: true }),
  Object.freeze({ key: 'intelligence.fuel_check', description: 'Fuel tables and fuel-surcharge check', defaultEnabled: true, tenantVisible: true }),
  // Step 8 (REQ-20261011-ocean-dd): kill switch of the ocean D&D routes (existing OCEAN_DD claims stay usable).
  Object.freeze({ key: 'intelligence.ocean_dd', description: 'Ocean demurrage and detention invoice audit', defaultEnabled: true, tenantVisible: true }),
  Object.freeze({ key: 'intelligence.provenance', description: 'Provenance summary on the claim sheet', defaultEnabled: true, tenantVisible: true }),
  // REQ-20261020-dd-deadline: reviewer-routing shadow on the insights page. Read-only, changes no assignment;
  // OFF by default (the first registry flag that is), so the section appears only after a deliberate switch.
  Object.freeze({ key: 'intelligence.routing_shadow', description: 'Reviewer-routing shadow on the insights page', defaultEnabled: false, tenantVisible: true }),
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
