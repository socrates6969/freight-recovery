> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse, ikke juridisk/finansiell fagoversettelse. Ved avvik gjelder den engelske originalen ([aws.md](aws.md)). Juridisk og skattemessig innhold er utkast og må gjennomgås av advokat/rådgiver før bruk.

# Utrullingsvei til AWS (kun design - ingenting er provisjonert)

> Status: **skisse**. Dette repoet gjør ingen AWS-kall, lagrer ingen legitimasjon, og
> Terraform i `deploy/terraform/` har aldri blitt anvendt. Applikasjonen har nå
> produksjons*fundamentet* (API-nøkkelautentisering + tenant-isolasjon, PostgreSQL-persistens med
> migrasjoner, en `StorageProvider`, sandboxet parsing, en hash-låst forsyningskjede), men den er
> fortsatt før produkt: **reelle integrasjoner, en tredjeparts penetrasjonstest og samsvarsgodkjenning
> kreves før reelle kundedata.** Dette dokumentet kartlegger hver applikasjonsfunksjon
> til AWS-tjenesten som må understøtte den.

## Målbilde

```
Internet -> WAF -> ALB (HTTPS, ACM cert) -> ECS Fargate service (freight-recovery container)
                                               |-> RDS PostgreSQL (private subnets)      FR_DATABASE_URL
                                               |-> S3 bucket, SSE-KMS (raw documents)    FR_STORAGE_BACKEND=s3
                                               |-> Secrets Manager (pepper, DB creds)    task-definition secrets
                                               '-> CloudWatch Logs
ECS run-task (one-shot):  python -m freight_recovery.db.migrate     (before each deploy)
ECS run-task (operator):  python -m freight_recovery.admin ...      (tenants / API keys)
```

## Hvordan applikasjonsfunksjonene kartlegges til AWS

