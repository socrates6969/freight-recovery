# Secrets, credentials and buyer handover (web platform)

> **Status (2026-10-09): pre-product, never deployed.** No production secret of the TypeScript web
> platform exists yet: every value that appears in this repository is a **public** development, CI or
> test value. This page lists every secret the web platform uses, how to create and rotate each one,
> and what a seller and a buyer must do when the software changes hands. Norwegian:
> [secrets.no.md](secrets.no.md). Threat model:
> [technical/web-platform-security.md](../technical/web-platform-security.md). Infrastructure:
> [infra/README.md](../infra/README.md).

The source of truth for the start-up rules is `loadConfig` in `api/src/config.ts`. Every rule below is
enforced there when the API starts: the API refuses to start and names the variable (never its value).

## 1. Start-up rules for secrets

**In every environment**

- `JWT_SECRET`, `CSRF_SECRET`, `REFRESH_PEPPER`: required, at least 43 characters each, and all three
  must differ.
- A value that looks like a placeholder is refused: it contains `<`, `>` or whitespace, or a word such as
  `changeme`, `placeholder`, `replace-me`, `your-secret` or the text `openssl rand`. This is why the
  `<...>` lines in `.env.example` can never start an API.
- `MFA_ENC_KEY`: required, standard base64 (`A-Z a-z 0-9 + /`, optional `=` padding), and it must
  decode to exactly 32 bytes.
- `API_KEY_PEPPER`: if it is **set**, it must be at least 43 characters, must not look like a
  placeholder, and must differ from `JWT_SECRET`, `CSRF_SECRET`, `REFRESH_PEPPER` and `MFA_ENC_KEY`. A
  value that is set but empty or whitespace only is refused everywhere. If it is **unset** outside
  production, the API uses the public dev value listed in section 4.

**In production only (`NODE_ENV=production`, which is also the default when `NODE_ENV` is unset)**

- `API_KEY_PEPPER` and `REDIS_URL` are required.
- None of the public values in `DOCUMENTED_DEV_SECRETS` (section 4) is accepted for `JWT_SECRET`,
  `CSRF_SECRET`, `REFRESH_PEPPER`, `MFA_ENC_KEY` or `API_KEY_PEPPER`.
- `JWT_SECRET`, `CSRF_SECRET`, `REFRESH_PEPPER` and `API_KEY_PEPPER` must pass the entropy check
  `secretEntropyProblem`:
  1. Estimated entropy = bits per character of the detected alphabet (hex 4, base64 or base64url 6,
     other printable characters 6.5) times the length. It must be at least 160 bits.
  2. The value must not repeat a shorter unit (for example `abab...` or `0123456789` repeated).
  3. At least 8 distinct characters.
  4. **Dominance rule (exact binomial bound).** With `n` symbols (base64 `=` padding excluded) over an
     alphabet of size `A` (hex 16, base64 64, other printable 94), the value is refused as "dominated by
     one character" when its most frequent character occurs `k` times and
     `A * P(Binomial(n, 1/A) >= k) < 1e-12`. That left side is a union bound on "some character occurs
     `k` or more times", so a truly random secret is wrongly refused with probability **below 10^-12**.
     The resulting thresholds: a 64-character hex value is refused at 25 copies of one character, a
     40-character hex value at 20, a 64-character base64 value (`openssl rand -base64 48`) at 16, and a
     43-symbol base64 or base64url value (`openssl rand -base64 32`) at 14. (This replaced the old
     "more than a quarter of the characters" cap, which occasionally refused a genuinely random secret
     and made a randomized unit test flaky; see fix round 2 of run `REQ-20261009-step4-intelligence`.)
- `API_KEY_PEPPER` must also carry at least 256 estimated bits: at least 64 hex characters, or at least
  43 base64 symbols.
- `MFA_ENC_KEY` gets no entropy estimate (it is raw key material). It must come from a CSPRNG.
- `DATABASE_URL` must contain `sslmode=require` or `sslmode=verify-full` (`infra/` uses `verify-full`).
- `S3_SSE` must be `aws:kms` and `S3_KMS_KEY_ID` must be set.

**Generating values.** Both hex and base64 output pass every rule:

```bash
openssl rand -hex 32        # 64 hex characters = 256 bits: JWT_SECRET, CSRF_SECRET, REFRESH_PEPPER, API_KEY_PEPPER
openssl rand -base64 48     # 64 base64 characters = 384 bits: same four secrets
openssl rand -base64 32     # MFA_ENC_KEY (must decode to exactly 32 bytes); also valid for API_KEY_PEPPER
# Without openssl:
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"   # MFA_ENC_KEY
```

