-- Step 8 (REQ-20261011-ocean-dd): ocean demurrage and detention (D&D) invoices, tariffs, terminal calendars;
-- OCEAN_DD claims.
--   claims.kind     enum ClaimKind (FREIGHT, OCEAN_DD), NOT NULL DEFAULT 'FREIGHT' (existing rows FREIGHT);
--                   fixed at creation: a BEFORE UPDATE OF kind trigger refuses any change (claim_kind_immutable).
--   dd_tariffs      a tenant's D&D tariffs (free time, day bases, tiered daily rates per container size; JSON data).
--   dd_calendars    a tenant's terminal calendars (closed and shutout dates; JSON data).
--   dd_invoices     D&D invoices entered or imported as validated JSON; DRAFT until audited, then AUDITED with the
--                   OCEAN_DD claim it created and the audit snapshot. AUDITED rows cannot be updated or deleted
--                   (dd_invoice_immutable) and must reference an OCEAN_DD claim of the same tenant; inserts are
--                   always DRAFT. References to tariff, calendar and claim are composite (id, tenant_id) FKs,
--                   ON DELETE RESTRICT.
--   All three: ENABLE + FORCE row-level security with the standard tenant policy, REVOKE ALL FROM PUBLIC,
--   least-privilege column grants to freight_app (no TRUNCATE; tariffs/calendars are never deleted in this
--   step), CHECKs on every enumeration, text length, JSON shape/size and version.
-- Feature flag 'intelligence.ocean_dd' (enabled, version 1) is the kill switch of the D&D routes.
-- 46 CFR 541.4 (who may be billed) is deliberately NOT modelled: it was set aside by the D.C. Circuit on
-- 2025-09-23 and removed effective 2025-12-29 (FR Doc. 2025-23920).
-- Table/index/FK part generated with `prisma migrate diff --from-schema <schema at ce107d0> --to-schema
-- api/prisma/schema.prisma --script`; security part hand-written. Run as freight_owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'freight_app') THEN
    RAISE EXCEPTION 'Role freight_app does not exist. Apply api/db/init/00-roles.sql as a superuser before running migrations.';
  END IF;
END
$$;

-- CreateEnum
CREATE TYPE "ClaimKind" AS ENUM ('FREIGHT', 'OCEAN_DD');

-- AlterTable
ALTER TABLE "claims" ADD COLUMN     "kind" "ClaimKind" NOT NULL DEFAULT 'FREIGHT';

-- CreateTable
CREATE TABLE "dd_tariffs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "charge_type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dd_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dd_calendars" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dd_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dd_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "invoice_number" TEXT NOT NULL,
    "billing_party_name" TEXT NOT NULL,
    "invoice_date" DATE,
    "total_due_cents" INTEGER,
    "data" JSONB NOT NULL,
    "tariff_id" UUID,
    "calendar_id" UUID,
    "claim_id" UUID,
    "audited_at" TIMESTAMPTZ(3),
    "audit_snapshot" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dd_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dd_tariffs_tenant_id_name_key" ON "dd_tariffs"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "dd_tariffs_id_tenant_id_key" ON "dd_tariffs"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "dd_calendars_tenant_id_name_key" ON "dd_calendars"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "dd_calendars_id_tenant_id_key" ON "dd_calendars"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "dd_invoices_claim_id_key" ON "dd_invoices"("claim_id");

