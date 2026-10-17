/**
 * Base Prisma client (pg driver adapter). The base client is NEVER exported from the app's public
 * surface: request handlers only ever see the tenant-scoped client (tenant.ts); auth/platform/audit
 * use the system transaction helper (system.ts). Lint and api/test/architecture.test.ts enforce this.
 */
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';

export type BaseClient = PrismaClient;
export { Prisma } from '../generated/prisma/client.js';
export type { Prisma as PrismaTypes } from '../generated/prisma/client.js';

export interface DbOptions {
  /** Maximum pool size. */
  max?: number;
}

export function createDb(databaseUrl: string, opts: DbOptions = {}): BaseClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    max: opts.max ?? 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    application_name: 'fr-api',
    // The driver adapter mis-reads timestamptz values when the server session TimeZone is not UTC
    // (seen with a non-UTC local cluster); pin every session to UTC ("GMT" is built into every PostgreSQL).
    options: '-c TimeZone=GMT',
  });
  return new PrismaClient({ adapter });
}