Use a different value for every secret and every environment. Never paste a production value into a
chat, a ticket, a commit or a shell command that is saved to shell history.

## 2. Inventory: application secrets (the API reads these)

Production source: AWS Secrets Manager. `infra/secrets.tf` creates the secret **containers only**
(never values) under the name `freight-recovery-<environment>/<name>`, encrypted with the data CMK.
`terraform -chdir=infra output secret_arns` prints the ARNs. `infra/ecs.tf` injects them into the API
task with `secrets = [{ name, valueFrom = <ARN> }]`, and `infra/iam.tf` lets only the task execution
role read them.

| Env var | Purpose | Read in | Production source (Secrets Manager name) | Dev default (public, never for production) | CI value (public) |
| --- | --- | --- | --- | --- | --- |
| `JWT_SECRET` | Signs the short-lived HS256 access token and the MFA step tokens (one HKDF-derived key per purpose) | `api/src/security/jwt.ts` (via `app.ts`) | `…/jwt-secret` | `local-dev-jwt-secret-not-for-production-0123456789abcdef` (`compose.web.yml`) | `ci-only-jwt-secret-not-for-production-0123456789abcdefghij` |
| `CSRF_SECRET` | HMAC of the double-submit CSRF token (`nonce.HMAC(secret, nonce)`) | `api/src/security/csrf.ts`, `auth/cookies.ts`, `http/security.ts` | `…/csrf-secret` | `local-dev-csrf-secret-not-for-production-0123456789abcdef` | `ci-only-csrf-secret-not-for-production-0123456789abcdefghi` |
| `REFRESH_PEPPER` | HMAC key for stored refresh tokens, password-reset and invite tokens, and the normalized-email hashes used by lockout, login attempts and the forgot-password limiter | `api/src/auth/session.ts`, `auth/service.ts`, `auth/users-routes.ts`, `app.ts` | `…/refresh-pepper` | `local-dev-refresh-pepper-not-for-production-0123456789abc` | `ci-only-refresh-pepper-not-for-production-0123456789abcdef` |
| `MFA_ENC_KEY` | AES-256-GCM key for stored TOTP secrets (AAD = user id) | `api/src/auth/service.ts`, `security/crypto.ts`, `api/scripts/seed.ts` | `…/mfa-enc-key` | `bG9jYWwtZGV2LW1mYS1rZXktbm90LWZvci1wcm9kISE=` | `Y2ktb25seS1tZmEta2V5LW5vdC1mb3ItcHJvZHVjdCE=` |
| `API_KEY_PEPPER` | HMAC-SHA-256 key for stored tenant API key hashes (step 4) | `api/src/apikeys/key-material.ts` (via `apikeys/service.ts`, `auth/api-key-auth.ts`) | `…/api-key-pepper` | `local-dev-api-key-pepper-not-for-production-0123456789abcdef` (also used when the variable is unset outside production) | `ci-only-api-key-pepper-not-for-production-0123456789abcdef` |
| `DATABASE_URL` | Runtime connection as `freight_app` (not owner, `NOBYPASSRLS`, `NOINHERIT`); contains that role's password. Also used by `npm run eval -- --record` | `api/src/config.ts` → `db/client.ts`; `api/src/eval/cli.ts` | `…/database-url`, `postgresql://freight_app:<pw>@<rds>:5432/freight_web?sslmode=verify-full` | `postgresql://freight_app:local-dev-only@127.0.0.1:5433/freight_web` | `postgresql://freight_app:local-dev-only@127.0.0.1:5433/freight_web_test` |
| `MIGRATE_DATABASE_URL` | Migrations and seed as `freight_owner` (schema owner, `BYPASSRLS`). Never used by the running API | `api/prisma.config.ts`, `api/scripts/seed.ts` | **No container in `infra/`** (gap): the operator supplies it to the one-off migrate task (`infra/README.md` step 6) | `postgresql://freight_owner:local-dev-only@127.0.0.1:5433/freight_web` | `postgresql://freight_owner:local-dev-only@127.0.0.1:5433/freight_web_test` |
| `REDIS_URL` | Rate-limit store (all limiters, including the API key limiters). Contains the Redis AUTH token | `api/src/app.ts` | `…/redis-url`, `rediss://:<token>@<primary endpoint>:6379` | `redis://redis:6379` (compose, no auth) | not set (in-memory limiter store) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Static object-store credentials, **MinIO only** | `api/src/storage/s3.ts`, `api/scripts/ensure-bucket.ts` | **Not used in AWS**: the ECS task role grants S3 access, so no static AWS key exists | `localdev` / `localdev-minio-password` | `ci-only-minio` / `ci-only-minio-secret-not-for-production` |
| `S3_KMS_KEY_ID` | Which KMS key encrypts stored documents (an identifier, not a secret) | `api/src/storage/s3.ts` | plain env var: ARN of the data CMK (`infra/kms.tf`) | `fr-dev-key` (MinIO key name) | `fr-ci-key` |

