/* eslint-disable */
// REQ-20261012-hardening Tier H: T5 HD-B05 (AN-B09 budget stop; Part C C5.2/C5.3). Own process (different env): the
// measured request runs on an app with RATE_LIMIT_ENABLED=true and RATE_LIMIT_ANALYSIS_MAX=3; setup runs on an app
// without rate limiting. Dedicated fixture tenant.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, closeApps } from './helpers/client.js';
import * as A from './helpers/analysis.js';
import * as H from './helpers/imp.js';
import * as I from './helpers/intel.js';
import { reseed } from './helpers/seed.js';

let setup: FastifyInstance;
let limited: FastifyInstance;
let fx: I.Fx;
const made: A.Made[] = [];

beforeAll(async () => {
  await H.assertS3Reachable();
  reseed();
  setup = await buildTestApp({ LOCKOUT_THRESHOLD: '50' });
  fx = await I.fixtureTenant(setup, `hdbudget${Date.now() % 100000}`, 'Hardening Budget Synthetic');
  for (let i = 0; i < 5; i++) { made.push(await A.smallClaim(fx.analyst, fx.manager, `HB5${i}`)); await H.sleep(25); }
  limited = await buildTestApp({ LOCKOUT_THRESHOLD: '50', RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_ANALYSIS_MAX: '3', RATE_LIMIT_GLOBAL_MAX: '100000', RATE_LIMIT_AUTH_MAX: '100000' });
}, 240000);
afterAll(async () => { try { await I.clearTenantClaims(fx.id); await closeApps(); } finally { reseed(); } });

describe('HD-B05 budget stop (C5.2)', () => {
  it('200 examined 3, analyzed 3, remaining >= 2, stoppedBy budget; one summary with stoppedBy budget; next bulk 429 with Retry-After', async () => {
    const lm = I.onApp(limited, fx.manager, '10.77.0.5');
    const seq = await I.lastSeq(fx.id);
    const r = await A.bulk(lm, { limit: 5 });
    expect(r.status, r.text).toBe(200);
    expect(r.body.examined).toBe(3);
    expect(r.body.analyzed).toHaveLength(3);
    expect(r.body.analyzed.map((a: any) => a.claimId), 'oldest first').toEqual(made.slice(0, 3).map((c) => c.claimId));
    expect(r.body.remaining).toBeGreaterThanOrEqual(2);
    expect(r.body.stoppedBy).toBe('budget');
    const sum = (await I.eventsSince(fx.id, seq)).filter((e) => e.action === 'claim.bulk_analyzed');
    expect(sum).toHaveLength(1);
    expect(sum[0]!.metadata).toEqual({ limit: 5, examined: 3, analyzed: 3, skipped: 0, failed: 0, remaining: r.body.remaining, stoppedBy: 'budget' });
    const next = await A.bulk(lm, { limit: 1 });
    A.expectExact(next, 429, 'rate_limited', 'HD-B05 next bulk');
    expect(Number(next.headers['retry-after'])).toBeGreaterThan(0);
  }, 180000);
});
