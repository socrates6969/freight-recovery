-- Hardening fix round 2 (REQ-20261012-hardening, C-FR2.2, finding H-4). Replaces the body of
-- fr_approval_four_eyes_ext_guard (migration 20261018000000_hardening, unchanged on disk) with one more refusal
-- basis: when the claim's `claim.analyzed` event records learnedLabelIdsTruncated = true (its learnedLabelIds list,
-- capped at 50, may omit an influencing label), approve/reject is refused for every label author of the tenant
-- before the analysis (actors of charge_label.set events with a lower chain seq, and creators of still-existing
-- labels created no later than the analysis). Same rule as api/src/audit/label-authors.ts.
-- CREATE OR REPLACE keeps the owner, the trigger and the privileges; EXECUTE is revoked from PUBLIC again anyway.
-- No table, column, index, grant, policy or enum change. Run as freight_owner.

CREATE OR REPLACE FUNCTION fr_approval_four_eyes_ext_guard() RETURNS trigger
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
                                     AND c.created_by_id = NEW.actor_id)))
    OR EXISTS (SELECT 1
                 FROM audit_events a
                WHERE a.tenant_id = NEW.tenant_id AND a.target_type = 'claim'
                  AND a.target_id = NEW.claim_id::text AND a.action = 'claim.analyzed'
                  AND a.metadata -> 'learnedLabelIdsTruncated' = 'true'::jsonb
                  AND (EXISTS (SELECT 1 FROM audit_events s
                                WHERE s.tenant_id = a.tenant_id AND s.target_type = 'charge_label'
                                  AND s.action = 'charge_label.set'
                                  AND s.seq < a.seq AND s.actor_id = NEW.actor_id)
                       OR EXISTS (SELECT 1 FROM charge_labels c
                                   WHERE c.tenant_id = a.tenant_id AND c.created_by_id = NEW.actor_id
                                     AND c.created_at <= a.created_at)))) THEN
    RAISE EXCEPTION 'four_eyes_required' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION fr_approval_four_eyes_ext_guard() FROM PUBLIC;
