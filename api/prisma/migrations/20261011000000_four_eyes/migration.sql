-- Four-eyes (REQ-20261009-four-eyes): an author of any revision of a claim cannot approve or reject it;
-- the uploader or a CORRECT/ADD editor of an import document cannot accept it. SECURITY DEFINER (owner has
-- BYPASSRLS) so a missing or wrong app.tenant_id cannot hide the rows; tenant_id is matched explicitly.
-- Defence in depth behind the service checks (claims/service.ts transition, imports/review-service.ts
-- acceptDocument). Triggers only: no table or column change. Existing rows are not re-validated.
CREATE FUNCTION fr_approval_four_eyes_guard() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NEW.action IN ('APPROVE', 'REJECT') AND EXISTS (
       SELECT 1 FROM evidence_packets p
        WHERE p.claim_id = NEW.claim_id AND p.tenant_id = NEW.tenant_id AND p.created_by_id = NEW.actor_id) THEN
    RAISE EXCEPTION 'four_eyes_required' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "approvals_four_eyes_guard" BEFORE INSERT ON "approvals"
  FOR EACH ROW EXECUTE FUNCTION fr_approval_four_eyes_guard();

CREATE FUNCTION fr_review_four_eyes_guard() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NEW.action = 'ACCEPT' AND (
       EXISTS (SELECT 1 FROM import_documents d
                WHERE d.id = NEW.document_id AND d.tenant_id = NEW.tenant_id AND d.uploaded_by_id = NEW.actor_id)
    OR EXISTS (SELECT 1 FROM import_review_decisions r
                WHERE r.document_id = NEW.document_id AND r.tenant_id = NEW.tenant_id
                  AND r.actor_id = NEW.actor_id AND r.action IN ('CORRECT', 'ADD'))) THEN
    RAISE EXCEPTION 'four_eyes_required' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "import_review_decisions_four_eyes_guard" BEFORE INSERT ON "import_review_decisions"
  FOR EACH ROW EXECUTE FUNCTION fr_review_four_eyes_guard();

REVOKE ALL ON FUNCTION fr_approval_four_eyes_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION fr_review_four_eyes_guard() FROM PUBLIC;
