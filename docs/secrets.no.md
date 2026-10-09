> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse, ikke juridisk/finansiell fagoversettelse. Ved avvik gjelder den engelske originalen ([secrets.md](secrets.md)). Juridisk og skattemessig innhold er utkast og må gjennomgås av advokat/rådgiver før bruk.

# Hemmeligheter, legitimasjon og overlevering til kjøper (nettplattformen)

> **Status (2026-10-09): før produkt, aldri utrullet.** Det finnes ennå ingen produksjonshemmelighet for
> TypeScript-nettplattformen: hver verdi som står i dette repoet, er en **offentlig** utviklings-, CI-
> eller testverdi. Denne siden lister alle hemmeligheter nettplattformen bruker, hvordan hver av dem lages
> og roteres, og hva selger og kjøper må gjøre når programvaren skifter eier. Trusselmodell (engelsk):
> [technical/web-platform-security.md](../technical/web-platform-security.md). Infrastruktur (engelsk):
> [infra/README.md](../infra/README.md).

Sannhetskilden for oppstartsreglene er `loadConfig` i `api/src/config.ts`. Hver regel nedenfor håndheves
der når API-et starter: API-et nekter å starte og navngir variabelen (aldri verdien).

## 1. Oppstartsregler for hemmeligheter

**I alle miljøer**

- `JWT_SECRET`, `CSRF_SECRET`, `REFRESH_PEPPER`: påkrevd, minst 43 tegn hver, og alle tre må være
  forskjellige.
- En verdi som ser ut som en plassholder, avvises: den inneholder `<`, `>` eller mellomrom, eller et ord
  som `changeme`, `placeholder`, `replace-me`, `your-secret` eller teksten `openssl rand`. Derfor kan
  `<...>`-linjene i `.env.example` aldri starte et API.
- `MFA_ENC_KEY`: påkrevd, standard base64 (`A-Z a-z 0-9 + /`, valgfri `=`-utfylling), og må dekodes til
  nøyaktig 32 byte.
- `API_KEY_PEPPER`: hvis den er **satt**, må den være minst 43 tegn, ikke se ut som en plassholder og
  være forskjellig fra `JWT_SECRET`, `CSRF_SECRET`, `REFRESH_PEPPER` og `MFA_ENC_KEY`. En verdi som er
  satt, men tom eller bare mellomrom, avvises overalt. Er den **ikke satt** utenfor produksjon, bruker
  API-et den offentlige utviklingsverdien i avsnitt 4.

**Bare i produksjon (`NODE_ENV=production`, som også er standard når `NODE_ENV` ikke er satt)**

- `API_KEY_PEPPER` og `REDIS_URL` er påkrevd.
- Ingen av de offentlige verdiene i `DOCUMENTED_DEV_SECRETS` (avsnitt 4) godtas for `JWT_SECRET`,
  `CSRF_SECRET`, `REFRESH_PEPPER`, `MFA_ENC_KEY` eller `API_KEY_PEPPER`.
- `JWT_SECRET`, `CSRF_SECRET`, `REFRESH_PEPPER` og `API_KEY_PEPPER` må bestå entropisjekken
  `secretEntropyProblem`:
  1. Anslått entropi = bit per tegn i det gjenkjente alfabetet (hex 4, base64 eller base64url 6, andre
     skrivbare tegn 6,5) ganger lengden. Den må være minst 160 bit.
  2. Verdien må ikke gjenta en kortere enhet (for eksempel `abab...` eller `0123456789` gjentatt).
  3. Minst 8 forskjellige tegn.
  4. **Dominansregel (eksakt binomisk grense).** Med `n` symboler (base64-utfylling `=` holdt utenfor)
     fra et alfabet med `A` tegn (hex 16, base64 64, andre skrivbare 94) avvises verdien som «dominert av
     ett tegn» når det hyppigste tegnet forekommer `k` ganger og `A * P(Binomial(n, 1/A) >= k) < 1e-12`.
     Venstresiden er en unionsgrense for «et tegn forekommer `k` ganger eller mer», så en virkelig
     tilfeldig hemmelighet avvises feilaktig med sannsynlighet **under 10^-12**. Tersklene blir: en hex-verdi
     på 64 tegn avvises ved 25 like tegn, hex på 40 tegn ved 20, base64 på 64 tegn
     (`openssl rand -base64 48`) ved 16, og base64 eller base64url med 43 symboler
     (`openssl rand -base64 32`) ved 14. (Dette erstattet den gamle grensen «mer enn en firedel av
     tegnene», som av og til avviste en ekte tilfeldig hemmelighet og gjorde en randomisert enhetstest
     ustabil; se rettingsrunde 2 i kjøringen `REQ-20261009-step4-intelligence`.)
