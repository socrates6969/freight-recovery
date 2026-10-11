-- Step 7 (REQ-20261011-fuel-outlook): fuel tables, claim fuel inputs, global public price store + flags.
-- Tenant tables:
--   fsc_tables          a tenant's carrier fuel-surcharge schedules (step / mpg / rows; per mile or percent).
--   claim_fuel_inputs   one ship date, miles and fuel table per claim (set before analysis).
--   Both: ENABLE + FORCE row-level security with the standard tenant policy, least-privilege column grants
--   (fsc_tables are never deleted: archive instead), CHECKs on every enumeration and bound.
-- Global tables (NOT tenant-scoped; public U.S. government price data only):
--   price_imports       one row per imported snapshot of a series (provenance: pinned source URL,
--                       retrieved-at, sha256 of the file, row count, date range).
--   price_observations  the observations of an import.
--   Both: ENABLE + FORCE row-level security (read for everyone with the grant, INSERT only in system mode),
--   SELECT-only grant for freight_app (the runtime API cannot write price data), and append-only triggers
--   that refuse UPDATE, DELETE and TRUNCATE for every role. Only the owner-connection importer writes.
-- Feature flags 'intelligence.cost_outlook' and 'intelligence.fuel_check' (enabled, version 1).
-- Table/index/FK part generated with `prisma migrate diff --from-schema <schema at 5f7eb7e> --to-schema
-- api/prisma/schema.prisma --script`; security part hand-written. Run as freight_owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'freight_app') THEN
    RAISE EXCEPTION 'Role freight_app does not exist. Apply api/db/init/00-roles.sql as a superuser before running migrations.';
  END IF;
END
$$;

-- CreateTable
CREATE TABLE "fsc_tables" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "price_series" TEXT NOT NULL,
    "effective_offset_days" INTEGER NOT NULL DEFAULT 2,
    "params" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fsc_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_fuel_inputs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "ship_date" DATE NOT NULL,
    "miles" DECIMAL(6,1),
    "fsc_table_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "claim_fuel_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_imports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "series_key" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "retrieved_at" DATE NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "row_count" INTEGER NOT NULL,
    "first_date" DATE NOT NULL,
    "last_date" DATE NOT NULL,
    "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_observations" (
    "import_id" UUID NOT NULL,
    "period_date" DATE NOT NULL,
    "value" DECIMAL(10,3) NOT NULL,

    CONSTRAINT "price_observations_pkey" PRIMARY KEY ("import_id","period_date")
);

-- CreateIndex
CREATE UNIQUE INDEX "fsc_tables_tenant_id_name_key" ON "fsc_tables"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "fsc_tables_id_tenant_id_key" ON "fsc_tables"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "claim_fuel_inputs_tenant_id_fsc_table_id_idx" ON "claim_fuel_inputs"("tenant_id", "fsc_table_id");

-- CreateIndex
CREATE UNIQUE INDEX "claim_fuel_inputs_tenant_id_claim_id_key" ON "claim_fuel_inputs"("tenant_id", "claim_id");

