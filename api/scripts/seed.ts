/**
 * Synthetic seed (C7). Dev/test only. Uses the OWNER connection (MIGRATE_DATABASE_URL; BYPASSRLS) and the
 * real domain helpers (argon2 hasher, AES-GCM MFA sealing, packet content hash, hash-chained audit append)
 * so that GET /packet integrity and GET /audit/verify are valid after seeding.
 *
 *   NODE_ENV=development npm run db:seed              idempotent (creates what is missing)
 *   NODE_ENV=development npm run db:seed -- --reset   wipes the seed tenants (and platform chain) first
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { appendAudit } from '../src/audit/audit.js';
import { packetContentHash, type HashPacket } from '../src/claims/content-hash.js';
import { createDb, type BaseClient } from '../src/db/client.js';
import { scopeSystemTxToTenant, withSystemTx, type SystemTx } from '../src/db/system.js';
import { sealAesGcm } from '../src/security/crypto.js';
import { PasswordHasher } from '../src/security/password.js';

import { PRNG_SEED, generateClaim, hostileClaim, mulberry32, type SeedClaim, type SeedStatus } from './seed-claims.js';

export const SEED_PASSWORD = 'Synthetic-Pass-2026!';
export const SEED_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

type TenantRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'REVIEWER' | 'ANALYST' | 'VIEWER';
interface SeedUser {
  email: string;
  name: string;
  role: TenantRole | 'PLATFORM_DEV' | 'SUPER_ADMIN';
  mfa: boolean;
}

const ACME: SeedUser[] = [
  { email: 'owner@acme.test', name: 'Avery Owner', role: 'OWNER', mfa: true },
  { email: 'admin@acme.test', name: 'Adrian Admin', role: 'ADMIN', mfa: true },
  { email: 'newadmin@acme.test', name: 'Nora Newadmin', role: 'ADMIN', mfa: false },
  { email: 'manager@acme.test', name: 'Morgan Manager', role: 'MANAGER', mfa: false },
  { email: 'reviewer@acme.test', name: 'Riley Reviewer', role: 'REVIEWER', mfa: false },
  { email: 'analyst@acme.test', name: 'Alex Analyst', role: 'ANALYST', mfa: false },
  { email: 'viewer@acme.test', name: 'Vic Viewer', role: 'VIEWER', mfa: false },
  { email: 'lockme@acme.test', name: 'Lock Test One', role: 'ANALYST', mfa: false },
  { email: 'lockme2@acme.test', name: 'Lock Test Two', role: 'ANALYST', mfa: false },
  { email: 'reset@acme.test', name: 'Reset Test One', role: 'VIEWER', mfa: false },
  { email: 'reset2@acme.test', name: 'Reset Test Two', role: 'VIEWER', mfa: false },
  { email: 'spare1@acme.test', name: 'Spare One', role: 'VIEWER', mfa: false },
  { email: 'spare2@acme.test', name: 'Spare Two', role: 'VIEWER', mfa: false },
  { email: 'spare3@acme.test', name: 'Spare Three', role: 'VIEWER', mfa: false },
  { email: 'spare4@acme.test', name: 'Spare Four', role: 'VIEWER', mfa: false },
];
const GLOBEX: SeedUser[] = [
  { email: 'owner@globex.test', name: 'Gwen Owner', role: 'OWNER', mfa: true },
  { email: 'manager@globex.test', name: 'Gabe Manager', role: 'MANAGER', mfa: false },
  { email: 'viewer@globex.test', name: 'Gina Viewer', role: 'VIEWER', mfa: false },
];
const PLATFORM: SeedUser[] = [
  { email: 'dev@platform.test', name: 'Dana Developer', role: 'PLATFORM_DEV', mfa: true },
  { email: 'super@platform.test', name: 'Sam Superadmin', role: 'SUPER_ADMIN', mfa: true },
];

const TENANTS = [
  { slug: 'acme', name: 'Acme Logistics (synthetic)', users: ACME },
  { slug: 'globex', name: 'Globex Freight (synthetic)', users: GLOBEX },
] as const;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for the seed`);
  return v;
}

/** Hosts where seeding needs no extra opt-in: loopback and the compose.web.yml Postgres service. */
export const SEED_SAFE_HOSTS: readonly string[] = Object.freeze(['127.0.0.1', 'localhost', '::1', '[::1]', 'postgres']);

