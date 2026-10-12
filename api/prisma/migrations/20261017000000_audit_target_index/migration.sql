-- Step 8 fix round 4 (REQ-20261011-ocean-dd, re-review R2): index for the D&D invoice-editor lookup of the
-- four-eyes check (audit_events by tenant and target). Index only: no table, column, grant, policy or
-- trigger change. Generated with `prisma migrate diff --from-schema <schema at 10f8941> --to-schema
-- api/prisma/schema.prisma --script`. Run as freight_owner.

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_target_type_target_id_idx" ON "audit_events"("tenant_id", "target_type", "target_id");
