-- Step 4 (Dev dashboard + Recovery Intelligence + tenant API keys).
-- Platform tables (feature_flags, eval_runs, eval_case_results) are NOT tenant-scoped: they hold no tenant
-- data, but still get ENABLE + FORCE row-level security with system-mode policies, least-privilege grants
-- and immutability triggers. api_keys is tenant-scoped (RLS FORCE; system mode may look a key up by
-- key_id for authentication). fr_platform_pipeline_stats returns aggregate counts only.
-- Hand-written in the style of `prisma migrate diff` output and hand-extended (security section at the
-- end), following 20261008000000_init and 20261009000000_import_export. Run as freight_owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'freight_app') THEN
    RAISE EXCEPTION 'Role freight_app does not exist. Apply api/db/init/00-roles.sql as a superuser before running migrations.';
  END IF;
END
$$;

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3),
    "last_reason" TEXT,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "eval_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "eval_set_id" TEXT NOT NULL,
    "eval_set_version" TEXT NOT NULL,
    "eval_set_sha256" CHAR(64) NOT NULL,
    "stage" TEXT NOT NULL,
    "k" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3) NOT NULL,
    "git_sha" TEXT,
    "provider_name" TEXT NOT NULL,
    "provider_version" TEXT NOT NULL,
    "parser_version" TEXT NOT NULL,
    "case_count" INTEGER NOT NULL,
    "runs_total" INTEGER NOT NULL,
    "runs_passed" INTEGER NOT NULL,
    "pass_hat_k_count" INTEGER NOT NULL,
    "pass_at_least_one_count" INTEGER NOT NULL,
    "flaky_case_count" INTEGER NOT NULL,
    "always_fail_count" INTEGER NOT NULL,
    "deterministic_cases" INTEGER NOT NULL,
    "wilson_low" DECIMAL(8,6) NOT NULL,
    "wilson_high" DECIMAL(8,6) NOT NULL,
    "pass_pow_curve" DOUBLE PRECISION[] NOT NULL,
    "run_ms_p50" DOUBLE PRECISION NOT NULL,
    "run_ms_p95" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_case_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "case_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "runs_passed" INTEGER NOT NULL,
    "k" INTEGER NOT NULL,
    "passed_all" BOOLEAN NOT NULL,
    "distinct_outputs" INTEGER NOT NULL,
    "first_failure_code" TEXT,
    "median_duration_ms" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "eval_case_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key_id" CHAR(16) NOT NULL,
    "name" TEXT NOT NULL,
    "secret_hash" CHAR(64) NOT NULL,
    "scopes" TEXT[] NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" UUID,
    "revoke_reason" TEXT,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "eval_runs_created_at_idx" ON "eval_runs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "eval_case_results_run_id_case_id_key" ON "eval_case_results"("run_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_id_key" ON "api_keys"("key_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_id_tenant_id_key" ON "api_keys"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "api_keys_tenant_id_created_at_idx" ON "api_keys"("tenant_id", "created_at" DESC);

