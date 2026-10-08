/* eslint-disable */
// Raw Postgres access for inspection/tamper tests. Uses the `pg` driver the workspace ships.
import { TEST_ADMIN_DATABASE_URL, TEST_DATABASE_URL } from './env.js';

export type PgClient = {
  query: (q: string, v?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
  end: () => Promise<void>;
};

async function connect(url: string): Promise<PgClient> {
  let pg: any;
  try {
    const mod = 'pg'; // variable specifier: no compile-time dependency on driver typings
    pg = await import(/* @vite-ignore */ mod);
  } catch {
    throw new Error(
      'ACCEPTANCE PRECONDITION FAILED: the "pg" driver is not resolvable from api/test-acceptance. ' +
        'The spec allows only the driver the workspace already ships.',
    );
  }
  const Cl = pg.Client ?? pg.default?.Client;
  const c = new Cl({ connectionString: url });
  try {
    await c.connect();
  } catch (e) {
    throw new Error(
      `ACCEPTANCE PRECONDITION FAILED: Postgres unreachable (${(e as Error).message}). ` +
        'Start it: docker compose -f compose.web.yml up -d postgres ; npm run db:migrate:deploy ; npm run db:seed -- --reset',
    );
  }
  return c as PgClient;
}

export const adminDb = () => connect(TEST_ADMIN_DATABASE_URL);
export const appDb = () => connect(TEST_DATABASE_URL);

export async function withAdmin<T>(fn: (c: PgClient) => Promise<T>): Promise<T> {
  const c = await adminDb();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
export async function withApp<T>(fn: (c: PgClient) => Promise<T>): Promise<T> {
  const c = await appDb();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Full-database text dump (every row of every public table as JSON text), via the owner connection. */
export async function dumpAllText(exclude: string[] = []): Promise<string> {
  return withAdmin(async (c) => {
    const t = await c.query(
      `select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`,
    );
    let out = '';
    for (const r of t.rows) {
      if (exclude.includes(r.table_name)) continue;
      const q = await c.query(`select row_to_json(t)::text as j from "${r.table_name}" t`);
      for (const row of q.rows) out += row.j + '\n';
    }
    return out;
  });
}

/** Run `fn` on an owner session with user triggers disabled on `tables`; always re-enabled. */
export async function withTriggersOff<T>(
  tables: string[],
  fn: (c: PgClient) => Promise<T>,
): Promise<T> {
  const c = await adminDb();
  try {
    for (const t of tables) await c.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
    return await fn(c);
  } finally {
    for (const t of tables) {
      try {
        await c.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
      } catch {
        /* surfaced by subsequent assertions */
      }
    }
    await c.end();
  }
}
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
/** Build a syntactically complete INSERT for `table` (NOT NULL columns without defaults get typed dummies). */
export async function buildInsert(c: PgClient, table: string, overrides: Record<string, string>): Promise<string> {
  const cols = await c.query(
    `select column_name, data_type, udt_name, is_nullable, column_default, is_generated
       from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`,
    [table],
  );
  const names: string[] = [];
  const vals: string[] = [];
  for (const col of cols.rows) {
    const n = col.column_name as string;
    if (n in overrides) {
      names.push(q(n));
      vals.push(overrides[n]!);
      continue;
    }
    if (col.is_nullable === 'YES' || col.column_default != null || col.is_generated === 'ALWAYS') continue;
    let v: string;
    switch (col.data_type) {
      case 'uuid': v = 'gen_random_uuid()'; break;
      case 'integer': case 'bigint': case 'smallint': case 'numeric': v = '0'; break;
      case 'boolean': v = 'false'; break;
      case 'jsonb': v = `'{}'::jsonb`; break;
      case 'json': v = `'{}'::json`; break;
      case 'bytea': v = `'\\x00'::bytea`; break;
      case 'USER-DEFINED': {
        const e = await c.query(
          `select e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname=$1 order by e.enumsortorder limit 1`,
          [col.udt_name],
        );
        v = `'${e.rows[0]?.enumlabel}'::${q(col.udt_name)}`;
        break;
      }
      default:
        v = /timestamp|date/.test(col.data_type) ? 'now()' : `'acc'`;
    }
    names.push(q(n));
    vals.push(v);
  }
  return `INSERT INTO ${q(table)} (${names.join(',')}) VALUES (${vals.join(',')})`;
}

export async function tryQuery(c: PgClient, sql: string, params?: unknown[]) {
  try {
    const r = await c.query(sql, params);
    return { ok: true as const, rowCount: r.rowCount ?? 0, rows: r.rows, error: '' };
  } catch (e) {
    return { ok: false as const, rowCount: 0, rows: [] as any[], error: (e as Error).message };
  }
}

/** Run `fn` inside BEGIN..ROLLBACK on the given connection (control statements that must not persist). */
export async function inRollback<T>(c: PgClient, fn: () => Promise<T>): Promise<T> {
  await c.query('BEGIN');
  try {
    return await fn();
  } finally {
    await c.query('ROLLBACK');
  }
}