## 3. Inventory: infrastructure and test credentials (the API does not read these)

| Credential | Purpose | Where it lives in production | Public dev / CI value |
| --- | --- | --- | --- |
| `freight_app` / `freight_owner` role passwords | The two application database roles (`api/db/init/00-roles.sql`) | Random passwords substituted by the operator when applying `00-roles.sql` to RDS (`infra/README.md` step 4); `freight_app`'s is inside `…/database-url` | `local-dev-only` |
| RDS master user `fr_master` | Bootstrap only (create roles, run migrations if needed) | RDS-managed secret in Secrets Manager (`manage_master_user_password = true`, encrypted with the data CMK); Terraform never sees the value | n/a |
| `POSTGRES_PASSWORD` / `PGPASSWORD` | Superuser of the local or CI Postgres container | not used in AWS | `local-dev-only` (compose), `ci-only` (CI) |
| Redis AUTH token | Authenticates the API to ElastiCache | `…/redis-auth-token` (and inside `…/redis-url`); set on the replication group out of band; Terraform ignores `auth_token` | none (no auth locally) |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | MinIO admin (dev, CI) | not used in AWS | `localdev` / `localdev-minio-password`; CI uses the CI S3 values |
| `MINIO_KMS_SECRET_KEY` | MinIO's static KMS key, so SSE-KMS works locally | not used in AWS (AWS KMS CMKs, `enable_key_rotation = true`) | `fr-dev-key:bG9jYWwtZGV2LW1pbmlvLWttcy1rZXktMzJieXRlcyE=` (compose), `fr-ci-key:Y2ktb25seS1taW5pby1rbXMta2V5LW5vdC1wcm9kISE=` (CI) |
| `TEST_DATABASE_URL`, `TEST_ADMIN_DATABASE_URL` | Integration and acceptance tests | never in production | the `local-dev-only` URLs to `freight_web_test` |
| Seed accounts and TOTP secret | Synthetic users of `npm run db:seed` | never in production: the seed runs only with `NODE_ENV=development|test` and a loopback or compose database host (or `ALLOW_SEED=1`), never an `amazonaws.com` host | password `Synthetic-Pass-2026!`, TOTP `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` |
| Tenant API keys `fr_live_<16 hex>_<43 chars>` | Machine access for one tenant (step 4) | runtime data: only `HMAC-SHA-256(API_KEY_PEPPER, secret)` is stored in `api_keys`; the plaintext is shown once to the creator | none in the repository |
| Dev outbox tokens | Reset and invite tokens shown at `GET /api/v1/dev/outbox` | refused in production (`ENABLE_DEV_OUTBOX=true` stops the start) | generated at run time |
| AWS KMS CMKs (`data`, `logs`) | Encrypt RDS, S3, Redis, Secrets Manager, logs | key material never leaves KMS; automatic rotation is on | n/a |
| GitHub Actions | CI | `web-ci.yml` uses **no repository secrets** (`permissions: contents: read`); every secret-looking value in it is public | see the CI column above |

**Other components in the same repository (not the web platform).** The Python service reads
`FR_API_KEY_PEPPER` (at least 32 characters in production) and `FR_DATABASE_URL`, and issues its own
keys `frk_<8 hex>_<43 chars>` with `python -m freight_recovery.admin issue-key`. Its public dev pepper is
`local-dev-pepper-not-a-secret-0123456789abcdef` (`docker-compose.yml`, README). See
[deploy/aws.md](../deploy/aws.md). Include these in the handover too.

## 4. Public values: never use them anywhere real

Every value in the "Dev default" and "CI value" columns above is public: it is in this repository and
its history. Production refuses the ten values in `DOCUMENTED_DEV_SECRETS` (`api/src/config.ts`): the
four `local-dev-…` and four `ci-only-…` values for `JWT_SECRET`, `CSRF_SECRET`, `REFRESH_PEPPER` and
`MFA_ENC_KEY`, plus the dev and CI `API_KEY_PEPPER` values. Treat these as public too, even though
production does not test for them by name: the database and MinIO passwords above, the MinIO KMS keys,
the seed password and TOTP secret, and every literal in `api/test/**` and `*/test-acceptance/**`
(some unit tests use realistic-looking "prod-like" values to exercise the production checks; they are
public because they are committed).