- `API_KEY_PEPPER` må i tillegg ha minst 256 anslåtte bit: minst 64 hex-tegn eller minst 43
  base64-symboler.
- `MFA_ENC_KEY` får ikke noe entropianslag (det er rått nøkkelmateriale). Den må komme fra en CSPRNG.
- `DATABASE_URL` må inneholde `sslmode=require` eller `sslmode=verify-full` (`infra/` bruker
  `verify-full`).
- `S3_SSE` må være `aws:kms`, og `S3_KMS_KEY_ID` må være satt.

**Generere verdier.** Både hex og base64 består alle reglene:

```bash
openssl rand -hex 32        # 64 hex characters = 256 bits: JWT_SECRET, CSRF_SECRET, REFRESH_PEPPER, API_KEY_PEPPER
openssl rand -base64 48     # 64 base64 characters = 384 bits: same four secrets
openssl rand -base64 32     # MFA_ENC_KEY (must decode to exactly 32 bytes); also valid for API_KEY_PEPPER
# Without openssl:
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"   # MFA_ENC_KEY
```

Bruk en egen verdi for hver hemmelighet og hvert miljø. Lim aldri inn en produksjonsverdi i en chat, en
sak, en commit eller en skallkommando som lagres i skallhistorikken.

## 2. Oversikt: applikasjonshemmeligheter (API-et leser disse)

Kilde i produksjon: AWS Secrets Manager. `infra/secrets.tf` oppretter **bare beholderne** (aldri verdier)
med navnet `freight-recovery-<miljø>/<navn>`, kryptert med data-CMK-en.
`terraform -chdir=infra output secret_arns` skriver ut ARN-ene. `infra/ecs.tf` injiserer dem i API-tasken
med `secrets = [{ name, valueFrom = <ARN> }]`, og `infra/iam.tf` lar bare task-kjørerollen lese dem.