-- CreateIndex
CREATE INDEX "price_imports_series_key_imported_at_id_idx" ON "price_imports"("series_key", "imported_at" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "fsc_tables" ADD CONSTRAINT "fsc_tables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fsc_tables" ADD CONSTRAINT "fsc_tables_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fsc_tables" ADD CONSTRAINT "fsc_tables_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_fuel_inputs" ADD CONSTRAINT "claim_fuel_inputs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_fuel_inputs" ADD CONSTRAINT "claim_fuel_inputs_claim_id_tenant_id_fkey" FOREIGN KEY ("claim_id", "tenant_id") REFERENCES "claims"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_fuel_inputs" ADD CONSTRAINT "claim_fuel_inputs_fsc_table_id_tenant_id_fkey" FOREIGN KEY ("fsc_table_id", "tenant_id") REFERENCES "fsc_tables"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_fuel_inputs" ADD CONSTRAINT "claim_fuel_inputs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_fuel_inputs" ADD CONSTRAINT "claim_fuel_inputs_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "price_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------
-- Security (hand-written)
-- ---------------------------------------------------------------------------------------------
-- fsc_tables (tenant)
ALTER TABLE "fsc_tables" ADD CONSTRAINT "fsc_tables_kind_valid" CHECK (kind IN ('step', 'mpg', 'rows'));
ALTER TABLE "fsc_tables" ADD CONSTRAINT "fsc_tables_unit_valid" CHECK (unit IN ('per_mile', 'percent'));
ALTER TABLE "fsc_tables" ADD CONSTRAINT "fsc_tables_mpg_per_mile" CHECK (kind <> 'mpg' OR unit = 'per_mile');
ALTER TABLE "fsc_tables" ADD CONSTRAINT "fsc_tables_price_series_valid" CHECK (price_series = 'diesel_us');
ALTER TABLE "fsc_tables" ADD CONSTRAINT "fsc_tables_offset_range" CHECK (effective_offset_days BETWEEN 0 AND 6);
ALTER TABLE "fsc_tables" ADD CONSTRAINT "fsc_tables_name_length" CHECK (char_length(name) BETWEEN 1 AND 80);
ALTER TABLE "fsc_tables" ADD CONSTRAINT "fsc_tables_params_object"
  CHECK (jsonb_typeof(params) = 'object' AND pg_column_size(params) <= 16384);
ALTER TABLE "fsc_tables" ADD CONSTRAINT "fsc_tables_version_positive" CHECK (version >= 1);

ALTER TABLE "fsc_tables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fsc_tables" FORCE ROW LEVEL SECURITY;
CREATE POLICY "fsc_tables_tenant_isolation" ON "fsc_tables" FOR ALL
  USING (tenant_id = fr_current_tenant()) WITH CHECK (tenant_id = fr_current_tenant());

REVOKE ALL ON "fsc_tables" FROM PUBLIC;
GRANT SELECT, INSERT ON "fsc_tables" TO freight_app;
GRANT UPDATE ("name", "kind", "unit", "price_series", "effective_offset_days", "params", "version", "archived_at", "updated_by_id", "updated_at")
  ON "fsc_tables" TO freight_app;

-- claim_fuel_inputs (tenant)
ALTER TABLE "claim_fuel_inputs" ADD CONSTRAINT "claim_fuel_inputs_miles_range" CHECK (miles IS NULL OR (miles >= 0.1 AND miles <= 10000.0));
ALTER TABLE "claim_fuel_inputs" ADD CONSTRAINT "claim_fuel_inputs_ship_date_range" CHECK (ship_date BETWEEN DATE '1994-01-01' AND DATE '2100-12-31');
ALTER TABLE "claim_fuel_inputs" ADD CONSTRAINT "claim_fuel_inputs_version_positive" CHECK (version >= 1);

ALTER TABLE "claim_fuel_inputs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "claim_fuel_inputs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "claim_fuel_inputs_tenant_isolation" ON "claim_fuel_inputs" FOR ALL
  USING (tenant_id = fr_current_tenant()) WITH CHECK (tenant_id = fr_current_tenant());

REVOKE ALL ON "claim_fuel_inputs" FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON "claim_fuel_inputs" TO freight_app;
GRANT UPDATE ("ship_date", "miles", "fsc_table_id", "version", "updated_by_id", "updated_at") ON "claim_fuel_inputs" TO freight_app;

-- price_imports / price_observations (global, append-only, written only by the owner importer)
ALTER TABLE "price_imports" ADD CONSTRAINT "price_imports_series_key_valid" CHECK (series_key IN ('diesel_us', 'ppi_tl'));
ALTER TABLE "price_imports" ADD CONSTRAINT "price_imports_source_kind_valid" CHECK (source_kind IN ('file', 'bundled', 'fetch'));
ALTER TABLE "price_imports" ADD CONSTRAINT "price_imports_source_url_pinned" CHECK (
  (series_key, source_url) IN (
    ('diesel_us', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GASDESW'),
    ('ppi_tl', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=PCU4841214841212')
  )
);
ALTER TABLE "price_imports" ADD CONSTRAINT "price_imports_sha256_hex" CHECK (sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE "price_imports" ADD CONSTRAINT "price_imports_row_count_range" CHECK (row_count BETWEEN 1 AND 5000);
ALTER TABLE "price_imports" ADD CONSTRAINT "price_imports_dates_ordered" CHECK (first_date <= last_date);
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_value_positive" CHECK (value > 0);

ALTER TABLE "price_imports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_imports" FORCE ROW LEVEL SECURITY;
CREATE POLICY "price_imports_read" ON "price_imports" FOR SELECT USING (true);
CREATE POLICY "price_imports_system_insert" ON "price_imports" FOR INSERT WITH CHECK (fr_system_mode());

ALTER TABLE "price_observations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_observations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "price_observations_read" ON "price_observations" FOR SELECT USING (true);
CREATE POLICY "price_observations_system_insert" ON "price_observations" FOR INSERT WITH CHECK (fr_system_mode());

CREATE TRIGGER "price_imports_append_only" BEFORE UPDATE OR DELETE ON "price_imports" FOR EACH ROW EXECUTE FUNCTION fr_append_only();
CREATE TRIGGER "price_imports_no_truncate" BEFORE TRUNCATE ON "price_imports" FOR EACH STATEMENT EXECUTE FUNCTION fr_append_only();
CREATE TRIGGER "price_observations_append_only" BEFORE UPDATE OR DELETE ON "price_observations" FOR EACH ROW EXECUTE FUNCTION fr_append_only();
CREATE TRIGGER "price_observations_no_truncate" BEFORE TRUNCATE ON "price_observations" FOR EACH STATEMENT EXECUTE FUNCTION fr_append_only();

REVOKE ALL ON "price_imports", "price_observations" FROM PUBLIC;
GRANT SELECT ON "price_imports", "price_observations" TO freight_app;

INSERT INTO "feature_flags" ("key", "enabled", "version") VALUES ('intelligence.cost_outlook', true, 1), ('intelligence.fuel_check', true, 1);
