// Prisma CLI configuration (Prisma 7). The CLI (migrate/generate) uses the OWNER role URL
// (MIGRATE_DATABASE_URL); the running API uses DATABASE_URL (freight_app, RLS enforced) through
// the pg driver adapter, never this file.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'prisma/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrateUrl = process.env['MIGRATE_DATABASE_URL'];

export default defineConfig({
  schema: path.join(here, 'prisma', 'schema.prisma'),
  migrations: { path: path.join(here, 'prisma', 'migrations') },
  ...(migrateUrl ? { datasource: { url: migrateUrl } } : {}),
});