/**
 * Returns a refusal reason, or null if seeding is allowed. Seeding requires NODE_ENV=development|test
 * AND either a loopback/compose database host or an explicit ALLOW_SEED=1 opt-in. Managed cloud
 * databases (RDS) are always refused.
 */
export function seedRefusal(env: Record<string, string | undefined>): string | null {
  const nodeEnv = env['NODE_ENV'];
  if (nodeEnv !== 'development' && nodeEnv !== 'test') return 'NODE_ENV must be development or test';
  const url = env['MIGRATE_DATABASE_URL'];
  if (!url) return 'MIGRATE_DATABASE_URL is required';
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'MIGRATE_DATABASE_URL is not a valid URL';
  }
  if (/(^|\.)amazonaws\.com$/u.test(host)) return 'refusing to seed a managed cloud database (RDS)';
  if (SEED_SAFE_HOSTS.includes(host)) return null;
  if (env['ALLOW_SEED'] === '1') return null;
  return `database host ${host} is not local; set ALLOW_SEED=1 to seed it deliberately`;
}

function guard(): void {
  const reason = seedRefusal(process.env);
  if (reason) throw new Error(`Refusing to seed: ${reason}`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
function seedDataDir(): string {
  // Source run (tsx): api/scripts -> api/prisma/seed-data. Compiled run: api/dist/scripts -> api/prisma/seed-data.
  const candidates = [path.join(here, '..', 'prisma', 'seed-data'), path.join(here, '..', '..', 'prisma', 'seed-data')];
  for (const c of candidates) {
    try {
      readFileSync(path.join(c, 'ld5001.json'));
      return c;
    } catch {
      // try next
    }
  }
  throw new Error('seed-data directory not found');
}

function fixtureClaim(file: string): SeedClaim {
  const raw = JSON.parse(readFileSync(path.join(seedDataDir(), file), 'utf8')) as Omit<SeedClaim, 'status' | 'createdAt' | 'amountClaimedCents'> & {
    findings: SeedClaim['findings'];
  };
  const amountClaimedCents = raw.findings.reduce((s, f) => s + f.amountCents, 0);
  return {
    ...raw,
    status: 'PENDING_REVIEW',
    createdAt: raw.claimNumber === 'CLM-0001' ? '2026-09-29T09:00:00.000Z' : '2026-09-29T09:05:00.000Z',
    amountClaimedCents,
  };
}

/** The Acme and Globex claim set, exactly as in C7. */
export function buildClaimSet(): { acme: SeedClaim[]; globex: SeedClaim[] } {
  const rnd = mulberry32(PRNG_SEED);
  const acme: SeedClaim[] = [fixtureClaim('ld5001.json'), fixtureClaim('ld5002.json')];
  const statusFor = (n: number): SeedStatus => (n <= 14 ? 'PENDING_REVIEW' : n <= 18 ? 'APPROVED' : n <= 21 ? 'REJECTED' : 'SEND_READY');
  for (let n = 3; n <= 24; n += 1) {
    acme.push(
      generateClaim({
        claimNumber: `CLM-${String(n).padStart(4, '0')}`,
        status: statusFor(n),
        index: n,
        rnd,
        pendingFinding: n === 13 || n === 14,
        shipperOnly: n <= 14,
      }),
    );
  }
  acme.push(hostileClaim('CLM-HOSTILE-1', 30, rnd));
  acme.push(hostileClaim('CLM-HOSTILE-2', 31, rnd));
  const globexStatuses: SeedStatus[] = ['PENDING_REVIEW', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SEND_READY', 'PENDING_REVIEW'];
  const globex = globexStatuses.map((status, i) =>
    generateClaim({ claimNumber: `GLX-${String(i + 1).padStart(4, '0')}`, status, index: 40 + i, rnd, pendingFinding: false }),
  );
  return { acme, globex };
}

async function resetSeedData(base: BaseClient): Promise<void> {
  await base.$transaction(async (tx) => {
    // Owner-only, dev/test only: disable append-only/RI triggers inside THIS transaction.
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    const tenants = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM tenants WHERE slug IN ('acme', 'globex')`;
    const ids = tenants.map((t) => t.id);
    const userIds = (
      await tx.$queryRaw<{ id: string }[]>`
        SELECT u.id FROM users u
        WHERE u.email LIKE '%@acme.test' OR u.email LIKE '%@globex.test' OR u.email LIKE '%@platform.test'
           OR u.id IN (SELECT user_id FROM memberships WHERE tenant_id = ANY(${ids}::uuid[]))`
    ).map((u) => u.id);
    await tx.$executeRaw`DELETE FROM audit_events WHERE tenant_id = ANY(${ids}::uuid[]) OR chain_key = 'platform'`;
    // Step 3 import tables (children first). Stored objects are NOT removed here (dev/test buckets only).
    await tx.$executeRaw`DELETE FROM claim_documents WHERE tenant_id = ANY(${ids}::uuid[])`;
    await tx.$executeRaw`DELETE FROM import_review_decisions WHERE tenant_id = ANY(${ids}::uuid[])`;
    await tx.$executeRaw`DELETE FROM extracted_fields WHERE tenant_id = ANY(${ids}::uuid[])`;
    await tx.$executeRaw`DELETE FROM import_documents WHERE tenant_id = ANY(${ids}::uuid[])`;
    await tx.$executeRaw`DELETE FROM import_batches WHERE tenant_id = ANY(${ids}::uuid[])`;
    await tx.$executeRaw`DELETE FROM approvals WHERE tenant_id = ANY(${ids}::uuid[])`;
    await tx.$executeRaw`DELETE FROM packet_findings WHERE tenant_id = ANY(${ids}::uuid[])`;
    await tx.$executeRaw`DELETE FROM packet_timeline_events WHERE tenant_id = ANY(${ids}::uuid[])`;
    await tx.$executeRaw`DELETE FROM packet_sources WHERE tenant_id = ANY(${ids}::uuid[])`;
    await tx.$executeRaw`DELETE FROM evidence_packets WHERE tenant_id = ANY(${ids}::uuid[])`;
    await tx.$executeRaw`DELETE FROM claims WHERE tenant_id = ANY(${ids}::uuid[])`;
    // Step 4: tenant API keys of the seed tenants/users; flags back to their registry defaults (version 1).
    await tx.$executeRaw`DELETE FROM api_keys WHERE tenant_id = ANY(${ids}::uuid[]) OR created_by_id = ANY(${userIds}::uuid[]) OR revoked_by_id = ANY(${userIds}::uuid[])`;
    await tx.$executeRaw`UPDATE feature_flags SET enabled = true, version = 1, updated_by_id = NULL, updated_at = NULL, last_reason = NULL`;
    await tx.$executeRaw`DELETE FROM invites WHERE tenant_id = ANY(${ids}::uuid[]) OR invited_by_id = ANY(${userIds}::uuid[])`;
    await tx.$executeRaw`DELETE FROM memberships WHERE tenant_id = ANY(${ids}::uuid[]) OR user_id = ANY(${userIds}::uuid[])`;
    await tx.$executeRaw`DELETE FROM mfa_recovery_codes WHERE user_id = ANY(${userIds}::uuid[])`;
    await tx.$executeRaw`DELETE FROM mfa_secrets WHERE user_id = ANY(${userIds}::uuid[])`;
    await tx.$executeRaw`DELETE FROM refresh_tokens WHERE user_id = ANY(${userIds}::uuid[])`;
    await tx.$executeRaw`DELETE FROM password_resets WHERE user_id = ANY(${userIds}::uuid[])`;
    await tx.$executeRaw`DELETE FROM mail_outbox WHERE tenant_id = ANY(${ids}::uuid[]) OR to_email LIKE '%@acme.test' OR to_email LIKE '%@globex.test' OR to_email LIKE '%@platform.test'`;
    await tx.$executeRaw`DELETE FROM login_attempts`;
    await tx.$executeRaw`DELETE FROM login_lockouts`;
    await tx.$executeRaw`DELETE FROM users WHERE id = ANY(${userIds}::uuid[])`;
    await tx.$executeRaw`DELETE FROM tenants WHERE id = ANY(${ids}::uuid[])`;
  });
}

async function ensureUser(
  tx: SystemTx,
  hasher: PasswordHasher,
  mfaKey: Buffer,
  u: SeedUser,
  tenantId: string | null,
): Promise<string> {
  const existing = await tx.user.findUnique({ where: { email: u.email }, select: { id: true } });
  if (existing) return existing.id;
  const isPlatform = u.role === 'PLATFORM_DEV' || u.role === 'SUPER_ADMIN';
  const created = await tx.user.create({
    data: {
      email: u.email,
      name: u.name,
      passwordHash: await hasher.hash(SEED_PASSWORD),
      platformRole: isPlatform ? (u.role as 'PLATFORM_DEV' | 'SUPER_ADMIN') : null,
    },
  });
  if (!isPlatform && tenantId) {
    await tx.membership.create({ data: { tenantId, userId: created.id, role: u.role as TenantRole } });
  }
  if (u.mfa) {
    const box = sealAesGcm(mfaKey, Buffer.from(SEED_TOTP_SECRET, 'utf8'), created.id);
    await tx.mfaSecret.create({
      data: {
        userId: created.id,
        ciphertext: new Uint8Array(box.ciphertext),
        nonce: new Uint8Array(box.nonce),
        keyId: 'k1',
        verifiedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
  }
  return created.id;
}

function hashInputFor(c: SeedClaim, sourceIds: Map<number, string>): HashPacket {
  const sid = (o: number | null): string | null => (o === null ? null : (sourceIds.get(o) ?? null));
  return {
    perspective: c.perspective,
    loadNumber: c.loadNumber,
    currency: 'USD',
    recoverableCents: c.recoverableCents,
    pendingReviewCents: c.pendingReviewCents,
    demandLetter: c.demandLetter,
    sources: c.sources.map((s) => ({ id: sourceIds.get(s.ordinal) ?? '', ordinal: s.ordinal, filename: s.filename, docType: s.docType, sha256: s.sha256, sizeBytes: s.sizeBytes })),
    timeline: c.timeline.map((t) => ({ ordinal: t.ordinal, occurredAt: new Date(t.occurredAt), kind: t.kind, label: t.label, sourceId: sid(t.sourceOrdinal) })),
    findings: c.findings.map((f) => ({
      ordinal: f.ordinal,
      ruleId: f.ruleId,
      title: f.title,
      direction: f.direction,
      amountCents: f.amountCents,
      explanation: f.explanation,
      calculation: f.calculation,
      confidence: f.confidence,
      needsHumanReview: f.needsHumanReview,
      citations: f.citations.map((x) => ({ sourceId: sid(x.sourceOrdinal) ?? '', locator: x.locator, excerpt: x.excerpt })),
      clauseSourceId: f.clause ? sid(f.clause.sourceOrdinal) : null,
      clauseLabel: f.clause?.label ?? null,
      clauseExcerpt: f.clause?.excerpt ?? null,
      clauseLocator: f.clause?.locator ?? null,
    })),
  };
}

interface Actors {
  owner: string;
  manager: string;
  reviewer: string;
}

async function seedClaim(tx: SystemTx, tenantId: string, c: SeedClaim, actors: Actors): Promise<boolean> {
  const exists = await tx.claim.findFirst({ where: { tenantId, claimNumber: c.claimNumber }, select: { id: true } });
  if (exists) return false;
  const createdAt = new Date(c.createdAt);
  const claim = await tx.claim.create({
    data: {
      tenantId,
      claimNumber: c.claimNumber,
      loadNumber: c.loadNumber,
      invoiceNumber: c.invoiceNumber,
      invoiceDate: c.invoiceDate ? new Date(c.invoiceDate) : null,
      carrierName: c.carrierName,
      shipperName: c.shipperName,
      perspective: c.perspective,
      status: 'PENDING_REVIEW',
      amountClaimedCents: c.amountClaimedCents,
      recoverableCents: c.recoverableCents,
      pendingReviewCents: c.pendingReviewCents,
      createdAt,
      updatedAt: createdAt,
    },
  });
  const sourceIds = new Map<number, string>(c.sources.map((s) => [s.ordinal, randomUUID()]));
  const contentHash = packetContentHash(hashInputFor(c, sourceIds));
  const packet = await tx.evidencePacket.create({
    data: {
      tenantId,
      claimId: claim.id,
      revision: 1,
      status: 'PENDING_REVIEW',
      perspective: c.perspective,
      loadNumber: c.loadNumber,
      generatedAt: new Date(c.generatedAt),
      disclaimer: c.disclaimer,
      demandLetter: c.demandLetter,
      recoverableCents: c.recoverableCents,
      pendingReviewCents: c.pendingReviewCents,
      verifierStatus: c.verifierStatus,
      verifierCheckedAt: c.verifierStatus === 'NOT_RUN' ? null : new Date(c.generatedAt),
      verifierNote: c.verifierNote,
      contentHash,
      createdAt,
    },
  });
  await tx.packetSource.createMany({
    data: c.sources.map((s) => ({
      id: sourceIds.get(s.ordinal) ?? randomUUID(),
      tenantId,
      packetId: packet.id,
      filename: s.filename,
      docType: s.docType,
      sha256: s.sha256,
      sizeBytes: s.sizeBytes,
      ordinal: s.ordinal,
    })),
  });
  await tx.packetTimelineEvent.createMany({
    data: c.timeline.map((t) => ({
      tenantId,
      packetId: packet.id,
      occurredAt: new Date(t.occurredAt),
      kind: t.kind as 'APPOINTMENT',
      label: t.label,
      sourceId: t.sourceOrdinal === null ? null : (sourceIds.get(t.sourceOrdinal) ?? null),
      ordinal: t.ordinal,
    })),
  });
  if (c.findings.length > 0) {
    await tx.packetFinding.createMany({
      data: c.findings.map((f) => ({
        tenantId,
        packetId: packet.id,
        ordinal: f.ordinal,
        ruleId: f.ruleId,
        title: f.title,
        direction: f.direction,
        amountCents: f.amountCents,
        explanation: f.explanation,
        calculation: f.calculation,
        confidence: f.confidence,
        needsHumanReview: f.needsHumanReview,
        citations: f.citations.map((x) => ({ sourceId: sourceIds.get(x.sourceOrdinal) ?? '', locator: x.locator, excerpt: x.excerpt })),
        clauseSourceId: f.clause ? (sourceIds.get(f.clause.sourceOrdinal) ?? null) : null,
        clauseLabel: f.clause?.label ?? null,
        clauseExcerpt: f.clause?.excerpt ?? null,
        clauseLocator: f.clause?.locator ?? null,
      })),
    });
  }

  // Review history so History tabs are populated and the audit chain verifies.
  const steps: { action: 'APPROVE' | 'REJECT' | 'SEND_READY'; from: SeedStatus; to: SeedStatus; actorId: string; role: string; reason: string }[] = [];
  if (c.status === 'APPROVED' || c.status === 'SEND_READY') {
    steps.push({ action: 'APPROVE', from: 'PENDING_REVIEW', to: 'APPROVED', actorId: actors.manager, role: 'MANAGER', reason: 'Seed history: verified against the rate confirmation.' });
  }
  if (c.status === 'SEND_READY') {
    steps.push({ action: 'SEND_READY', from: 'APPROVED', to: 'SEND_READY', actorId: actors.owner, role: 'OWNER', reason: 'Seed history: approved demand marked ready to send.' });
  }
  if (c.status === 'REJECTED') {
    steps.push({ action: 'REJECT', from: 'PENDING_REVIEW', to: 'REJECTED', actorId: actors.reviewer, role: 'REVIEWER', reason: 'Seed history: evidence insufficient for a dispute.' });
  }
  let t = createdAt.getTime();
  for (const s of steps) {
    t += 3600000;
    await tx.evidencePacket.update({ where: { id: packet.id }, data: { status: s.to } });
    await tx.approval.create({
      data: {
        tenantId,
        claimId: claim.id,
        packetId: packet.id,
        packetRevision: 1,
        action: s.action,
        reason: s.reason,
        fromStatus: s.from,
        toStatus: s.to,
        contentHash,
        actorId: s.actorId,
        actorRole: s.role,
        createdAt: new Date(t),
      },
    });
    await appendAudit(tx, {
      tenantId,
      action: s.action === 'APPROVE' ? 'approval.approved' : s.action === 'REJECT' ? 'approval.rejected' : 'approval.send_ready',
      actorId: null,
      actorRole: null,
      targetType: 'claim',
      targetId: claim.id,
      metadata: { claimId: claim.id, packetId: packet.id, packetRevision: 1, fromStatus: s.from, toStatus: s.to, contentHash, reason: s.reason },
    });
  }
  if (steps.length > 0) {
    await tx.claim.update({
      where: { id: claim.id },
      data: { status: c.status, version: steps.length, updatedAt: new Date(t) },
    });
  }
  return true;
}

export async function runSeed(opts: { reset: boolean; log?: (m: string) => void }): Promise<void> {
  guard();
  const log = opts.log ?? ((m: string) => process.stdout.write(`${m}\n`));
  const mfaKey = Buffer.from(env('MFA_ENC_KEY'), 'base64');
  if (mfaKey.length !== 32) throw new Error('MFA_ENC_KEY must decode to 32 bytes');
  const hasher = new PasswordHasher({
    memoryKib: Number(process.env['ARGON2_MEMORY_KIB'] ?? 19456),
    timeCost: Number(process.env['ARGON2_TIME_COST'] ?? 2),
  });
  const base = createDb(env('MIGRATE_DATABASE_URL'), { max: 2 });
  try {
    if (opts.reset) {
      await resetSeedData(base);
      log('seed: reset seed tenants');
    }
    const claims = buildClaimSet();
    const tenantIds: Record<string, string> = {};
    for (const t of TENANTS) {
      const tenant = await withSystemTx(base, async (tx) =>
        (await tx.tenant.findUnique({ where: { slug: t.slug } })) ?? tx.tenant.create({ data: { slug: t.slug, name: t.name } }),
      );
      tenantIds[t.slug] = tenant.id;
      for (const u of t.users) {
        await withSystemTx(base, (tx) => ensureUser(tx, hasher, mfaKey, u, tenant.id), { timeoutMs: 30000 });
      }
    }
    for (const u of PLATFORM) {
      await withSystemTx(base, (tx) => ensureUser(tx, hasher, mfaKey, u, null), { timeoutMs: 30000 });
    }

    const actorsFor = async (domain: string): Promise<Actors> =>
      withSystemTx(base, async (tx) => {
        const get = async (email: string) => {
          const u = await tx.user.findUnique({ where: { email }, select: { id: true } });
          if (!u) throw new Error(`seed user missing: ${email}`);
          return u.id;
        };
        const owner = await get(`owner@${domain}`);
        const manager = await get(`manager@${domain}`);
        const reviewer = domain === 'acme.test' ? await get('reviewer@acme.test') : manager;
        return { owner, manager, reviewer };
      });

    let created = 0;
    for (const [slug, list, domain] of [
      ['acme', claims.acme, 'acme.test'],
      ['globex', claims.globex, 'globex.test'],
    ] as const) {
      const tenantId = tenantIds[slug];
      if (!tenantId) throw new Error('tenant missing');
      const actors = await actorsFor(domain);
      for (const c of list) {
        const did = await withSystemTx(
          base,
          async (tx) => {
            await scopeSystemTxToTenant(tx, tenantId);
            return seedClaim(tx, tenantId, c, actors);
          },
          { timeoutMs: 30000 },
        );
        if (did) created += 1;
      }
    }
    log(`seed: done (${created} claims created)`);
  } finally {
    await base.$disconnect();
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runSeed({ reset: process.argv.includes('--reset') }).catch((e: unknown) => {
    process.stderr.write(`seed failed: ${e instanceof Error ? e.message : 'unknown error'}\n`);
    process.exit(1);
  });
}
