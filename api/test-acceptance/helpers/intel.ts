/* eslint-disable */
// Step 4 acceptance helpers (Dev dashboard + Recovery Intelligence + API keys). Black-box only:
// application code is reached through buildTestApp; fixtures are written with the owner role.
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import {
  ACCOUNTS, ALL_ROLES, Client, buildTestApp, login, makeSession, rawLogin, sessionFor, type Res, type RoleName, type Session,
} from './client.js';
import { withAdmin, withTriggersOff, type PgClient } from './db.js';
import { SEED_PASSWORD, SEED_TOTP_SECRET } from './env.js';
import { rng } from './imp.js';
import { enrollMfa, newUser } from './users.js';

export { rng };
export const SEED = 20261009;
export const RAND_UUID = '00000000-0000-4000-8000-0000000000dd';
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Fixed texts (Q8) and the forbidden-string sweep (T1)
// ---------------------------------------------------------------------------------------------
export const WORKLIST_NOTE = (w: number) =>
  `Ranked by a fixed formula over this tenant's own claim data: confirmed recoverable amount plus ${w}% of the amount still pending human review. This is a work-order aid, not a forecast of what will be recovered.`;
export const SIMILAR_NOTE = "Similar claims are matched by fixed rules on this tenant's own data. Final status shows how your team handled the claim, not whether the carrier paid.";
export const PROVENANCE_NOTE = 'Confidence is a rule-based parse score, not an accuracy measure.';
export const NO_ACCURACY_NOTE = 'No accuracy figures are shown because none have been measured on real customer data.';
export const EVAL_NOTE = 'Results are computed on synthetic fixtures checked into the repository. They test whether the pipeline reproduces known answers and whether repeated runs agree. They are not an accuracy measure on real customer documents.';
export const EVAL_DETERMINISTIC_NOTE = 'Every case produced identical output on all runs, so pass^k equals pass^1 for this deterministic pipeline.';
export const TELEMETRY_NOTE = 'Counters cover this API instance since it started and reset on restart.';
export const LOGS_NOTE = 'Recent records from this API instance only. Messages and fields are filtered; customer data is never shown.';
export const PIPELINE_NOTE = 'Aggregates across all tenants. No customer data is shown. Files rejected before storage appear only in request telemetry.';

export const HONEST_RE = new RegExp(
  ['neural mesh', 'hebbian', 'solved-problems cache', 'ai-powered', 'faster than', '\\d+(\\.\\d+)?\\s*[x\\u00d7]\\s*(faster|speed)', '\\d+(\\.\\d+)?\\s*%\\s*accura', 'accuracy of \\d'].join('|'),
  'i',
);