| Miljøvariabel | Formål | Leses i | Kilde i produksjon (navn i Secrets Manager) | Utviklingsstandard (offentlig, aldri i produksjon) | CI-verdi (offentlig) |
| --- | --- | --- | --- | --- | --- |
| `JWT_SECRET` | Signerer det kortlivede HS256-tilgangstokenet og MFA-trinntokenene (én HKDF-avledet nøkkel per formål) | `api/src/security/jwt.ts` (via `app.ts`) | `…/jwt-secret` | `local-dev-jwt-secret-not-for-production-0123456789abcdef` (`compose.web.yml`) | `ci-only-jwt-secret-not-for-production-0123456789abcdefghij` |
| `CSRF_SECRET` | HMAC av CSRF-tokenet med dobbel innsending (`nonce.HMAC(secret, nonce)`) | `api/src/security/csrf.ts`, `auth/cookies.ts`, `http/security.ts` | `…/csrf-secret` | `local-dev-csrf-secret-not-for-production-0123456789abcdef` | `ci-only-csrf-secret-not-for-production-0123456789abcdefghi` |
| `REFRESH_PEPPER` | HMAC-nøkkel for lagrede refresh-tokener, tokener for tilbakestilling og invitasjon, og e-posthashene som utestenging, innloggingsforsøk og ratebegrensningen for glemt passord bruker | `api/src/auth/session.ts`, `auth/service.ts`, `auth/users-routes.ts`, `app.ts` | `…/refresh-pepper` | `local-dev-refresh-pepper-not-for-production-0123456789abc` | `ci-only-refresh-pepper-not-for-production-0123456789abcdef` |
| `MFA_ENC_KEY` | AES-256-GCM-nøkkel for lagrede TOTP-hemmeligheter (AAD = bruker-id) | `api/src/auth/service.ts`, `security/crypto.ts`, `api/scripts/seed.ts` | `…/mfa-enc-key` | `bG9jYWwtZGV2LW1mYS1rZXktbm90LWZvci1wcm9kISE=` | `Y2ktb25seS1tZmEta2V5LW5vdC1mb3ItcHJvZHVjdCE=` |
| `API_KEY_PEPPER` | HMAC-SHA-256-nøkkel for lagrede hasher av tenantenes API-nøkler (steg 4) | `api/src/apikeys/key-material.ts` (via `apikeys/service.ts`, `auth/api-key-auth.ts`) | `…/api-key-pepper` | `local-dev-api-key-pepper-not-for-production-0123456789abcdef` (brukes også når variabelen ikke er satt utenfor produksjon) | `ci-only-api-key-pepper-not-for-production-0123456789abcdef` |
| `DATABASE_URL` | Kjøretidstilkobling som `freight_app` (ikke eier, `NOBYPASSRLS`, `NOINHERIT`); inneholder passordet til den rollen. Brukes også av `npm run eval -- --record` | `api/src/config.ts` → `db/client.ts`; `api/src/eval/cli.ts` | `…/database-url`, `postgresql://freight_app:<pw>@<rds>:5432/freight_web?sslmode=verify-full` | `postgresql://freight_app:local-dev-only@127.0.0.1:5433/freight_web` | `postgresql://freight_app:local-dev-only@127.0.0.1:5433/freight_web_test` |
| `MIGRATE_DATABASE_URL` | Migreringer og seed som `freight_owner` (skjemaeier, `BYPASSRLS`). Brukes aldri av det kjørende API-et | `api/prisma.config.ts`, `api/scripts/seed.ts` | **Ingen beholder i `infra/`** (mangel): operatøren gir den til migreringstasken (`infra/README.md` trinn 6) | `postgresql://freight_owner:local-dev-only@127.0.0.1:5433/freight_web` | `postgresql://freight_owner:local-dev-only@127.0.0.1:5433/freight_web_test` |
| `REDIS_URL` | Lager for ratebegrensning (alle begrensere, også de for API-nøkler). Inneholder Redis AUTH-tokenet | `api/src/app.ts` | `…/redis-url`, `rediss://:<token>@<primærendepunkt>:6379` | `redis://redis:6379` (compose, uten autentisering) | ikke satt (begrenserlager i minnet) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Statisk legitimasjon for objektlageret, **bare MinIO** | `api/src/storage/s3.ts`, `api/scripts/ensure-bucket.ts` | **Brukes ikke i AWS**: ECS-taskrollen gir S3-tilgang, så det finnes ingen statisk AWS-nøkkel | `localdev` / `localdev-minio-password` | `ci-only-minio` / `ci-only-minio-secret-not-for-production` |
| `S3_KMS_KEY_ID` | Hvilken KMS-nøkkel som krypterer lagrede dokumenter (en identifikator, ikke en hemmelighet) | `api/src/storage/s3.ts` | vanlig miljøvariabel: ARN-en til data-CMK-en (`infra/kms.tf`) | `fr-dev-key` (MinIO-nøkkelnavn) | `fr-ci-key` |

## 3. Oversikt: infrastruktur- og testlegitimasjon (API-et leser ikke disse)