-- CreateIndex (worklist: eligible claims of one tenant by status, oldest first among equal scores)
CREATE INDEX "claims_tenant_id_status_updated_at_id_idx" ON "claims"("tenant_id", "status", "updated_at" DESC, "id");

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "eval_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================================
-- Hand-extended security section
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- CHECK constraints
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_key_format" CHECK (key ~ '^[a-z][a-z0-9_.]{2,63}$');
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_version_positive" CHECK (version >= 1);
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_reason_length" CHECK (last_reason IS NULL OR char_length(last_reason) <= 500);

ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_set_id_length" CHECK (char_length(eval_set_id) BETWEEN 1 AND 64);
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_set_version_length" CHECK (char_length(eval_set_version) BETWEEN 1 AND 32);
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_set_sha256_hex" CHECK (eval_set_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_stage_known" CHECK (stage IN ('extraction'));
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_k_range" CHECK (k BETWEEN 1 AND 20);
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_git_sha_hex" CHECK (git_sha IS NULL OR git_sha ~ '^[0-9a-f]{7,40}$');
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_text_lengths"
  CHECK (char_length(provider_name) BETWEEN 1 AND 64 AND char_length(provider_version) BETWEEN 1 AND 64 AND char_length(parser_version) BETWEEN 1 AND 64);
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_times_ordered" CHECK (finished_at >= started_at);
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_case_count_positive" CHECK (case_count >= 1);
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_counts_consistent" CHECK (
  runs_total = case_count * k
  AND runs_passed BETWEEN 0 AND runs_total
  AND pass_hat_k_count >= 0
  AND pass_hat_k_count <= pass_at_least_one_count
  AND pass_at_least_one_count <= case_count
  AND flaky_case_count >= 0
  AND always_fail_count >= 0
  AND pass_hat_k_count + flaky_case_count + always_fail_count = case_count
  AND pass_at_least_one_count = case_count - always_fail_count
  AND deterministic_cases BETWEEN 0 AND case_count);
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_wilson_range" CHECK (wilson_low >= 0 AND wilson_low <= wilson_high AND wilson_high <= 1);
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_curve_length" CHECK (array_length(pass_pow_curve, 1) = k);
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_durations_non_negative" CHECK (run_ms_p50 >= 0 AND run_ms_p95 >= 0);

ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_case_id_length" CHECK (char_length(case_id) BETWEEN 1 AND 64);
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_category_length" CHECK (char_length(category) BETWEEN 1 AND 64);
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_k_range" CHECK (k BETWEEN 1 AND 20);
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_runs_passed_range" CHECK (runs_passed BETWEEN 0 AND k);
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_passed_all" CHECK (passed_all = (runs_passed = k));
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_distinct_outputs" CHECK (distinct_outputs BETWEEN 1 AND k);
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_failure_code" CHECK (first_failure_code IS NULL OR first_failure_code IN
  ('field_mismatch', 'missing_field', 'unexpected_field', 'wrong_doc_type', 'not_rejected', 'wrong_reject_reason', 'unexpected_reject', 'timeout', 'infrastructure'));
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_failure_iff_failed" CHECK ((first_failure_code IS NULL) = passed_all);
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_duration_non_negative" CHECK (median_duration_ms >= 0);

-- True when a text array has no duplicate elements (used by the api_keys scope CHECK).
CREATE FUNCTION fr_text_array_distinct(a text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT
  AS $$ SELECT count(DISTINCT x) = cardinality(a) FROM unnest(a) AS x $$;

ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_key_id_hex" CHECK (key_id ~ '^[0-9a-f]{16}$');
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_secret_hash_hex" CHECK (secret_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_scopes_valid" CHECK (
  cardinality(scopes) BETWEEN 1 AND 3
  AND scopes <@ ARRAY['claims.read', 'exports.claims', 'imports.write']::text[]
  AND fr_text_array_distinct(scopes));
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_name_length" CHECK (char_length(name) BETWEEN 1 AND 80);
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_revoke_reason_length" CHECK (revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 10 AND 500);
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_revocation_complete" CHECK (
  (revoked_at IS NULL AND revoked_by_id IS NULL AND revoke_reason IS NULL)
  OR (revoked_at IS NOT NULL AND revoked_by_id IS NOT NULL AND revoke_reason IS NOT NULL));
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_expiry_after_creation" CHECK (expires_at IS NULL OR expires_at > created_at);

-- ---------------------------------------------------------------------------------------------
-- Feature flag registry v1 (Q4): exactly these rows, never changed, never inserted at runtime.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "feature_flags" ("key", "enabled", "version") VALUES
  ('intelligence.provenance', true, 1),
  ('intelligence.similar_claims', true, 1),
  ('intelligence.worklist', true, 1);

-- ---------------------------------------------------------------------------------------------
-- Row-level security (FORCE: applies to the table owner too; only BYPASSRLS roles skip it).
-- ---------------------------------------------------------------------------------------------
-- Feature flags hold no tenant data: anyone with the grant may read; only system mode may update.
ALTER TABLE "feature_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_flags" FORCE ROW LEVEL SECURITY;
CREATE POLICY "feature_flags_read" ON "feature_flags" FOR SELECT USING (true);
CREATE POLICY "feature_flags_system_update" ON "feature_flags" FOR UPDATE
  USING (fr_system_mode()) WITH CHECK (fr_system_mode());