## 5. Rotation procedures and their impact

ECS reads Secrets Manager values when a task starts. After changing a value, force a new deployment
(`aws ecs update-service --cluster <name> --service <name>-api --force-new-deployment`) so that every
task picks it up. During a rolling deployment, old and new tasks run side by side for a short time.

| Secret | Procedure | Impact |
| --- | --- | --- |
| `JWT_SECRET` | New random value in `…/jwt-secret`, redeploy | Access tokens (default 10 minutes) and pending MFA-step tokens stop verifying. Refresh tokens are not affected (they depend on `REFRESH_PEPPER`), so a session continues through a refresh; at worst users sign in again. |
| `CSRF_SECRET` | New value in `…/csrf-secret`, redeploy | Existing CSRF tokens fail: the next unsafe request answers 403 until the client fetches a new token (`GET /api/v1/auth/csrf`, also issued at login and refresh). |
| `REFRESH_PEPPER` | New value in `…/refresh-pepper`, redeploy | **Every session ends** when its access token expires (stored refresh-token hashes no longer match). Outstanding password-reset and invite links stop working (send new invites). Lockout and login-attempt history keyed by the email hash no longer matches, so those counters effectively restart. No migration is possible: these are one-way hashes. |
| `MFA_ENC_KEY` | **Needs re-encryption.** Every stored TOTP secret is AES-256-GCM-encrypted with this key. Changing the value alone makes every enrolled user's TOTP undecryptable, which locks OWNER, ADMIN and platform users out (recovery codes are argon2 hashes and are not affected). The repository has **no re-encryption tool** (gap): a one-off script must decrypt each `mfa_secrets` row with the old key and re-encrypt it with the new key (same AAD = user id) in one transaction while the API is stopped, or every user must re-enroll. | Planned downtime; do it only with a tested script. |
| `API_KEY_PEPPER` | New value in `…/api-key-pepper`, redeploy | **Every tenant API key stops working at once** (401): the stored hashes were computed with the old pepper, and there is no dual-pepper support. The key list still shows those keys as ACTIVE, so OWNER/ADMIN users must create new keys, switch their clients, and revoke the old keys. Announce it to tenants first. |
| `DATABASE_URL` (`freight_app` password) | `ALTER ROLE freight_app PASSWORD '<new>'` (as `freight_owner` or the master user, from inside the VPC), update `…/database-url`, redeploy immediately | New connections with the old password fail from the moment of the `ALTER`; running tasks keep their open connections until they restart. Expect a short error window. |
| `MIGRATE_DATABASE_URL` (`freight_owner` password) | `ALTER ROLE freight_owner PASSWORD '<new>'`, update wherever the operator keeps it | No impact on the running API. |
| RDS master password | Managed by RDS in Secrets Manager (rotation schedule there) | None for the API (it never uses the master user). |
| Redis AUTH token | `aws elasticache modify-replication-group --replication-group-id <name>-redis --auth-token <new> --auth-token-update-strategy ROTATE --apply-immediately` (old and new both accepted), update `…/redis-auth-token` and `…/redis-url`, redeploy, then repeat with `--auth-token-update-strategy SET` to drop the old token | No outage when done in this order. Rate-limit counters may reset. |
| MinIO / S3 static keys | Dev and CI only. In AWS there are no static keys to rotate (task role) | n/a |
| KMS CMKs | Automatic yearly key-material rotation is on; old material stays available for decryption | None. |
| A tenant API key | OWNER/ADMIN creates a new key, switches the client, then revokes the old key with a reason (Settings > API keys) | None if done in that order. |

## 6. Buyer handover checklist

The owner intends to sell the software. The goal: after the handover **no secret that the seller ever
knew is valid anywhere the buyer runs the software**, and the code the buyer receives contains no
secret. The cleanest path is to hand over the **code** (a fresh git mirror) and let the buyer deploy into
the buyer's own AWS account with newly generated secrets.

### 6.1 Seller, before the handover

- [ ] Revoke every tenant API key (`fr_live_…`) in every environment (Settings > API keys, with a reason),
      and every Python-service key (`frk_…`).
- [ ] Disable or remove the seller's personal user, platform (`PLATFORM_DEV`, `SUPER_ADMIN`) and tenant
      accounts in every environment.
- [ ] Rotate or destroy every secret in section 2 and 3 that exists in a seller-controlled environment.
      If the buyer takes over an existing AWS account instead of redeploying, the buyer must rotate
      **all** of them after taking control (section 6.3), because the seller knew the old values.