| Legitimasjon | Formål | Hvor den ligger i produksjon | Offentlig utviklings-/CI-verdi |
| --- | --- | --- | --- |
| Passord for `freight_app` / `freight_owner` | De to databaserollene til applikasjonen (`api/db/init/00-roles.sql`) | Tilfeldige passord som operatøren setter inn når `00-roles.sql` kjøres mot RDS (`infra/README.md` trinn 4); passordet til `freight_app` ligger i `…/database-url` | `local-dev-only` |
| RDS-hovedbruker `fr_master` | Bare oppstart (opprette roller, kjøre migreringer ved behov) | RDS-styrt hemmelighet i Secrets Manager (`manage_master_user_password = true`, kryptert med data-CMK-en); Terraform ser aldri verdien | i.a. |
| `POSTGRES_PASSWORD` / `PGPASSWORD` | Superbruker i den lokale Postgres-containeren eller CI-containeren | brukes ikke i AWS | `local-dev-only` (compose), `ci-only` (CI) |
| Redis AUTH-token | Autentiserer API-et mot ElastiCache | `…/redis-auth-token` (og i `…/redis-url`); settes på replikeringsgruppen utenom Terraform, som ignorerer `auth_token` | ingen (ingen autentisering lokalt) |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | MinIO-administrator (utvikling, CI) | brukes ikke i AWS | `localdev` / `localdev-minio-password`; CI bruker CI-verdiene for S3 |
| `MINIO_KMS_SECRET_KEY` | MinIOs statiske KMS-nøkkel, slik at SSE-KMS virker lokalt | brukes ikke i AWS (AWS KMS-CMK-er, `enable_key_rotation = true`) | `fr-dev-key:bG9jYWwtZGV2LW1pbmlvLWttcy1rZXktMzJieXRlcyE=` (compose), `fr-ci-key:Y2ktb25seS1taW5pby1rbXMta2V5LW5vdC1wcm9kISE=` (CI) |
| `TEST_DATABASE_URL`, `TEST_ADMIN_DATABASE_URL` | Integrasjons- og akseptansetester | aldri i produksjon | `local-dev-only`-URL-ene til `freight_web_test` |
| Seed-kontoer og TOTP-hemmelighet | Syntetiske brukere fra `npm run db:seed` | aldri i produksjon: seeden kjører bare med `NODE_ENV=development|test` og en loopback- eller compose-databasevert (eller `ALLOW_SEED=1`), aldri mot en `amazonaws.com`-vert | passord `Synthetic-Pass-2026!`, TOTP `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` |
| Tenantenes API-nøkler `fr_live_<16 hex>_<43 tegn>` | Maskintilgang for én tenant (steg 4) | kjøretidsdata: bare `HMAC-SHA-256(API_KEY_PEPPER, secret)` lagres i `api_keys`; klarteksten vises én gang til den som oppretter nøkkelen | ingen i repoet |
| Tokener i dev-outbox | Tilbakestillings- og invitasjonstokener vist på `GET /api/v1/dev/outbox` | avvist i produksjon (`ENABLE_DEV_OUTBOX=true` stopper oppstarten) | genereres ved kjøring |
| AWS KMS-CMK-er (`data`, `logs`) | Krypterer RDS, S3, Redis, Secrets Manager og logger | nøkkelmaterialet forlater aldri KMS; automatisk rotasjon er slått på | i.a. |
| GitHub Actions | CI | `web-ci.yml` bruker **ingen repo-hemmeligheter** (`permissions: contents: read`); hver hemmelighetslignende verdi i filen er offentlig | se CI-kolonnen ovenfor |

**Andre komponenter i samme repo (ikke nettplattformen).** Python-tjenesten leser `FR_API_KEY_PEPPER`
(minst 32 tegn i produksjon) og `FR_DATABASE_URL`, og utsteder egne nøkler `frk_<8 hex>_<43 tegn>` med
`python -m freight_recovery.admin issue-key`. Den offentlige utviklingspepperen er
`local-dev-pepper-not-a-secret-0123456789abcdef` (`docker-compose.yml`, README). Se
[deploy/aws.no.md](../deploy/aws.no.md). Ta med disse i overleveringen også.

## 4. Offentlige verdier: bruk dem aldri i noe ekte

Hver verdi i kolonnene «Utviklingsstandard» og «CI-verdi» ovenfor er offentlig: den ligger i dette repoet
og historikken. Produksjon avviser de ti verdiene i `DOCUMENTED_DEV_SECRETS` (`api/src/config.ts`): de
fire `local-dev-…`- og fire `ci-only-…`-verdiene for `JWT_SECRET`, `CSRF_SECRET`, `REFRESH_PEPPER` og
`MFA_ENC_KEY`, pluss utviklings- og CI-verdien for `API_KEY_PEPPER`. Behandle disse som offentlige også,
selv om produksjon ikke sjekker dem ved navn: database- og MinIO-passordene ovenfor, MinIO-KMS-nøklene,
seed-passordet og TOTP-hemmeligheten, og alle litteraler i `api/test/**` og `*/test-acceptance/**` (noen
enhetstester bruker realistiske «produksjonslignende» verdier for å teste produksjonskontrollene; de er
offentlige fordi de er committet).

