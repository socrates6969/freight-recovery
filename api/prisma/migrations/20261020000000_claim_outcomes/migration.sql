-- REQ-20261020-claim-outcomes: what happened after a claim was marked ready to demand.
--   claim_outcomes  one row per recorded event, entered by a person (no automatic reconciliation exists):
--                   kind OUTCOME (channel, carrier response, credited and paid cents, sent/closed dates, note)
--                   or AUDITED_NO_FINDING (an invoice was audited and nothing was found; channel OTHER,
--                   response NONE_YET, no amounts, no sent date). Append-only: fr_append_only refuses UPDATE,
--                   DELETE and TRUNCATE for every role; freight_app gets SELECT and INSERT only.
--                   References the claim with a composite (claim_id, tenant_id) FK, ON DELETE RESTRICT.
--   fr_claim_outcome_guard (BEFORE INSERT, SECURITY DEFINER, tenant matched explicitly): kind OUTCOME needs a
--                   claim in status SEND_READY of the same tenant; AUDITED_NO_FINDING needs an analysed claim
--                   (status <> AWAITING_ANALYSIS) of the same tenant. Mirrors the service checks.
--   ENABLE + FORCE row-level security with the standard tenant policy, REVOKE ALL FROM PUBLIC, CHECKs on every
--   enumeration, the note length, non-negative cents, the version and kind consistency.
-- Table/index/FK part follows the `prisma migrate diff` naming of the schema model ClaimOutcome; security
-- part hand-written. Run as freight_owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'freight_app') THEN
    RAISE EXCEPTION 'Role freight_app does not exist. Apply api/db/init/00-roles.sql as a superuser before running migrations.';
  END IF;
END
$$;

-- CreateTable
CREATE TABLE "claim_outcomes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OUTCOME',
    "recorded_by_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "channel" TEXT NOT NULL,
    "carrier_response" TEXT NOT NULL,
    "credited_cents" INTEGER,
    "paid_cents" INTEGER,
    "closed_at" TIMESTAMPTZ(3),
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "claim_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claim_outcomes_tenant_id_claim_id_recorded_at_idx" ON "claim_outcomes"("tenant_id", "claim_id", "recorded_at");

-- CreateIndex
CREATE INDEX "claim_outcomes_tenant_id_recorded_at_idx" ON "claim_outcomes"("tenant_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "claim_outcomes_id_tenant_id_key" ON "claim_outcomes"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "claim_outcomes" ADD CONSTRAINT "claim_outcomes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_outcomes" ADD CONSTRAINT "claim_outcomes_claim_id_tenant_id_fkey" FOREIGN KEY ("claim_id", "tenant_id") REFERENCES "claims"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_outcomes" ADD CONSTRAINT "claim_outcomes_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------------------------
-- Security (hand-written)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "claim_outcomes" ADD CONSTRAINT "claim_outcomes_kind_valid" CHECK (kind IN ('OUTCOME', 'AUDITED_NO_FINDING'));
ALTER TABLE "claim_outcomes" ADD CONSTRAINT "claim_outcomes_channel_valid" CHECK (channel IN ('EMAIL', 'PORTAL', 'PHONE', 'MAIL', 'OTHER'));
ALTER TABLE "claim_outcomes" ADD CONSTRAINT "claim_outcomes_response_valid"
  CHECK (carrier_response IN ('NONE_YET', 'ACCEPTED', 'PARTIAL', 'REJECTED', 'DISPUTED', 'WITHDRAWN'));
ALTER TABLE "claim_outcomes" ADD CONSTRAINT "claim_outcomes_note_length" CHECK (char_length(note) <= 500);
ALTER TABLE "claim_outcomes" ADD CONSTRAINT "claim_outcomes_credited_nonnegative" CHECK (credited_cents IS NULL OR credited_cents >= 0);
ALTER TABLE "claim_outcomes" ADD CONSTRAINT "claim_outcomes_paid_nonnegative" CHECK (paid_cents IS NULL OR paid_cents >= 0);
ALTER TABLE "claim_outcomes" ADD CONSTRAINT "claim_outcomes_version_positive" CHECK (version >= 1);
-- An AUDITED_NO_FINDING row carries no channel, response, amounts or sent date of its own.
ALTER TABLE "claim_outcomes" ADD CONSTRAINT "claim_outcomes_kind_consistent" CHECK (
  kind = 'OUTCOME' OR
  (channel = 'OTHER' AND carrier_response = 'NONE_YET' AND sent_at IS NULL AND credited_cents IS NULL AND paid_cents IS NULL));

-- Append-only for every role (fr_append_only comes from the init migration).
CREATE TRIGGER "claim_outcomes_append_only" BEFORE UPDATE OR DELETE ON "claim_outcomes" FOR EACH ROW EXECUTE FUNCTION fr_append_only();
CREATE TRIGGER "claim_outcomes_no_truncate" BEFORE TRUNCATE ON "claim_outcomes" FOR EACH STATEMENT EXECUTE FUNCTION fr_append_only();

-- The claim must be in the right state for the kind of outcome. SECURITY DEFINER so a missing app.tenant_id
-- cannot hide the claim row; the tenant is matched explicitly.
CREATE FUNCTION fr_claim_outcome_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  claim_status text;
BEGIN
  SELECT c.status::text INTO claim_status FROM claims c WHERE c.id = NEW.claim_id AND c.tenant_id = NEW.tenant_id;
  IF claim_status IS NULL THEN RAISE EXCEPTION 'claim_outcome_claim_invalid' USING ERRCODE = 'P0001'; END IF;
  IF NEW.kind = 'OUTCOME' AND claim_status <> 'SEND_READY' THEN
    RAISE EXCEPTION 'claim_outcome_state_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.kind = 'AUDITED_NO_FINDING' AND claim_status = 'AWAITING_ANALYSIS' THEN
    RAISE EXCEPTION 'claim_outcome_state_invalid' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "claim_outcomes_guard" BEFORE INSERT ON "claim_outcomes" FOR EACH ROW EXECUTE FUNCTION fr_claim_outcome_guard();
REVOKE ALL ON FUNCTION fr_claim_outcome_guard() FROM PUBLIC;

ALTER TABLE "claim_outcomes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "claim_outcomes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "claim_outcomes_tenant_isolation" ON "claim_outcomes" FOR ALL
  USING (tenant_id = fr_current_tenant()) WITH CHECK (tenant_id = fr_current_tenant());

REVOKE ALL ON "claim_outcomes" FROM PUBLIC;
GRANT SELECT, INSERT ON "claim_outcomes" TO freight_app;