| Applikasjonsfunksjon | AWS-kartlegging |
|---|---|
| **API-nøkkelautentisering** (`X-API-Key`, per tenant, HMAC-hashet i DB-en) | Nøklene ligger i `api_keys`-tabellen (RDS). HMAC-**pepperen** (`FR_API_KEY_PEPPER`, >= 32 tegn) er en Secrets Manager-hemmelighet injisert via `secrets:`-blokken i task-definisjonen (aldri en vanlig `environment:`-verdi, aldri i Terraform-state som klartekst). Roter ved å utstede nye nøkler først og deretter rotere pepperen (en endring av pepper ugyldiggjør alle eksisterende nøkler). Utsted/tilbakekall nøkler med en engangs-ECS-task som kjører `python -m freight_recovery.admin` med taskens egne hemmeligheter. Eventuelt også legg Cognito/OIDC eller en WAF-ratebegrensningsregel foran; API-nøkkelen er en maskinlegitimasjon, ikke en brukerinnlogging. |
| **Tenant-isolasjon** | Håndheves i applikasjonen (nøkkel -> tenant -> tenant-bundet repository; tenant-prefiksede S3-nøkler). Legg til PostgreSQL radnivåsikkerhet (row-level security) som dybdeforsvar. S3-bucket-policyen nekter offentlig tilgang; task-rollen er begrenset til bucketen/prefikset og KMS-nøkkelen den trenger. |
| **PostgreSQL-persistens** (SQLAlchemy + Alembic) | RDS PostgreSQL 16, private subnett, SG som kun tillater tjeneste-SG-en på 5432, kryptering i hvile (KMS), automatiske backuper + PITR, Multi-AZ i prod, `manage_master_user_password = true` (RDS-forvaltet hemmelighet i Secrets Manager). `FR_DATABASE_URL` settes sammen i en Secrets Manager-hemmelighet (`postgresql+psycopg://user:pass@host:5432/db`) og injiseres som task-hemmelighet. Bruk TLS (`?sslmode=require`) og tilkoblingspooling (`pool_pre_ping` er allerede på). |
| **Migrasjoner** | Engangs-ECS-task (`python -m freight_recovery.db.migrate`) i utrullingspipelinen *før* tjenesten ruller over til den nye task-definisjonen; aldri ved app-oppstart fra hver task. Expand/contract-endringer slik at forrige versjon fortsetter å fungere under utrullingen. |
| **Lagring av rådokumenter** (`StorageProvider`) | Lokalt filsystem er dev-standarden og må **ikke** brukes på Fargate (flyktig). Løft `S3Storage`-stubben: S3-bucket med SSE-KMS (stubben setter allerede `aws:kms` + valgfri `FR_STORAGE_S3_KMS_KEY_ID`), versjonering, blokkering av offentlig tilgang, livssyklus-/oppbevaringsregler, tilgangslogging; task-rollen gir `s3:PutObject/GetObject/DeleteObject` kun på `arn:...:bucket/<prefix>/*`, pluss KMS `GenerateDataKey/Decrypt`. Installer `boto3` i imaget når du løfter den (den er med vilje ikke i låsefilen i dag) og aktiver både `FR_STORAGE_BACKEND=s3` og `FR_STORAGE_S3_ENABLED=true`. |
| **Sandboxet parsing** (`FR_SANDBOX_*`) | Appen kjører allerede hver analyse i en tids- og minnebegrenset arbeiderunderprosess (kun prosessisolasjon). **Inneslutningen på OS-nivå** må du selv legge til i task-definisjonen: `readonlyRootFilesystem: true` (gi arbeideren et skrivbart `/tmp`-volum), `linuxParameters.capabilities.drop: [ALL]`, `user: 10001`, ingen nye privilegier, en stram seccomp-profil (sjekk hva lanseringstypen tillater: Fargate tar ikke egendefinerte seccomp-profiler), og **ingen utgående vei til internett eller til DB/S3 fra parseren**, som i praksis betyr å kjøre parsing som en **separat ECS-task/-tjeneste (eller Lambda) uten egress** som kalles av API-et. Dimensjoner CPU/minne for `FR_SANDBOX_MAX_WORKERS x FR_SANDBOX_MEMORY_MB` pluss API-prosessen (standard 4 x 1 GiB => start på 2 vCPU / 6 GiB, eller senk arbeiderinnstillingene). |
| **Docs-styring** | Behold `FR_DOCS_MODE=off` i produksjon (eller `auth`). `open` avvises når `FR_ENV=production`. |
| **Feilsikker konfigurasjon** | Imaget har `FR_ENV=production` som standard; appen nekter å starte uten pepper, PostgreSQL og `FR_SANDBOX_MODE=process`. En task som kræsjer i løkke på en dårlig hemmelighet er den tiltenkte feilmodusen. |
| **Forsyningskjede** | CI bygger imaget fra hash-låste requirements og skanner det (`trivy`); push til ECR med **uforanderlige tagger (git SHA)**, ECR scan-on-push og en livssyklus-policy. Utrulling via GitHub OIDC (ingen statiske AWS-nøkler): en `pull_request`-rolle for `terraform plan` (skrivebeskyttet) og en `refs/heads/master`-rolle for apply/utrulling, hver avgrenset til dette repoets `sub`-claim. |
| **Observerbarhet** | CloudWatch Logs (strukturert JSON anbefales); `freight_recovery.audit`-loggeren skriver linjer med `tenant/analysis/status/doc-hash-prefix` og aldri dokumentinnhold - send dem til en separat, tilgangsbegrenset loggruppe med oppbevaringspolicy. ALB target-group-helsesjekk på `/health` (kun liveness; den berører med vilje ikke DB-en). Alarmer: 5xx, usunne verter, task-restarter, 503-rate (arbeider-mottrykk), topper i 413/422. |
| **Grenser ved kanten** | WAF: ratebasert regel per IP/API-nøkkel-header, regel for request-body-størrelse (appen setter tak på 25 MiB; sett det samme ved ALB/WAF), forvaltede regelgrupper. Appen ratebegrenser ikke. |

## Miljøvariabler for ECS-task-definisjonen