## 5. Rotasjon og konsekvenser

ECS leser verdier fra Secrets Manager når en task starter. Etter en endring må du tvinge en ny utrulling
(`aws ecs update-service --cluster <name> --service <name>-api --force-new-deployment`) slik at alle
tasker får den nye verdien. Under en rullerende utrulling kjører gamle og nye tasker side om side en kort
stund.

| Hemmelighet | Fremgangsmåte | Konsekvens |
| --- | --- | --- |
| `JWT_SECRET` | Ny tilfeldig verdi i `…/jwt-secret`, rull ut på nytt | Tilgangstokener (standard 10 minutter) og ventende MFA-trinntokener slutter å verifisere. Refresh-tokener berøres ikke (de avhenger av `REFRESH_PEPPER`), så en økt fortsetter via en refresh; i verste fall må brukerne logge inn på nytt. |
| `CSRF_SECRET` | Ny verdi i `…/csrf-secret`, rull ut på nytt | Eksisterende CSRF-tokener feiler: neste usikre forespørsel gir 403 til klienten henter et nytt token (`GET /api/v1/auth/csrf`, utstedes også ved innlogging og refresh). |
| `REFRESH_PEPPER` | Ny verdi i `…/refresh-pepper`, rull ut på nytt | **Alle økter avsluttes** når tilgangstokenet utløper (lagrede refresh-hasher stemmer ikke lenger). Utestående lenker for tilbakestilling og invitasjon slutter å virke (send nye invitasjoner). Historikk for utestenging og innloggingsforsøk nøklet på e-posthashen stemmer ikke lenger, så de tellerne starter i praksis på nytt. Ingen migrering er mulig: dette er enveishasher. |
| `MFA_ENC_KEY` | **Krever ny kryptering.** Hver lagret TOTP-hemmelighet er kryptert med AES-256-GCM med denne nøkkelen. Å bare bytte verdien gjør alle registrerte brukeres TOTP umulig å dekryptere, og stenger eiere, administratorer og plattformbrukere ute (gjenopprettingskoder er argon2-hasher og berøres ikke). Repoet har **intet verktøy for ny kryptering** (mangel): et engangsskript må dekryptere hver rad i `mfa_secrets` med den gamle nøkkelen og kryptere den med den nye (samme AAD = bruker-id) i én transaksjon mens API-et er stoppet, ellers må alle brukere registrere seg på nytt. | Planlagt nedetid; gjør det bare med et testet skript. |
| `API_KEY_PEPPER` | Ny verdi i `…/api-key-pepper`, rull ut på nytt | **Alle tenantenes API-nøkler slutter å virke samtidig** (401): de lagrede hashene ble beregnet med den gamle pepperen, og det finnes ingen støtte for to peppere. Nøkkellisten viser fortsatt nøklene som ACTIVE, så eiere og administratorer må lage nye nøkler, bytte klientene over og tilbakekalle de gamle. Varsle tenantene først. |
| `DATABASE_URL` (passordet til `freight_app`) | `ALTER ROLE freight_app PASSWORD '<new>'` (som `freight_owner` eller hovedbrukeren, fra innsiden av VPC-en), oppdater `…/database-url`, rull ut straks | Nye tilkoblinger med det gamle passordet feiler fra `ALTER`-øyeblikket; kjørende tasker beholder åpne tilkoblinger til de starter på nytt. Regn med et kort feilvindu. |
| `MIGRATE_DATABASE_URL` (passordet til `freight_owner`) | `ALTER ROLE freight_owner PASSWORD '<new>'`, oppdater der operatøren oppbevarer den | Ingen konsekvens for det kjørende API-et. |
| RDS-hovedpassord | Styres av RDS i Secrets Manager (rotasjonsplan der) | Ingen for API-et (det bruker aldri hovedbrukeren). |
| Redis AUTH-token | `aws elasticache modify-replication-group --replication-group-id <name>-redis --auth-token <new> --auth-token-update-strategy ROTATE --apply-immediately` (både gammelt og nytt godtas), oppdater `…/redis-auth-token` og `…/redis-url`, rull ut, og gjenta med `--auth-token-update-strategy SET` for å fjerne det gamle | Ingen nedetid i denne rekkefølgen. Tellere for ratebegrensning kan nullstilles. |
| Statiske MinIO-/S3-nøkler | Bare utvikling og CI. I AWS finnes ingen statiske nøkler å rotere (taskrolle) | i.a. |
| KMS-CMK-er | Automatisk årlig rotasjon av nøkkelmaterialet er på; gammelt materiale er fortsatt tilgjengelig for dekryptering | Ingen. |
| En tenants API-nøkkel | Eier/administrator lager en ny nøkkel, bytter klienten over og tilbakekaller deretter den gamle med en begrunnelse (Innstillinger > API keys) | Ingen, hvis det gjøres i den rekkefølgen. |

