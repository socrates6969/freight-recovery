-- Step 6 (REQ-20261011-charge-intelligence): tenant charge-line labels + kill-switch flag.
-- charge_labels holds one reviewer label per (tenant, normalized charge description): the memory the
-- charge classifier consults on later analyses and in the charge-line view (no model training). It is
-- tenant-scoped: ENABLE + FORCE row-level security with the standard tenant policy, least-privilege grants
-- (SELECT, INSERT, DELETE and UPDATE of the mutable columns only; labels are deletable by design and the
-- tenant audit chain keeps their history), CHECKs on category, normalized text, description and version.
-- The feature flag row 'intelligence.charge_suggestions' (enabled, version 1) is the kill switch: off means
-- exact step-5 analysis and 404 on the charge routes.
-- Table/index/FK part generated with `prisma migrate diff --from-schema <schema at 51ea826> --to-schema
-- api/prisma/schema.prisma --script`; security part hand-written. Run as freight_owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'freight_app') THEN
    RAISE EXCEPTION 'Role freight_app does not exist. Apply api/db/init/00-roles.sql as a superuser before running migrations.';
  END IF;
END
$$;

-- CreateTable
CREATE TABLE "charge_labels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "normalized_text" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "charge_labels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "charge_labels_tenant_id_normalized_text_key" ON "charge_labels"("tenant_id", "normalized_text");

-- CreateIndex
CREATE UNIQUE INDEX "charge_labels_id_tenant_id_key" ON "charge_labels"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "charge_labels" ADD CONSTRAINT "charge_labels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_labels" ADD CONSTRAINT "charge_labels_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_labels" ADD CONSTRAINT "charge_labels_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------
-- Security (hand-written)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "charge_labels" ADD CONSTRAINT "charge_labels_category_valid"
  CHECK (category IN ('detention', 'linehaul', 'fuel', 'accessorial', 'other'));
ALTER TABLE "charge_labels" ADD CONSTRAINT "charge_labels_normalized_text_format"
  CHECK (normalized_text ~ '^[a-z0-9]+( [a-z0-9]+)*$' AND char_length(normalized_text) BETWEEN 1 AND 200);
ALTER TABLE "charge_labels" ADD CONSTRAINT "charge_labels_description_length"
  CHECK (char_length(description) BETWEEN 1 AND 200);
ALTER TABLE "charge_labels" ADD CONSTRAINT "charge_labels_version_positive" CHECK (version >= 1);

ALTER TABLE "charge_labels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "charge_labels" FORCE ROW LEVEL SECURITY;
CREATE POLICY "charge_labels_tenant_isolation" ON "charge_labels" FOR ALL
  USING (tenant_id = fr_current_tenant()) WITH CHECK (tenant_id = fr_current_tenant());

REVOKE ALL ON "charge_labels" FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON "charge_labels" TO freight_app;
GRANT UPDATE ("description", "category", "updated_by_id", "updated_at", "version") ON "charge_labels" TO freight_app;

INSERT INTO "feature_flags" ("key", "enabled", "version") VALUES ('intelligence.charge_suggestions', true, 1);