-- CreateIndex
CREATE INDEX "dd_invoices_tenant_id_updated_at_idx" ON "dd_invoices"("tenant_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "dd_invoices_tenant_id_billing_party_name_invoice_number_key" ON "dd_invoices"("tenant_id", "billing_party_name", "invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "dd_invoices_id_tenant_id_key" ON "dd_invoices"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "dd_invoices_claim_id_tenant_id_key" ON "dd_invoices"("claim_id", "tenant_id");

-- AddForeignKey
ALTER TABLE "dd_tariffs" ADD CONSTRAINT "dd_tariffs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dd_tariffs" ADD CONSTRAINT "dd_tariffs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dd_tariffs" ADD CONSTRAINT "dd_tariffs_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dd_calendars" ADD CONSTRAINT "dd_calendars_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dd_calendars" ADD CONSTRAINT "dd_calendars_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dd_calendars" ADD CONSTRAINT "dd_calendars_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dd_invoices" ADD CONSTRAINT "dd_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dd_invoices" ADD CONSTRAINT "dd_invoices_tariff_id_tenant_id_fkey" FOREIGN KEY ("tariff_id", "tenant_id") REFERENCES "dd_tariffs"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dd_invoices" ADD CONSTRAINT "dd_invoices_calendar_id_tenant_id_fkey" FOREIGN KEY ("calendar_id", "tenant_id") REFERENCES "dd_calendars"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dd_invoices" ADD CONSTRAINT "dd_invoices_claim_id_tenant_id_fkey" FOREIGN KEY ("claim_id", "tenant_id") REFERENCES "claims"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dd_invoices" ADD CONSTRAINT "dd_invoices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dd_invoices" ADD CONSTRAINT "dd_invoices_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------------------------
-- Security (hand-written)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "dd_tariffs" ADD CONSTRAINT "dd_tariffs_charge_type_valid" CHECK (charge_type IN ('DEMURRAGE', 'DETENTION'));
ALTER TABLE "dd_tariffs" ADD CONSTRAINT "dd_tariffs_direction_valid" CHECK (direction IN ('IMPORT', 'EXPORT'));
ALTER TABLE "dd_tariffs" ADD CONSTRAINT "dd_tariffs_text_length" CHECK (char_length(name) BETWEEN 1 AND 120 AND char_length(carrier) BETWEEN 1 AND 120);
ALTER TABLE "dd_tariffs" ADD CONSTRAINT "dd_tariffs_data_shape" CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 65536);
ALTER TABLE "dd_tariffs" ADD CONSTRAINT "dd_tariffs_version_positive" CHECK (version >= 1);
ALTER TABLE "dd_calendars" ADD CONSTRAINT "dd_calendars_name_length" CHECK (char_length(name) BETWEEN 1 AND 120);
ALTER TABLE "dd_calendars" ADD CONSTRAINT "dd_calendars_data_shape" CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 65536);
ALTER TABLE "dd_calendars" ADD CONSTRAINT "dd_calendars_version_positive" CHECK (version >= 1);
ALTER TABLE "dd_invoices" ADD CONSTRAINT "dd_invoices_status_valid" CHECK (status IN ('DRAFT', 'AUDITED'));
ALTER TABLE "dd_invoices" ADD CONSTRAINT "dd_invoices_text_length" CHECK (char_length(invoice_number) BETWEEN 1 AND 60 AND char_length(billing_party_name) BETWEEN 1 AND 120);
ALTER TABLE "dd_invoices" ADD CONSTRAINT "dd_invoices_data_shape" CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 262144);
ALTER TABLE "dd_invoices" ADD CONSTRAINT "dd_invoices_total_nonnegative" CHECK (total_due_cents IS NULL OR total_due_cents >= 0);
ALTER TABLE "dd_invoices" ADD CONSTRAINT "dd_invoices_version_positive" CHECK (version >= 1);
ALTER TABLE "dd_invoices" ADD CONSTRAINT "dd_invoices_audit_consistent" CHECK (
  (status = 'DRAFT' AND claim_id IS NULL AND audited_at IS NULL AND audit_snapshot IS NULL) OR
  (status = 'AUDITED' AND claim_id IS NOT NULL AND audited_at IS NOT NULL AND audit_snapshot IS NOT NULL));

-- claims.kind is fixed at creation (for every role).
CREATE FUNCTION fr_claim_kind_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN RAISE EXCEPTION 'claim_kind_immutable' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "claims_kind_guard" BEFORE UPDATE OF "kind" ON "claims" FOR EACH ROW EXECUTE FUNCTION fr_claim_kind_guard();

-- dd_invoices: inserted as DRAFT; AUDITED rows are immutable and undeletable; AUDITED needs an OCEAN_DD claim
-- of the same tenant. SECURITY DEFINER so a missing app.tenant_id cannot hide the claim row; tenant matched explicitly.
CREATE FUNCTION fr_dd_invoice_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'dd_invoice_insert_invalid' USING ERRCODE = 'P0001'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'AUDITED' THEN RAISE EXCEPTION 'dd_invoice_immutable' USING ERRCODE = 'P0001'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.status = 'AUDITED' AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.id = NEW.claim_id
       AND c.tenant_id = NEW.tenant_id AND c.kind = 'OCEAN_DD') THEN
    RAISE EXCEPTION 'dd_invoice_claim_invalid' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "dd_invoices_guard" BEFORE INSERT OR UPDATE OR DELETE ON "dd_invoices"
  FOR EACH ROW EXECUTE FUNCTION fr_dd_invoice_guard();
REVOKE ALL ON FUNCTION fr_claim_kind_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION fr_dd_invoice_guard() FROM PUBLIC;

ALTER TABLE "dd_tariffs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dd_tariffs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "dd_tariffs_tenant_isolation" ON "dd_tariffs" FOR ALL
  USING (tenant_id = fr_current_tenant()) WITH CHECK (tenant_id = fr_current_tenant());

ALTER TABLE "dd_calendars" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dd_calendars" FORCE ROW LEVEL SECURITY;
CREATE POLICY "dd_calendars_tenant_isolation" ON "dd_calendars" FOR ALL
  USING (tenant_id = fr_current_tenant()) WITH CHECK (tenant_id = fr_current_tenant());

ALTER TABLE "dd_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dd_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY "dd_invoices_tenant_isolation" ON "dd_invoices" FOR ALL
  USING (tenant_id = fr_current_tenant()) WITH CHECK (tenant_id = fr_current_tenant());

REVOKE ALL ON "dd_tariffs", "dd_calendars", "dd_invoices" FROM PUBLIC;
GRANT SELECT, INSERT ON "dd_tariffs", "dd_calendars" TO freight_app;
GRANT UPDATE ("name", "carrier", "charge_type", "direction", "data", "version", "updated_by_id", "updated_at") ON "dd_tariffs" TO freight_app;
GRANT UPDATE ("name", "data", "version", "updated_by_id", "updated_at") ON "dd_calendars" TO freight_app;
GRANT SELECT, INSERT, DELETE ON "dd_invoices" TO freight_app;
GRANT UPDATE ("status", "invoice_number", "billing_party_name", "invoice_date", "total_due_cents", "data", "tariff_id",
  "calendar_id", "claim_id", "audited_at", "audit_snapshot", "version", "updated_by_id", "updated_at") ON "dd_invoices" TO freight_app;

INSERT INTO "feature_flags" ("key", "enabled", "version") VALUES ('intelligence.ocean_dd', true, 1);