- [ ] Remove the seller's access: AWS IAM users, roles and access keys; GitHub collaborators, deploy
      keys, personal access tokens and any Actions or environment secrets (`gh secret list`,
      `gh secret list --env <name>`, `gh variable list` should be empty for this repository).
- [ ] Confirm that no `.env` file was ever committed (only `.env.example` should be listed):
      ```bash
      git log --all --diff-filter=A --name-only --format= | grep -E '(^|/)\.env(\.|$)' | sort -u
      ```
- [ ] Run the history scans of section 6.2 and hand over their output.
- [ ] Deliver a fresh mirror (`git clone --mirror <repo> freight-recovery.git`, then
      `git -C freight-recovery.git bundle create ../freight-recovery.bundle --all`). A fresh clone carries
      no reflog, stash or unreachable objects from the seller's working copies.
- [ ] Do not hand over Terraform state, `.env` files, shell history or Secrets Manager exports. The
      buyer creates new state in their own account.

### 6.2 Verify that no secret is in the git history (seller and buyer)

Run these in the received mirror or a full clone. They search **every commit on every branch**, not
only the current files.

1. **Real key and credential formats** (no false positives on these docs: the docs only contain the
   pattern text, never a full key):
   ```bash
   git rev-list --all | xargs -n 50 git grep -I -h -o -E \
     'fr_live_[0-9a-f]{16}_[A-Za-z0-9_-]{43}|frk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}|(AKIA|ASIA)[0-9A-Z]{16}|-----BEGIN[A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36}|sk-[A-Za-z0-9_-]{32,}' \
     | sort | uniq -c
   ```
   Expected on 2026-10-09: one hit only, `frk_00000000_` followed by 43 `a` characters, the deliberately
   invalid key that the Python container smoke test in `.github/workflows/ci.yml` uses to prove a 403.
   Anything else is an incident: treat that value as leaked and rotate it.
2. **Exact production values** (the decisive check, zero false positives). Put the real values of every
   production secret, one per line, into a file outside the repository, search for them, then delete the
   file. The values never appear on a command line or in shell history:
   ```bash
   umask 077; printf '%s\n' "$(aws secretsmanager get-secret-value --secret-id <arn> --query SecretString --output text)" >> /tmp/prod-values.txt   # repeat per secret
   git rev-list --all | xargs -n 50 git grep -I -l -F -f /tmp/prod-values.txt | cut -d: -f2- | sort -u
   shred -u /tmp/prod-values.txt 2>/dev/null || rm -f /tmp/prod-values.txt
   ```
   Expected: no output. (Before the first deployment there are no production values, so there is nothing
   to search for.)
3. **Optional, broad scanner:** [gitleaks](https://github.com/gitleaks/gitleaks) over the full history,
   for example `gitleaks git --redact -v .` (gitleaks 8.19 and later; older versions use
   `gitleaks detect --redact -v`). It reports the public dev, CI and test values listed in sections 2-4
   and test literals under `api/test/`; those are expected. Any other finding is an incident. The Python
   CI already runs `trivy` with secret scanning on the repository.

If a real secret is ever found in history: rotate it first (rewriting history does not un-leak a value
that was pushed), then decide whether to rewrite history as well.

### 6.3 Buyer, after the handover

- [ ] Generate **every** secret yourself (section 1). Never reuse a value from this repository, its
      history, the docs, compose or CI: they are public.
- [ ] Deploy `infra/` into your own AWS account with your own remote state. Terraform state contains no
      secret values by design: `infra/secrets.tf` creates containers only (no
      `aws_secretsmanager_secret_version`), RDS uses `manage_master_user_password` (state holds only the
      secret ARN), and the Redis `auth_token` is never set in code and is ignored by Terraform. Check it:
      ```bash
      terraform -chdir=infra state list | grep -E 'secret_version|random_' ; echo "exit=$? (1 = nothing found)"
      terraform -chdir=infra state pull | grep -E '"(auth_token|password|secret_string)": *"[^"]' ; echo "exit=$? (1 = nothing found)"
      ```
- [ ] Set the secret values out of band (`infra/README.md` step 2), generate a new Redis AUTH token
      (step 3a) and new random database role passwords (step 4).
- [ ] Re-run the history scans of section 6.2 on the copy you received.
- [ ] Turn on secret scanning and push protection for the repository on your git host.
- [ ] If you took over an existing environment instead of redeploying: rotate every secret in sections
      2 and 3 using section 5 (including `MFA_ENC_KEY` with re-encryption and `API_KEY_PEPPER`, which
      invalidates all API keys), revoke all API keys, and remove every account the seller created.
- [ ] Keep `NODE_ENV=production` in production: it enables the refusal of public values, the entropy
      checks and the other production guards.