| Kilde | Variabel |
|---|---|
| vanlig `environment` | `FR_ENV=production`, `FR_DOCS_MODE=off`, `FR_SANDBOX_MODE=process`, `FR_SANDBOX_MAX_WORKERS`, `FR_SANDBOX_MEMORY_MB`, `FR_SANDBOX_TIMEOUT_SECONDS`, `FR_STORAGE_BACKEND=s3`, `FR_STORAGE_S3_ENABLED=true`, `FR_STORAGE_S3_BUCKET`, `FR_STORAGE_S3_PREFIX`, `FR_STORAGE_S3_KMS_KEY_ID`, `FORWARDED_ALLOW_IPS=<ALB subnet CIDRs>` |
| Secrets Manager `secrets:` | `FR_DATABASE_URL`, `FR_API_KEY_PEPPER` |

## Vei til første utrulling (sjekkliste, ikke gjort)

1. Opprett state-backenden for hånd én gang (S3 + låsing, versjonert, kryptert), CloudTrail/GuardDuty/fakturaalarm, IAM Identity Center for mennesker; ingen langlevde nøkler.
2. Erstatt Terraform-skjelettet med en validert stack: VPC/subnett/endepunkter, SG-er, ALB + ACM + WAF, ECR (uforanderlig, scan ved push), ECS-klynge/task/tjeneste med herdingen ovenfor, RDS (kryptert, privat, backuper), S3-bucket + KMS-nøkkel, Secrets Manager-hemmeligheter (verdier satt utenfor båndet), IAM-eksekverings- og task-roller (ingen jokertegn), loggrupper (KMS, oppbevaring). Kjør `terraform fmt/validate`, `tflint` og `checkov` i CI før første plan.
3. GitHub OIDC-roller; utvid CI til å pushe til ECR med uforanderlige tagger og rulle ut (plan på PR, apply ved merge med en manuell godkjenningsport for prod).
4. Kjør migrasjons-tasken, og opprett deretter første tenant og nøkkel med admin-tasken. **Ikke eksponer ALB-lytteren før applikasjonsforutsetningene nedenfor er oppfylt (minimum: isolasjon av parseren på OS-nivå og en WAF foran).**
5. Dev-konto først; lasttest med store/fiendtlige PDF-er for å dimensjonere tasken og justere `FR_SANDBOX_*`.

## Applikasjonsforutsetninger før reelle kundedata (status)

- [x] Autentisering, autorisasjon per tenant, tenant-avgrenset persistens (dette repoet).
- [x] Avgrenset parsing (prosessisolasjon) (dette repoet). **[ ] Isolasjon på OS-nivå (ovenfor) er din oppgave.**
- [x] Hash-låste avhengigheter, `pip-audit`, `trivy`, Dependabot i CI (dette repoet; grønt i CI).
- [ ] Reelle ekstraksjons-/matchleverandører som erstatter `stub`; leverandør-/DPA-gjennomgang før noen hostet LLM.
- [ ] Malware-skanning av opplastinger, oppbevarings-/slettepolicy, manipulasjonssikker revisjonslogging.
- [ ] Ratebegrensning / WAF, TLS, privat nettverk, backuper/PITR (infrastruktur).
- [ ] **Uavhengig tredjeparts penetrasjonstest.**
- [ ] **Samsvarsgodkjenning** (kontraktskonfidensialitet, personvernlovgivning, SOC 2-beredskap etter hvert som kunder krever det).

## Terraform-skisse

Se `deploy/terraform/main.tf`. Det er et **skjelett** (variabler, en loggruppe, en tom ECS-klynge);
alt i tabellen ovenfor er fortsatt TODO. Kjør `terraform validate` først etter at nettverksinndata er fylt ut.
Remote state er med vilje ikke konfigurert ennå.

## Utenfor omfang / TODO

- Multi-AZ, autoskaleringspolicyer, DR, kostnadskontroller, oppsett for flere miljøer.
- CI/CD til ECR/ECS (GitHub OIDC-rolle) - `.github/workflows/ci.yml` kun tester, reviderer, skanner og røyktester imaget.
- SOC 2 / samsvarsarbeid.