## 6. Sjekkliste for overlevering til kjøper

Eieren har til hensikt å selge programvaren. Målet: etter overleveringen er **ingen hemmelighet som
selgeren noen gang kjente, gyldig noe sted der kjøperen kjører programvaren**, og koden kjøperen mottar,
inneholder ingen hemmelighet. Den reneste veien er å overlevere **koden** (et ferskt git-speil) og la
kjøperen rulle ut i sin egen AWS-konto med nygenererte hemmeligheter.

### 6.1 Selger, før overleveringen

- [ ] Tilbakekall alle tenantenes API-nøkler (`fr_live_…`) i alle miljøer (Innstillinger > API keys, med
      begrunnelse), og alle nøkler i Python-tjenesten (`frk_…`).
- [ ] Deaktiver eller fjern selgerens personlige brukere, plattformkontoer (`PLATFORM_DEV`,
      `SUPER_ADMIN`) og tenantkontoer i alle miljøer.
- [ ] Roter eller slett alle hemmeligheter i avsnitt 2 og 3 som finnes i et miljø selgeren kontrollerer.
      Overtar kjøperen en eksisterende AWS-konto i stedet for å rulle ut på nytt, må kjøperen rotere
      **alle** etter overtakelsen (avsnitt 6.3), fordi selgeren kjente de gamle verdiene.
- [ ] Fjern selgerens tilganger: AWS IAM-brukere, -roller og tilgangsnøkler; GitHub-samarbeidspartnere,
      deploy-nøkler, personlige tilgangstokener og eventuelle Actions- eller miljøhemmeligheter
      (`gh secret list`, `gh secret list --env <name>`, `gh variable list` skal være tomme for dette
      repoet).
- [ ] Bekreft at ingen `.env`-fil noen gang er committet (bare `.env.example` skal vises):
      ```bash
      git log --all --diff-filter=A --name-only --format= | grep -E '(^|/)\.env(\.|$)' | sort -u
      ```
- [ ] Kjør historikkskanningene i avsnitt 6.2 og overlever resultatet.
- [ ] Lever et ferskt speil (`git clone --mirror <repo> freight-recovery.git`, deretter
      `git -C freight-recovery.git bundle create ../freight-recovery.bundle --all`). En fersk klon har
      ingen reflog, stash eller uoppnåelige objekter fra selgerens arbeidskopier.
- [ ] Ikke overlever Terraform-tilstand, `.env`-filer, skallhistorikk eller eksport fra Secrets Manager.
      Kjøperen lager ny tilstand i sin egen konto.

### 6.2 Kontroller at ingen hemmelighet ligger i git-historikken (selger og kjøper)

Kjør disse i det mottatte speilet eller en full klon. De søker i **hver commit på hver gren**, ikke bare
i dagens filer.

1. **Formater for ekte nøkler og legitimasjon** (ingen falske treff på denne dokumentasjonen: den
   inneholder bare mønsterteksten, aldri en hel nøkkel):
   ```bash
   git rev-list --all | xargs -n 50 git grep -I -h -o -E \
     'fr_live_[0-9a-f]{16}_[A-Za-z0-9_-]{43}|frk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}|(AKIA|ASIA)[0-9A-Z]{16}|-----BEGIN[A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36}|sk-[A-Za-z0-9_-]{32,}' \
     | sort | uniq -c
   ```
   Forventet per 2026-10-09: ett eneste treff, `frk_00000000_` etterfulgt av 43 `a`-er, den bevisst
   ugyldige nøkkelen som røyktesten av Python-containeren i `.github/workflows/ci.yml` bruker for å vise
   en 403. Alt annet er en hendelse: behandle verdien som lekket og roter den.
