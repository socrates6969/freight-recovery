-- Step 5 analysis (REQ-20261010-step5-analysis). Defence in depth behind claims/analysis.ts:
-- (1) a claim leaves AWAITING_ANALYSIS only to PENDING_REVIEW and only once revision 1 exists with a
--     recorded author (four-eyes FE-N2); nothing returns to AWAITING_ANALYSIS;
-- (2) a packet inserted for an AWAITING_ANALYSIS claim must be revision 1, PENDING_REVIEW, with an author.
-- SECURITY DEFINER (owner has BYPASSRLS) so a missing app.tenant_id cannot hide rows; tenant_id is matched
-- explicitly. Triggers only: no table or column change. Existing rows are not re-validated.
CREATE FUNCTION fr_claim_status_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'AWAITING_ANALYSIS' THEN
      RAISE EXCEPTION 'claim_transition_invalid' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status = 'AWAITING_ANALYSIS' AND NOT (NEW.status = 'PENDING_REVIEW' AND EXISTS (
         SELECT 1 FROM evidence_packets p
          WHERE p.claim_id = NEW.id AND p.tenant_id = NEW.tenant_id
            AND p.revision = 1 AND p.created_by_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'claim_transition_invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "claims_status_guard" BEFORE UPDATE OF "status" ON "claims"
  FOR EACH ROW EXECUTE FUNCTION fr_claim_status_guard();

CREATE FUNCTION fr_analysis_packet_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM claims c
              WHERE c.id = NEW.claim_id AND c.tenant_id = NEW.tenant_id AND c.status = 'AWAITING_ANALYSIS')
     AND NOT (NEW.revision = 1 AND NEW.created_by_id IS NOT NULL AND NEW.status = 'PENDING_REVIEW') THEN
    RAISE EXCEPTION 'analysis_packet_invalid' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "evidence_packets_analysis_guard" BEFORE INSERT ON "evidence_packets"
  FOR EACH ROW EXECUTE FUNCTION fr_analysis_packet_guard();

REVOKE ALL ON FUNCTION fr_claim_status_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION fr_analysis_packet_guard() FROM PUBLIC;
