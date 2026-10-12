-- Hardening (REQ-20261012-hardening). Defence in depth behind existing service checks:
-- (1) approve/reject refused at the database for D&D invoice editors (residual DD-6) and for authors of team charge
--     labels that influenced the claim's analysis (residual SC-1; service rule in claims/service.ts);
-- (2) a packet cannot become APPROVED/REJECTED/SEND_READY by UPDATE without a matching decision row in the same
--     transaction (residual FE-S2, packets only, UPDATE only);
-- (3) an AWAITING_ANALYSIS claim carries no amounts (residual SA-6).
-- SECURITY DEFINER (owner has BYPASSRLS) so a missing or foreign app.tenant_id cannot hide rows; tenant_id is matched
-- explicitly. No table, column, index, grant, policy or enum change; earlier migrations unchanged. Run as freight_owner.

CREATE FUNCTION fr_approval_four_eyes_ext_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.action IN ('APPROVE', 'REJECT') AND (
       EXISTS (SELECT 1 FROM dd_invoices i
                WHERE i.claim_id = NEW.claim_id AND i.tenant_id = NEW.tenant_id
                  AND (i.created_by_id = NEW.actor_id OR i.updated_by_id = NEW.actor_id
                       OR EXISTS (SELECT 1 FROM audit_events e
                                   WHERE e.tenant_id = i.tenant_id AND e.target_type = 'dd_invoice'
                                     AND e.target_id = i.id::text
                                     AND e.action IN ('dd_invoice.created', 'dd_invoice.updated')
                                     AND e.actor_id = NEW.actor_id)))
    OR EXISTS (SELECT 1
                 FROM audit_events a
                 CROSS JOIN LATERAL jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(a.metadata -> 'learnedLabelIds') = 'array'
                        THEN a.metadata -> 'learnedLabelIds' ELSE '[]'::jsonb END) AS l(label_id)
                WHERE a.tenant_id = NEW.tenant_id AND a.target_type = 'claim'
                  AND a.target_id = NEW.claim_id::text AND a.action = 'claim.analyzed'
                  AND (EXISTS (SELECT 1 FROM audit_events s
                                WHERE s.tenant_id = a.tenant_id AND s.target_type = 'charge_label'
                                  AND s.target_id = l.label_id AND s.action = 'charge_label.set'
                                  AND s.seq < a.seq AND s.actor_id = NEW.actor_id)
                       OR EXISTS (SELECT 1 FROM charge_labels c
                                   WHERE c.tenant_id = a.tenant_id AND c.id::text = l.label_id
                                     AND c.created_by_id = NEW.actor_id)))) THEN
    RAISE EXCEPTION 'four_eyes_required' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "approvals_four_eyes_ext_guard" BEFORE INSERT ON "approvals"
  FOR EACH ROW EXECUTE FUNCTION fr_approval_four_eyes_ext_guard();

CREATE FUNCTION fr_packet_decision_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('APPROVED', 'REJECTED', 'SEND_READY')
     AND NOT EXISTS (
       SELECT 1 FROM approvals ap
        WHERE ap.packet_id = NEW.id AND ap.tenant_id = NEW.tenant_id
          AND ap.to_status = NEW.status::text
          AND ap.action::text = CASE NEW.status::text WHEN 'APPROVED' THEN 'APPROVE'
                                                      WHEN 'REJECTED' THEN 'REJECT'
                                                      ELSE 'SEND_READY' END) THEN
    RAISE EXCEPTION 'packet_decision_unrecorded' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER "evidence_packets_decision_guard" AFTER UPDATE OF "status" ON "evidence_packets"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fr_packet_decision_guard();

ALTER TABLE "claims" ADD CONSTRAINT "claims_awaiting_amounts_zero"
  CHECK ("status" <> 'AWAITING_ANALYSIS' OR ("amount_claimed_cents" = 0 AND "recoverable_cents" = 0 AND "pending_review_cents" = 0));

REVOKE ALL ON FUNCTION fr_approval_four_eyes_ext_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION fr_packet_decision_guard() FROM PUBLIC;