2. **Eksakte produksjonsverdier** (den avgjørende kontrollen, null falske treff). Legg de ekte verdiene
   for alle produksjonshemmeligheter, én per linje, i en fil utenfor repoet, søk etter dem og slett
   filen. Verdiene havner aldri på en kommandolinje eller i skallhistorikken:
   ```bash
   umask 077; printf '%s\n' "$(aws secretsmanager get-secret-value --secret-id <arn> --query SecretString --output text)" >> /tmp/prod-values.txt   # repeat per secret
   git rev-list --all | xargs -n 50 git grep -I -l -F -f /tmp/prod-values.txt | cut -d: -f2- | sort -u
   shred -u /tmp/prod-values.txt 2>/dev/null || rm -f /tmp/prod-values.txt
   ```
   Forventet: ingen utdata. (Før første utrulling finnes ingen produksjonsverdier, så det er ingenting å
   søke etter.)
3. **Valgfri, bred skanner:** [gitleaks](https://github.com/gitleaks/gitleaks) over hele historikken,
   for eksempel `gitleaks git --redact -v .` (gitleaks 8.19 og nyere; eldre versjoner bruker
   `gitleaks detect --redact -v`). Den rapporterer de offentlige utviklings-, CI- og testverdiene i
   avsnitt 2-4 og testlitteraler under `api/test/`; de er forventet. Alle andre funn er hendelser.
   Python-CI-en kjører allerede `trivy` med hemmelighetsskanning på repoet.

Blir en ekte hemmelighet noen gang funnet i historikken: roter den først (å skrive om historikken gjør
ikke en verdi som er pushet, hemmelig igjen), og avgjør deretter om historikken også skal skrives om.

### 6.3 Kjøper, etter overleveringen

- [ ] Generer **alle** hemmeligheter selv (avsnitt 1). Bruk aldri en verdi fra dette repoet, historikken,
      dokumentasjonen, compose eller CI: de er offentlige.
- [ ] Rull ut `infra/` i din egen AWS-konto med din egen fjern-tilstand. Terraform-tilstanden inneholder
      ingen hemmelige verdier per design: `infra/secrets.tf` oppretter bare beholdere (ingen
      `aws_secretsmanager_secret_version`), RDS bruker `manage_master_user_password` (tilstanden har bare
      hemmelighetens ARN), og Redis-`auth_token` settes aldri i koden og ignoreres av Terraform. Kontroller:
      ```bash
      terraform -chdir=infra state list | grep -E 'secret_version|random_' ; echo "exit=$? (1 = nothing found)"
      terraform -chdir=infra state pull | grep -E '"(auth_token|password|secret_string)": *"[^"]' ; echo "exit=$? (1 = nothing found)"
      ```
- [ ] Sett hemmelighetsverdiene utenom Terraform (`infra/README.md` trinn 2), lag et nytt Redis
      AUTH-token (trinn 3a) og nye tilfeldige passord for databaserollene (trinn 4).
- [ ] Kjør historikkskanningene i avsnitt 6.2 på nytt på kopien du mottok.
- [ ] Slå på hemmelighetsskanning og push-beskyttelse for repoet hos git-verten din.
- [ ] Overtok du et eksisterende miljø i stedet for å rulle ut på nytt: roter alle hemmeligheter i
      avsnitt 2 og 3 etter avsnitt 5 (også `MFA_ENC_KEY` med ny kryptering og `API_KEY_PEPPER`, som gjør
      alle API-nøkler ugyldige), tilbakekall alle API-nøkler og fjern alle kontoer selgeren opprettet.
- [ ] Behold `NODE_ENV=production` i produksjon: den slår på avvisningen av offentlige verdier,
      entropisjekkene og de andre produksjonsvaktene.