-- Evaluation records: visible and insertable only in system mode (a raw connection sees nothing).
ALTER TABLE "eval_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "eval_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "eval_runs_system_read" ON "eval_runs" FOR SELECT USING (fr_system_mode());
CREATE POLICY "eval_runs_system_insert" ON "eval_runs" FOR INSERT WITH CHECK (fr_system_mode());

ALTER TABLE "eval_case_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "eval_case_results" FORCE ROW LEVEL SECURITY;
CREATE POLICY "eval_case_results_system_read" ON "eval_case_results" FOR SELECT USING (fr_system_mode());
CREATE POLICY "eval_case_results_system_insert" ON "eval_case_results" FOR INSERT WITH CHECK (fr_system_mode());

-- API keys: the owning tenant, or system mode (the authentication path looks a key up by key_id).
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY "api_keys_tenant_isolation" ON "api_keys" FOR ALL
  USING (tenant_id = fr_current_tenant() OR fr_system_mode())
  WITH CHECK (tenant_id = fr_current_tenant() OR fr_system_mode());

-- ---------------------------------------------------------------------------------------------
-- Immutability triggers (they also block the owner role).
-- ---------------------------------------------------------------------------------------------
-- Feature flags: the key never changes and every update increments the version by exactly one.
CREATE FUNCTION fr_feature_flag_update_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'feature_flag_key_immutable' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'feature_flag_version' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "feature_flags_update_guard" BEFORE UPDATE ON "feature_flags" FOR EACH ROW EXECUTE FUNCTION fr_feature_flag_update_guard();
CREATE TRIGGER "feature_flags_no_delete" BEFORE DELETE ON "feature_flags" FOR EACH ROW EXECUTE FUNCTION fr_append_only();
CREATE TRIGGER "feature_flags_no_truncate" BEFORE TRUNCATE ON "feature_flags" FOR EACH STATEMENT EXECUTE FUNCTION fr_append_only();

CREATE TRIGGER "eval_runs_append_only" BEFORE UPDATE OR DELETE ON "eval_runs" FOR EACH ROW EXECUTE FUNCTION fr_append_only();
CREATE TRIGGER "eval_runs_no_truncate" BEFORE TRUNCATE ON "eval_runs" FOR EACH STATEMENT EXECUTE FUNCTION fr_append_only();
CREATE TRIGGER "eval_case_results_append_only" BEFORE UPDATE OR DELETE ON "eval_case_results" FOR EACH ROW EXECUTE FUNCTION fr_append_only();
CREATE TRIGGER "eval_case_results_no_truncate" BEFORE TRUNCATE ON "eval_case_results" FOR EACH STATEMENT EXECUTE FUNCTION fr_append_only();

-- API keys: identity, secret hash, scopes and expiry are immutable; revocation is set once and never
-- cleared; only last_used_at and the revocation columns may change.
CREATE FUNCTION fr_api_key_update_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.key_id IS DISTINCT FROM OLD.key_id OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.secret_hash IS DISTINCT FROM OLD.secret_hash OR NEW.scopes IS DISTINCT FROM OLD.scopes
     OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'api_key_immutable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.revoked_at IS NOT NULL
     AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by_id IS DISTINCT FROM OLD.revoked_by_id
          OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason) THEN
    RAISE EXCEPTION 'api_key_revocation_final' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "api_keys_update_guard" BEFORE UPDATE ON "api_keys" FOR EACH ROW EXECUTE FUNCTION fr_api_key_update_guard();
CREATE TRIGGER "api_keys_no_delete" BEFORE DELETE ON "api_keys" FOR EACH ROW EXECUTE FUNCTION fr_append_only();
CREATE TRIGGER "api_keys_no_truncate" BEFORE TRUNCATE ON "api_keys" FOR EACH STATEMENT EXECUTE FUNCTION fr_append_only();

-- ---------------------------------------------------------------------------------------------
-- Pipeline health for the Dev dashboard (R60): aggregate counts and latencies across all tenants.
-- Selects no tenant id, user id, name, file name, storage key, hash or claim number. System mode only.
-- Missing buckets are zero-filled by the API, not here.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION fr_platform_pipeline_stats(window_seconds int, stale_seconds int)
  RETURNS TABLE (metric text, label text, n bigint, p50_ms double precision, p95_ms double precision)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  cutoff timestamptz;