export const usd = (cents: number): string => {
  const neg = cents < 0;
  const a = Math.abs(cents);
  const whole = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}$${whole}.${String(a % 100).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------------------------
// Response recorder: every body produced for the new routes is swept at the end of the file (T-X-05)
// ---------------------------------------------------------------------------------------------
const BODIES: Array<{ label: string; text: string }> = [];
export function rec<T extends { text?: string; status?: number }>(label: string, r: T): T {
  if (r && typeof r.text === 'string' && r.text.length) BODIES.push({ label: `${label} (${r.status})`, text: r.text });
  return r;
}
export function assertHonest(label = '') {
  for (const b of BODIES) {
    expect(HONEST_RE.test(b.text), `${label} forbidden claim in ${b.label}: ${b.text.slice(0, 300)}`).toBe(false);
  }
}
/** Session whose requests are recorded for the honesty sweep. */
export function recorded(s: Session): Session {
  const w = { ...s } as Session;
  w.as = async (m, p, o) => rec(`${m} ${p.split('?')[0]}`, await s.as(m, p, o));
  w.get = (p, o) => w.as('GET', p, o);
  w.post = (p, b, o) => w.as('POST', p, { body: b ?? {}, ...o });
  w.patch = (p, b, o) => w.as('PATCH', p, { body: b, ...o });
  w.destroy = (p, o) => w.as('DELETE', p, o);
  return w;
}
export const put = (s: Session, p: string, b?: unknown, o: any = {}) => s.as('PUT', p, { body: b, ...o });

// ---------------------------------------------------------------------------------------------
// Sessions (cached access tokens of the eight seeded identities, re-bound to private instances)
// ---------------------------------------------------------------------------------------------
let SHARED: FastifyInstance | undefined;
export async function sharedApp(): Promise<FastifyInstance> {
  return (SHARED ??= await buildTestApp());
}
export async function baseSession(roleOrEmail: string): Promise<Session> {
  const email = (ACCOUNTS as Record<string, string>)[roleOrEmail] ?? roleOrEmail;
  return sessionFor(await sharedApp(), email);
}
/** Re-bind an existing access token to another app instance (same JWT secret, same database). */
export function onApp(app: FastifyInstance, s: Session, ip?: string): Session {
  return makeSession(new Client(app, ip ?? s.client.ip), s.email, {
    status: 200, headers: {}, text: '', setCookies: [], ms: 0,
    body: { status: 'ok', accessToken: s.token, user: s.user },
  });
}
export async function seededOn(app: FastifyInstance, roles: readonly RoleName[] = ALL_ROLES): Promise<Record<RoleName, Session>> {
  const out = {} as Record<RoleName, Session>;
  for (const r of roles) out[r] = onApp(app, await baseSession(r));
  return out;
}
export const GLOBEX = { OWNER: 'owner@globex.test', MANAGER: 'manager@globex.test', VIEWER: 'viewer@globex.test' };

// ---------------------------------------------------------------------------------------------
// Audit helpers over SQL (owner role). tenantId null = PLATFORM chain.
// ---------------------------------------------------------------------------------------------
export interface Ev { seq: number; action: string; actor_id: string | null; actor_role: string | null; target_type: string | null; target_id: string | null; metadata: any; request_id: string | null }
export async function lastSeq(tenantId: string | null): Promise<number> {
  return withAdmin(async (c) => {
    const r = tenantId
      ? await c.query(`select coalesce(max(seq),0)::int as s from audit_events where tenant_id=$1`, [tenantId])
      : await c.query(`select coalesce(max(seq),0)::int as s from audit_events where tenant_id is null`);
    return Number(r.rows[0].s);
  });
}
export async function eventsSince(tenantId: string | null, seq: number, action?: string): Promise<Ev[]> {
  return withAdmin(async (c) => {
    const like = action ? ` and action like ${lit(action + '%')}` : '';
    const where = (tenantId ? `tenant_id=$1 and seq>$2` : `tenant_id is null and seq>$1`) + like;
    const r = await c.query(
      `select seq::int as seq, action, actor_id, actor_role, target_type, target_id, metadata, request_id from audit_events where ${where} order by seq`,
      tenantId ? [tenantId, seq] : [seq],
    );
    return r.rows.map((x: any) => ({ ...x, seq: Number(x.seq) }));
  });
}
export const keysOf = (o: any): string[] => Object.keys(o ?? {}).sort();

// ---------------------------------------------------------------------------------------------
// Generic JSON walkers
// ---------------------------------------------------------------------------------------------
export function allKeys(o: any, out = new Set<string>()): Set<string> {
  if (Array.isArray(o)) o.forEach((x) => allKeys(x, out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.add(k); allKeys(v, out); }
  return out;
}
export function allStrings(o: any, out: string[] = []): string[] {
  if (typeof o === 'string') out.push(o);
  else if (Array.isArray(o)) o.forEach((x) => allStrings(x, out));
  else if (o && typeof o === 'object') for (const v of Object.values(o)) allStrings(v, out);
  return out;
}
export const rowCounts = async (c: PgClient, tables: string[]) => {
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = Number((await c.query(`select count(*)::int n from "${t}"`)).rows[0].n);
  return out;
};
export const NON_AUDIT_TABLES = ['tenants', 'users', 'memberships', 'invites', 'claims', 'evidence_packets', 'packet_sources', 'packet_findings', 'approvals', 'import_batches', 'import_documents', 'extracted_fields', 'claim_documents', 'feature_flags', 'eval_runs', 'eval_case_results'];

// ---------------------------------------------------------------------------------------------
// Log capture
// ---------------------------------------------------------------------------------------------
export function captureStream() {
  const lines: string[] = [];
  const stream = new Writable({ write(chunk, _e, cb) { lines.push(...String(chunk).split('\n').filter(Boolean)); cb(); } });
  return { lines, stream };
}
/** App with LOG_LEVEL=trace whose raw log stream is captured (and never printed). */
export async function buildLogged(overrides: Record<string, string> = {}) {
  const cap = captureStream();
  const app = await buildTestApp({ LOG_LEVEL: 'trace', ...overrides }, { logStream: cap.stream });
  return { app, lines: cap.lines };
}

// ---------------------------------------------------------------------------------------------
// Telemetry helpers (Q5.2)
// ---------------------------------------------------------------------------------------------
export const BOUNDS: Array<number | null> = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, null];
export function nearestRankBound(buckets: Array<{ leMs: number | null; count: number }>, count: number, pct: number): number | null {
  if (!count) return null;
  const rank = Math.ceil((pct / 100) * count);
  let cum = 0;
  for (const b of buckets) { cum += b.count; if (cum >= rank) return b.leMs; }
  return null;
}
export const routeMap = (t: any) => {
  const m = new Map<string, any>();
  for (const r of t.routes) m.set(`${r.method} ${r.route}`, r);
  return m;
};
export const countOf = (t: any, method: string, route: string): number => routeMap(t).get(`${method} ${route}`)?.count ?? 0;
export const classOf = (t: any, method: string, route: string, cls: string): number => routeMap(t).get(`${method} ${route}`)?.byStatusClass?.[cls] ?? 0;

// ---------------------------------------------------------------------------------------------
// Fixture tenants (T1)
// ---------------------------------------------------------------------------------------------
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
export const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
async function cloneRow(c: PgClient, table: string, where: string, overrides: Record<string, string>) {
  const cols = (await c.query(`select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [table])).rows.map((r: any) => r.column_name as string);
  const sel = cols.map((n) => (n in overrides ? overrides[n] : q(n))).join(',');
  await c.query(`insert into ${q(table)} (${cols.map(q).join(',')}) select ${sel} from ${q(table)} where ${where}`);
}
export interface Fx { id: string; slug: string; name: string; ownerId: string; owner: Session; manager: Session; viewer: Session; analyst: Session; app: FastifyInstance }
const FXC = new Map<string, Promise<Fx>>();
export function fixtureTenant(app: FastifyInstance, slug: string, name: string): Promise<Fx> {
  const a = app as any;
  a.__fxid ??= randomUUID();
  const k = `${a.__fxid}:${slug}`;
  if (!FXC.has(k)) FXC.set(k, mkFixture(app, slug, name));
  return FXC.get(k)!;
}
async function mkFixture(app: FastifyInstance, slug: string, name: string): Promise<Fx> {
  const ownerEmail = `owner-${slug}@fixture.test`;
  const { id, ownerId } = await withAdmin(async (c) => {
    let tid = (await c.query(`select id from tenants where slug=$1`, [slug])).rows[0]?.id as string | undefined;
    if (!tid) {
      tid = randomUUID();
      await c.query(`insert into tenants (id, name, slug, status, created_at) values ($1,$2,$3,'ACTIVE',now())`, [tid, name, slug]);
    }
    let uid = (await c.query(`select id from users where email=$1`, [ownerEmail])).rows[0]?.id as string | undefined;
    if (!uid) {
      uid = randomUUID();
      await c.query('BEGIN');
      try {
        await cloneRow(c, 'users', `email='owner@acme.test'`, { id: `${lit(uid)}::uuid`, email: lit(ownerEmail), name: lit(`Fixture Owner ${slug}`) });
        await c.query(`insert into memberships (id, tenant_id, user_id, role, created_at, updated_at) values (gen_random_uuid(), $1, $2, 'OWNER', now(), now())`, [tid, uid]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
    await c.query(`delete from mfa_secrets where user_id = $1`, [uid]); // stale enrollment from an earlier run would make the owner log in with an unknown secret
    return { id: tid, ownerId: uid };
  });
  // The MFA secret is encrypted with the user id as AAD, so a cloned row cannot be decrypted: enroll through the public flow instead.
  const ownerLogin = new Client(app, '10.9.9.5');
  const first = await rawLogin(ownerLogin, ownerEmail, SEED_PASSWORD);
  const owner = recorded(first.status === 200 && first.body.status === 'ok' ? makeSession(ownerLogin, ownerEmail, first) : (await enrollMfa(app, ownerEmail, SEED_PASSWORD)).session);
  const mk = async (role: string) => {
    const u = await newUser(app, owner, role);
    return recorded(await login(app, u.email, u.password));
  };
  const manager = await mk('MANAGER');
  const viewer = await mk('VIEWER');
  const analyst = await mk('ANALYST');
  await clearTenantClaims(id);
  return { id, slug, name, ownerId, owner, manager, viewer, analyst, app };
}
const PKT_TABLES = ['approvals', 'packet_findings', 'packet_sources', 'packet_timeline_events', 'claim_documents', 'evidence_packets'];
export async function clearTenantClaims(tenantId: string) {
  await withTriggersOff(PKT_TABLES, async (c) => {
    for (const t of [...PKT_TABLES, 'claims']) await c.query(`delete from ${q(t)} where tenant_id=$1`, [tenantId]);
  });
}
export async function removeClaims(tenantId: string, ids: string[]) {
  if (!ids.length) return;
  const list = ids.map((i) => lit(i)).join(',');
  await withTriggersOff(PKT_TABLES, async (c) => {
    await c.query(`delete from approvals where tenant_id=$1 and claim_id in (${list})`, [tenantId]);
    for (const t of ['packet_findings', 'packet_sources', 'packet_timeline_events']) {
      await c.query(`delete from ${t} where tenant_id=$1 and packet_id in (select id from evidence_packets where claim_id in (${list}))`, [tenantId]);
    }
    await c.query(`delete from evidence_packets where tenant_id=$1 and claim_id in (${list})`, [tenantId]);
    await c.query(`delete from claims where tenant_id=$1 and id in (${list})`, [tenantId]);
  });
}

export interface PktSpec { status?: string; findings?: Array<string | { rule: string; review?: boolean }>; sources?: string[] }
export interface ClaimSpec {
  num: string; status: string; perspective: 'SHIPPER' | 'CARRIER'; carrier?: string; rec: number; pend: number; ageMs: number;
  id?: string; review?: number; packets?: PktSpec[] | null; approvals?: number[];
}
export interface Inserted { id: string; spec: ClaimSpec; updatedAt: number; packetIds: string[] }
const ts = (ms: number) => `${lit(new Date(ms).toISOString())}::timestamptz`;
/** Bulk insert claims + packets (+ findings, sources, approvals) with the owner role. */
export async function insertClaims(tenantId: string, actorId: string, specs: ClaimSpec[], now = Date.now()): Promise<Inserted[]> {
  const out: Inserted[] = [];
  const claimsV: string[] = [];
  const pktV: string[] = [];
  const finV: string[] = [];
  const srcV: string[] = [];
  const apprV: string[] = [];
  for (const s of specs) {
    const id = s.id ?? randomUUID();
    const upd = now - s.ageMs;
    claimsV.push(`(${lit(id)},${lit(tenantId)},${lit(s.num)},${lit(s.carrier ?? 'Fixture Carrier')},'Fixture Shipper','${s.perspective}','${s.status}',${Math.min(s.rec + s.pend, 2147483647)},${s.rec},${s.pend},'USD',0,${ts(upd)},${ts(upd)})`);
    const packets: PktSpec[] = s.packets === null ? [] : s.packets ?? [{ findings: Array.from({ length: s.review ?? 0 }, (_, i) => ({ rule: `FILL-${i}`, review: true })) }];
    const pids: string[] = [];
    packets.forEach((p, pi) => {
      const pid = randomUUID();
      pids.push(pid);
      const last = pi === packets.length - 1;
      const st = p.status ?? (last ? s.status : 'SUPERSEDED');
      pktV.push(`(${lit(pid)},${lit(tenantId)},${lit(id)},${pi + 1},'${st}','${s.perspective}',${ts(upd)},'Fixture disclaimer','Fixture letter','USD',${s.rec},${s.pend},${lit('ab'.repeat(32))},${ts(upd)})`);
      (p.findings ?? []).forEach((f, fi) => {
        const rule = typeof f === 'string' ? f : f.rule;
        const review = typeof f === 'string' ? false : !!f.review;
        finV.push(`(${lit(randomUUID())},${lit(tenantId)},${lit(pid)},${fi},${lit(rule)},'Fixture finding','OVERCHARGE',100,'x','[]'::jsonb,0.9,${review},'[]'::jsonb)`);
      });
      (p.sources ?? []).forEach((d, si) => {
        srcV.push(`(${lit(randomUUID())},${lit(tenantId)},${lit(pid)},${lit(`fixture-${si}.txt`)},'${d}',${lit('cd'.repeat(32))},10,${si})`);
      });
      if (last) {
        for (const at of s.approvals ?? []) {
          apprV.push(`(${lit(randomUUID())},${lit(tenantId)},${lit(id)},${lit(pid)},${pi + 1},'APPROVE','Fixture approval reason','PENDING_REVIEW','APPROVED',${lit('ef'.repeat(32))},${lit(actorId)},'OWNER',${ts(at)})`);
        }
      }
    });
    out.push({ id, spec: s, updatedAt: upd, packetIds: pids });
  }
  await withAdmin(async (c) => {
    const chunk = async (head: string, rows: string[]) => {
      for (let i = 0; i < rows.length; i += 400) await c.query(`${head} VALUES ${rows.slice(i, i + 400).join(',')}`);
    };
    await chunk(`INSERT INTO claims (id,tenant_id,claim_number,carrier_name,shipper_name,perspective,status,amount_claimed_cents,recoverable_cents,pending_review_cents,currency,version,created_at,updated_at)`, claimsV);
    await chunk(`INSERT INTO evidence_packets (id,tenant_id,claim_id,revision,status,perspective,generated_at,disclaimer,demand_letter,currency,recoverable_cents,pending_review_cents,content_hash,created_at)`, pktV);
    await chunk(`INSERT INTO packet_findings (id,tenant_id,packet_id,ordinal,rule_id,title,direction,amount_cents,explanation,calculation,confidence,needs_human_review,citations)`, finV);
    await chunk(`INSERT INTO packet_sources (id,tenant_id,packet_id,filename,doc_type,sha256,size_bytes,ordinal)`, srcV);
    await chunk(`INSERT INTO approvals (id,tenant_id,claim_id,packet_id,packet_revision,action,reason,from_status,to_status,content_hash,actor_id,actor_role,created_at)`, apprV);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Independent oracles for Q6.1 and Q6.2 (written from the contract text, not from the implementation)
// ---------------------------------------------------------------------------------------------
export interface OClaim { id: string; num: string; status: string; perspective: string; carrier: string; rec: number; pend: number; updatedAt: number; pendingFindings: number; hasPacket: boolean; rules: string[] }
export function oraclePriority(cs: OClaim[], W: number, statuses: string[] = ['PENDING_REVIEW', 'APPROVED'], perspective?: string) {
  const elig = cs.filter((c) => statuses.includes(c.status) && c.hasPacket && (!perspective || c.perspective === perspective));
  const rows = elig.map((c) => ({ c, value: c.rec + Math.floor((c.pend * W) / 100) }));
  rows.sort((a, b) => b.value - a.value || b.c.rec - a.c.rec || a.c.updatedAt - b.c.updatedAt || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0));
  return rows.map((r, i) => ({
    rank: i + 1, id: r.c.id, num: r.c.num, value: r.value,
    parts: [
      { key: 'confirmed_recoverable', inputCents: r.c.rec, weightPercent: 100, contributionCents: r.c.rec },
      { key: 'pending_review', inputCents: r.c.pend, weightPercent: W, contributionCents: Math.floor((r.c.pend * W) / 100) },
    ],
    pendingFindingsCount: r.c.pendingFindings,
  }));
}
export const normCarrier = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
export function oracleSimilar(target: OClaim, all: OClaim[], limit: number, candLimit: number) {
  const cands = all
    .filter((c) => c.id !== target.id && ['APPROVED', 'SEND_READY', 'REJECTED'].includes(c.status) && c.hasPacket)
    .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(0, candLimit);
  const A = new Set(target.rules);
  const ta = target.rec + target.pend;
  const items: Array<{ id: string; pct: number; matches: Array<{ key: string; points: number; detail: string }>; updatedAt: number }> = [];
  for (const c of cands) {
    const B = new Set(c.rules);
    const tb = c.rec + c.pend;
    const inter = [...A].filter((x) => B.has(x));
    const union = new Set([...A, ...B]);
    const nc = normCarrier(target.carrier);
    const same = nc !== '' && nc === normCarrier(c.carrier) ? 35 : 0;
    const shared = A.size && B.size ? Math.floor((40 * inter.length) / union.size) : 0;
    const amt = ta > 0 && tb > 0 ? Math.floor((15 * Math.min(ta, tb)) / Math.max(ta, tb)) : 0;
    const persp = target.perspective === c.perspective ? 10 : 0;
    const pct = same + shared + amt + persp;
    if (!((same > 0 || shared > 0) && pct >= 30)) continue;
    const matches: Array<{ key: string; points: number; detail: string }> = [];
    if (same) matches.push({ key: 'same_carrier', points: same, detail: 'Same carrier' });
    if (shared) matches.push({ key: 'shared_rules', points: shared, detail: `Shared rules: ${inter.sort().join(', ')}` });
    if (amt) matches.push({ key: 'similar_amount', points: amt, detail: `Amounts ${usd(ta)} and ${usd(tb)}` });
    if (persp) matches.push({ key: 'same_perspective', points: persp, detail: `Same perspective (${target.perspective})` });
    items.push({ id: c.id, pct, matches, updatedAt: c.updatedAt });
  }
  items.sort((a, b) => b.pct - a.pct || b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { considered: cands.length, items: items.slice(0, limit) };
}

/** Read every field needed by the oracles straight from the database (owner role). */
export async function loadOClaims(tenantId: string): Promise<OClaim[]> {
  return withAdmin(async (c) => {
    const r = await c.query(
      `select c.id, c.claim_number, c.status::text as status, c.perspective::text as perspective, c.carrier_name, c.recoverable_cents, c.pending_review_cents,
              (extract(epoch from c.updated_at)*1000)::float8 as upd,
              lp.id as pid,
              coalesce((select count(*) from packet_findings f where f.packet_id = lp.id and f.needs_human_review), 0)::int as pf,
              coalesce((select array_agg(distinct f.rule_id) from packet_findings f where f.packet_id = lp.id), '{}') as rules
         from claims c
         left join lateral (select p.id from evidence_packets p where p.claim_id = c.id order by p.revision desc limit 1) lp on true
        where c.tenant_id = $1`, [tenantId]);
    return r.rows.map((x: any) => ({
      id: x.id, num: x.claim_number, status: x.status, perspective: x.perspective, carrier: x.carrier_name, rec: x.recoverable_cents, pend: x.pending_review_cents,
      updatedAt: Math.round(Number(x.upd)), pendingFindings: x.pf, hasPacket: !!x.pid, rules: x.rules as string[],
    }));
  });
}

// ---------------------------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------------------------
export const FLAG_KEYS = ['intelligence.provenance', 'intelligence.similar_claims', 'intelligence.worklist'] as const;
export const FLAG_DESCRIPTIONS: Record<string, string> = {
  'intelligence.provenance': 'Provenance summary on the claim sheet',
  'intelligence.similar_claims': 'Similar past claims on the claim sheet',
  'intelligence.worklist': 'Prioritised worklist page',
};
export async function resetFlags() {
  await withTriggersOff(['feature_flags'], async (c) => {
    await c.query(`update feature_flags set enabled=true, version=1, updated_by_id=null, updated_at=null, last_reason=null`);
  });
}
export async function setFlag(dev: Session, key: string, enabled: boolean, reason = 'acceptance flag change') {
  const cur = await dev.get('/platform/flags');
  expect(cur.status, cur.text).toBe(200);
  const f = cur.body.items.find((x: any) => x.key === key);
  if (f.enabled === enabled) return f;
  const r = await put(dev, `/platform/flags/${key}`, { enabled, expectedVersion: f.version, reason });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

export const stripReq = (b: any) => JSON.parse(JSON.stringify(b, (k, v) => (k === 'requestId' ? undefined : v)));
export function expectIdentical404(a: Res, b: Res) {
  expect(a.status, a.text).toBe(404);
  expect(b.status, b.text).toBe(404);
  expect(stripReq(a.body)).toEqual(stripReq(b.body));
}
export async function waitFor<T>(fn: () => Promise<T | undefined | false>, ms = 5000, step = 250): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error(`waitFor timed out after ${ms} ms`);
    await sleep(step);
  }
}