BEGIN
  IF NOT fr_system_mode() THEN
    RAISE EXCEPTION 'system mode required' USING ERRCODE = 'P0001';
  END IF;
  IF window_seconds IS NULL OR window_seconds < 60 OR window_seconds > 604800 THEN
    RAISE EXCEPTION 'window_seconds out of range' USING ERRCODE = 'P0001';
  END IF;
  IF stale_seconds IS NULL OR stale_seconds < 1 OR stale_seconds > 86400 THEN
    RAISE EXCEPTION 'stale_seconds out of range' USING ERRCODE = 'P0001';
  END IF;
  cutoff := now() - make_interval(secs => window_seconds);

  RETURN QUERY
    SELECT 'status'::text, d.status::text, count(*)::bigint, NULL::double precision, NULL::double precision
    FROM import_documents d WHERE d.created_at >= cutoff GROUP BY d.status;

  RETURN QUERY
    SELECT 'detected_type'::text, d.detected_type::text, count(*)::bigint, NULL::double precision, NULL::double precision
    FROM import_documents d WHERE d.created_at >= cutoff GROUP BY d.detected_type;

  RETURN QUERY
    SELECT 'reject_reason'::text, coalesce(d.reject_reason, 'unknown'), count(*)::bigint, NULL::double precision, NULL::double precision
    FROM import_documents d WHERE d.created_at >= cutoff AND d.status = 'REJECTED' GROUP BY coalesce(d.reject_reason, 'unknown');

  RETURN QUERY
    SELECT 'upload_to_parse'::text, 'all'::text, count(*)::bigint,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY t.ms),
           percentile_cont(0.95) WITHIN GROUP (ORDER BY t.ms)
    FROM (SELECT (extract(epoch FROM (d.parsed_at - d.created_at)) * 1000)::double precision AS ms
          FROM import_documents d WHERE d.created_at >= cutoff AND d.parsed_at IS NOT NULL) t;

  RETURN QUERY
    SELECT 'review_queue'::text, 'needs_review'::text, count(*)::bigint,
           CASE WHEN count(*) = 0 THEN NULL
                ELSE (extract(epoch FROM (now() - min(d.created_at))) * 1000)::double precision END,
           NULL::double precision
    FROM import_documents d WHERE d.status = 'NEEDS_REVIEW';

  RETURN QUERY
    SELECT 'stale_received'::text, 'received'::text, count(*)::bigint, NULL::double precision, NULL::double precision
    FROM import_documents d WHERE d.status = 'RECEIVED' AND d.created_at < now() - make_interval(secs => stale_seconds);

  RETURN QUERY
    SELECT 'awaiting_analysis'::text, 'claims'::text, count(*)::bigint, NULL::double precision, NULL::double precision
    FROM claims c WHERE c.status = 'AWAITING_ANALYSIS';
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Least-privilege grants for the runtime role (no TRUNCATE, no DELETE, no DDL).
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON "feature_flags", "eval_runs", "eval_case_results", "api_keys" FROM PUBLIC;
REVOKE ALL ON FUNCTION fr_platform_pipeline_stats(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION fr_feature_flag_update_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION fr_api_key_update_guard() FROM PUBLIC;
GRANT SELECT ON "feature_flags" TO freight_app;
GRANT UPDATE ("enabled", "version", "updated_by_id", "updated_at", "last_reason") ON "feature_flags" TO freight_app;
GRANT SELECT, INSERT ON "eval_runs", "eval_case_results" TO freight_app;
GRANT SELECT, INSERT ON "api_keys" TO freight_app;
GRANT UPDATE ("last_used_at", "revoked_at", "revoked_by_id", "revoke_reason") ON "api_keys" TO freight_app;
GRANT EXECUTE ON FUNCTION fr_platform_pipeline_stats(int, int) TO freight_app;
GRANT EXECUTE ON FUNCTION fr_text_array_distinct(text[]) TO freight_app;
