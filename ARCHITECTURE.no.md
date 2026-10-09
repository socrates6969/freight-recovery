> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse, ikke juridisk/finansiell fagoversettelse. Ved avvik gjelder den engelske originalen ([ARCHITECTURE.md](ARCHITECTURE.md)). Juridisk og skattemessig innhold er utkast og må gjennomgås av advokat/rådgiver før bruk.

# Arkitektur (MVP, før produkt)

```
files (PDF/CSV/TXT)
   |  ingest/        bytes -> RawDocument (text, doc_type, sha256)
   v
 extraction/        RawDocument -> Invoice | RateConfirmation | BillOfLading   (utskiftbar leverandør)
   |  extract_bundle -> ExtractedBundle (+ warnings)
   v
 rules/             ExtractedBundle -> Findings -> RecoveryResult (per perspektiv)
   v
 evidence/          dokumenter + funn + beregninger + UTKAST til brev -> EvidencePacket (+ markdown)
   v
 api/ (FastAPI) og cli.py     tynne adaptere over pipeline.run_pipeline
```

Forespørselsløpet i API-et (produksjonsfundament):

```
request -> BodySizeLimitMiddleware -> AuthenticatedRoute (API-nøkkel -> tenant, FØR body parses)
        -> lagre Analysis(running) + rådokumenter via StorageProvider      [db/, storage/; tenant-avgrenset]
        -> sandbox-arbeiderprosess: ingest -> extract -> rules -> evidence  [sandbox/; tids- og minnebegrenset]
        -> marker Analysis succeeded|failed (+ resultat-JSON)               [tenant-avgrenset repository]
```

## Moduler (`src/freight_recovery/`)
| Modul | Ansvar |
|---|---|
| `models.py` | pydantic v2-domenetyper; penger er `Decimal`; `Finding`, `RecoveryResult`, `EvidencePacket` |
| `config.py` | miljødrevet `Settings` (`FR_*`), hemmeligheter utelatt fra `repr`, `validate_for_production()`-vern |
| `keys.py`, `auth.py` | API-nøkkelformat/HMAC-hashing; `AuthenticatedRoute` finner tenant fra nøkkelen før body leses (401 ingen nøkkel / 403 ugyldig) |
| `admin.py` | operatør-CLI: tenanter og API-nøkler (`python -m freight_recovery.admin`) |
| `db/` | SQLAlchemy 2-tabeller (`tables.py`), tenant-bundet `AnalysisRepository` og ubegrenset `TenantAdminRepository` (`repository.py`), engine-/sesjonsfabrikker, Alembic-migrasjoner (`migrations/`, `migrate.py`) |
| `storage/` | `StorageProvider`-grensesnitt: `LocalFilesystemStorage` (standard), `S3Storage`-stub bak to flagg; tenant-prefiksede nøkler bygget kun av validerte id-er |
| `sandbox/` | `run_isolated` / `SandboxRunner`: én arbeiderunderprosess per jobb med grenser for veggklokketid, minne, CPU og utdata, og et rent miljø; `targets.analyze` er analysejobben |
| `ingest/` | dekoder PDF (pdfplumber, lat import) / CSV (flatet ut til `Key: Value`) / TXT; klassifiserer dokumenttype; sha256 |
| `extraction/` | `ExtractionProvider`-Protocol; `DeterministicStubProvider` (standard, offline); `LLMExtractionProvider`-plassholder; `extract_bundle` |
| `rules/` | `detention.py` (etterprøvbar beregning), `invoice_checks.py` (rate/drivstoff/tilleggsgebyr/duplikat/sum), `engine.py` (totaler per perspektiv) |
| `evidence/` | `letter.py` deterministisk utkast til brev; `packet.py` setter sammen pakke og markdown |
| `pipeline.py` | `run_pipeline(files, perspective)` - det eneste orkestreringsinngangspunktet |
| `api/main.py` | `create_app()`-fabrikk + `app`; autentiserte ruter, tenant-avgrenset persistens, portstyrte docs; `cli.py` for lokal bruk (ingen auth/DB) |

## Viktige beslutninger
- **Leverandørgrensesnitt, deterministisk standard.** Pipelinen avhenger kun av `ExtractionProvider`. Stubben gjør tester reproduserbare og offline; en leverandør med hostet modell kan legges til uten å røre regler eller bevis. Modellutdata må valideres av pydantic og aldri stoles på for aritmetikk: **all pengematematikk ligger i `rules/`, i Decimal.**
- **Regler gir forklarbare funn.** Hvert funn bærer regel-id, beløp, konfidens og en steg-for-steg-beregning; usikre setter `needs_human_review`. Duplikater fjernes før ratesammenligning for å unngå dobbelttelling.
- **To perspektiver, én motor.** Funn er retningsbestemte (`overcharge` mot `underbilled`); det valgte perspektivet summerer sin retning og rapporterer resten som ignorert.
- **Menneske i løkken.** Utdata er en utkastpakke; ingenting sendes. Hver pakke har en ansvarsfraskrivelse.
- **Tenant-isolasjon ved konstruksjon.** Tenanten kommer kun fra API-nøkkelen. `AnalysisRepository` er bundet til én tenant ved opprettelse og hver spørring filtrerer på den; en annen tenants id gir 404; lagringsnøkler bærer tenant-prefikset og sjekkes på nytt ved lesing. PostgreSQL radnivåsikkerhet (row-level security) er neste lag i dybdeforsvaret.
- **Persistens bak et repository.** SQLAlchemy 2 + Alembic; SQLite lokalt/i tester, PostgreSQL (RDS) i produksjon. En `analyses`-rad er både jobbposten (queued/running/succeeded/failed) og resultatet, slik at en asynkron arbeider kan overta den uten skjemaendring. Penger lagres som heltallsører/cent pluss eksakt pakke-JSON.
- **Avgrenset parsing.** Fiendtlig input parses i en separat, ressursbegrenset arbeiderprosess, aldri i API-prosessen. Dette er prosessisolasjon, ikke en OS-sandbox; seccomp/skrivebeskyttet rotfilsystem/ingen utgående trafikk (egress) er en kontroll på utrullingslaget (`deploy/aws.md`).
- **Ingen kø ennå.** Analyser kjører synkront innenfor forespørselen (avgrenset av arbeiderpoolen og 503-mottrykk); en asynkron jobbkø er et neste steg for store dokumenter.
- **Bevisintegritet.** sha256 av originalbytes registreres per dokument.

## Prognoser (veikart)
`forecast/` er en valgfri, fremtidig funksjon (ikke i kjerneflyten): et `Forecaster`-grensesnitt, en stdlib sesongnaiv/glidende-gjennomsnitt-baseline (standard, testet) og en lat importert `neuralforecast`-backend bak `[forecast]`-tillegget, av som standard og ikke validert (trenger reelle data med flere tidsserier; ofte bare likt med baselines). Ingen påstander om treffsikkerhet.

## Kjente mangler
OCR for skannede PDF-er; laster med flere dokumenter/stopp; tidssonebevisste tidsstempler; kontrakts-/tariffspesifikke regler; transportørspesifikke gebyrkoder; tvistefrister og statussporing; integrasjoner (TMS/EDI/transportørportaler); betalinger/kreditt-avstemming; ratebegrensning, malware-skanning, oppbevaringspolicy, en asynkron jobbkø; og den eksterne sikkerhetsrevisjonen / samsvarsgodkjenningen. Prosjektets forskningsplan (eval-sett først, uavhengig verifikator, målt pass^k) ligger i `technical/` og er ennå ikke implementert her.

---

# Nettplattform (TypeScript, steg 1-2)

> Skrevet av scriber for kjøringen `REQ-20261008-webapp-foundation` 2026-10-08. **Før produkt, kun
> syntetiske data, aldri utrullet.** Python-tjenesten ovenfor og pilotdashbordet `webapp/` er uendret og
> kjører fortsatt for seg selv. Trusselmodell og kjente mangler (engelsk):
> [technical/web-platform-security.md](technical/web-platform-security.md). Mermaid-diagrammene er de
> samme som i den engelske originalen ([ARCHITECTURE.md](ARCHITECTURE.md#web-platform-typescript-steps-1-2)),
> slik at de holdes i takt med den.

## Oversikt

Et npm-workspaces-monorepo ved siden av Python-tjenesten. `web/` er en React 19 + Vite SPA (React
Router, TanStack Query, Zustand, Tailwind). `api/` er Node 22 + Fastify 5 + Prisma 7 på PostgreSQL 16, med
Zod-validering og Pino-logger. `packages/shared/` (`@fr/shared`) inneholder rollene, tillatelsesmatrisen,
kanonisk JSON, tekstsikkerhet og DTO-skjemaene; begge sider importerer den. `infra/` er et
Terraform-skjelett for AWS. Byggesteg 1 og 2 er implementert: autentisering (argon2id, tilgangs-JWT pluss
en roterende refresh-informasjonskapsel, TOTP-MFA, utestenging), RBAC for 8 roller, tenant-isolasjon i
tre lag, applikasjonsherding, et hashkjedet revisjonsspor som bare kan utvides, kravlisten, visningen av
bevispakken og godkjenningsporten med menneske i løkken. Steg 3 (import og eksport) er beskrevet i
et eget avsnitt nedenfor: [Nettplattform: import og eksport (steg 3)](#nettplattform-import-og-eksport-steg-3).
Utviklerdashbordet, AI-funksjoner og TS-porten av Python-reglene er senere steg. Krav og pakker seedes fra Python-CLI-ens
utdata på `tests/fixtures/` (syntetisk).

## Modulstruktur

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    subgraph Web["web/ (SPA)"]
        W1["app-root + router"]
        W2["features/auth"]
        W3["features/claims"]
        W4["features/approvals"]
        W5["api/client.ts"]
    end

    subgraph Shared["packages/shared (@fr/shared)"]
        S1["rbac.ts"]
        S2["dto.ts (Zod)"]
        S3["canonical-json + text"]
    end

    subgraph Http["api/src/http"]
        H1["security.ts pipeline"]
        H2["route.ts defineRoute"]
    end

    subgraph Domain["api/src domain"]
        D1["auth/ + users"]
        D2["claims/"]
        D3["platform/"]
        D4["audit/"]
    end

    subgraph Data["api/src/db + Postgres"]
        B1["db/tenant.ts"]
        B2["db/system.ts"]
        B3["RLS + triggers (SQL)"]
    end

    W1 --> W2
    W1 --> W3
    W1 --> W4
    W2 --> W5
    W3 --> W5
    W4 --> W5
    W5 --> H1
    W1 --> S1
    W5 --> S2
    H1 --> H2
    H2 --> D1
    H2 --> D2
    H2 --> D3
    D1 --> D4
    D2 --> D4
    D3 --> D4
    D1 --> B2
    D2 --> B1
    D3 --> B1
    D4 --> B1
    B1 --> B3
    B2 --> B3
    H1 --> S1
    D2 --> S3
    D4 --> S3

    style W1 fill:#1e90ff,stroke:#1565c0,color:#fff
    style W5 fill:#1e90ff,stroke:#1565c0,color:#fff
    style S1 fill:#1e90ff,stroke:#1565c0,color:#fff
    style H1 fill:#1e90ff,stroke:#1565c0,color:#fff
    style B1 fill:#1e90ff,stroke:#1565c0,color:#fff
    style B3 fill:#1e90ff,stroke:#1565c0,color:#fff
    style D4 fill:#1e90ff,stroke:#1565c0,color:#fff
```

> Alt i dette diagrammet er nytt i denne kjøringen. Blått markerer de sikkerhetskritiske modulene.

### Modulreferanse

| Modul / fil | Lag | Formål | Viktige eksporter | Endret |
| --- | --- | --- | --- | --- |
| `packages/shared/src/rbac.ts` | Delt | **Eneste sannhetskilde** for roller og den frosne tillatelsesmatrisen | `ROLES`, `PERMISSION_MATRIX`, `can`, `canAssignRole`, `canManageUserWithRole`, `MFA_REQUIRED_ROLES` | ny |
| `packages/shared/src/dto.ts` | Delt | Strenge forespørselsskjemaer og respons-DTO-er (også `CLAIM_SORT_FIELDS`) | Zod-skjemaer | ny |
| `packages/shared/src/canonical-json.ts`, `text.ts`, `money.ts` | Delt | Kanonisk JSON for hashing; `displayText` og kontroll av usikre tegn; formatering av heltallscent | `canonicalJson`, `GENESIS_HASH`, `displayText`, `formatUsdCents` | ny |
| `api/src/app.ts`, `server.ts`, `config.ts` | API | App-fabrikk; feilsikker konfigurasjon (produksjonsvern, kontroll av hemmeligheter) | `buildApp`, `loadConfig`, `secretEntropyProblem` | ny |
| `api/src/http/security.ts` | API | Én `onRequest`-pipeline: ratebegrensning → Origin → CSRF → autentisering → tillatelse; sikkerhetshoder | `registerSecurityPipeline` | ny |
| `api/src/http/route.ts` | API | `defineRoute`; oppstarten feiler hvis en rute mangler tilgangsdeklarasjon; Zod-validering i `preHandler` | `defineRoute` | ny |
| `api/src/security/*` | API | argon2id, HS256-JWT (nøkkel/typ/aud per formål), TOTP, CSRF, HKDF/AES-GCM, utestengingsmatematikk | | ny |
| `api/src/auth/*` | API | Innlogging, MFA, refresh-rotasjon + gjenbruksdeteksjon, glemt passord/tilbakestilling, invitasjoner, brukere (R3-R23), dev-utboks (R38) | `authenticateAccessToken`, `rotateRefreshToken`, ruteregistrering | ny |
| `api/src/claims/*` | API | Liste/sortering/søk (`escapeLike`), pakkevisning, innholdshash, tilstandsmaskin for gjennomgang, godkjenninger (R26-R34) | `canTransition`, `packetContentHash` | ny |
| `api/src/platform/*` | API | Helse, tenant-statistikk, SUPER_ADMIN-lesing på tvers av tenants (revisjonslogget først) | `crossTenantRead` | ny |
| `api/src/audit/*` | API | Hashkjede, tilføying under advisory lock, verifikator, liste-/verifiseringsruter | `appendAudit`, `ChainVerifier` | ny |
| `api/src/db/tenant.ts`, `system.ts` | Data | Lag 2: tenant-utvidelse som feiler lukket; systemmodus-transaksjoner (begrenset av lint) | `withTenantTx`, `withSystemTx` | ny |
| `api/prisma/migrations/20261008000000_init/migration.sql`, `api/db/init/00-roles.sql` | Data | Skjema, RLS + FORCE, minste-privilegium-tildelinger, append-only- og tilstandsmaskin-triggere, DB-roller | | ny |
| `web/src/api/client.ts` | Web | Tilgangstoken i minnet, CSRF-hode, refresh én om gangen (Web Locks på tvers av faner) | `ApiClient` | ny |
| `web/src/features/{auth,shell,claims,approvals}` | Web | Sider for innlogging/MFA/tilbakestilling/invitasjon, skall + kommandopalett, kravtabell + detaljpanel, godkjenningskø | sider | ny |
| `infra/*.tf` | Infra | AWS-skjelett (kun fmt/validate, aldri anvendt) | | ny |
| `compose.web.yml`, `.github/workflows/web-ci.yml` | Drift | Egen lokal stack og egen CI; Python-tjenestens `docker-compose.yml` og `ci.yml` er urørt | | ny |

## Forespørselspipeline (dataflyt)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    Req["HTTPS request"] --> Rate{"Rate limit ok?"}
    Rate -- no --> R429["429 + Retry-After"]
    Rate -- yes --> Unsafe{"Unsafe method?"}
    Unsafe -- yes --> Csrf{"Origin + CSRF ok?"}
    Csrf -- no --> R403a["403"]
    Csrf -- yes --> AuthN{"Route needs auth?"}
    Unsafe -- no --> AuthN
    AuthN -- yes --> Tok{"JWT valid + user live?"}
    Tok -- no --> R401["401"]
    Tok -- yes --> Ctx["Load ctx from DB"]
    Ctx --> Perm{"Permission in matrix?"}
    Perm -- no --> R403b["403 + audit"]
    Perm -- yes --> Body["Parse body + Zod"]
    AuthN -- no --> Body
    Body --> Valid{"Schema valid?"}
    Valid -- no --> R400["400 validation_error"]
    Valid -- yes --> Tx["ctx.db.tx: set app.tenant_id"]
    Tx --> Handler["Handler + appendAudit"]
    Handler --> Commit["Commit (atomic)"]
    Commit --> Hdr["onSend: security headers"]

    style Ctx fill:#1e90ff,stroke:#1565c0,color:#fff
    style Tx fill:#1e90ff,stroke:#1565c0,color:#fff
    style Perm fill:#1e90ff,stroke:#1565c0,color:#fff
```

Autentisering og autorisasjon kjøres i `onRequest`, før body parses. En uautentisert eller forbudt
forespørsel får derfor 401/403 selv om body er ugyldig. En forretningsendring og revisjonshendelsen
dens committes i samme transaksjon: feiler tilføyingen til revisjonssporet, returnerer forespørselen 500
og ingenting endres.

## Autentiseringsflyter

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    L["POST /auth/login"] --> Lock{"Email hash locked?"}
    Lock -- yes --> L429["429 Retry-After"]
    Lock -- no --> Pw{"argon2id verify ok?"}
    Pw -- no --> Fail["Count failure + audit"]
    Pw -- yes --> Mfa{"Role needs MFA?"}
    Mfa -- no --> Sess["Issue session"]
    Mfa -- yes --> Enr{"TOTP enrolled?"}
    Enr -- no --> EnrollFlow["mfa/enroll start+verify"]
    Enr -- yes --> Verify["mfa/verify TOTP or code"]
    EnrollFlow --> Sess
    Verify --> Sess
    Sess --> Out["Access JWT body + fr_rt cookie"]
    Out --> Ref["POST /auth/refresh"]
    Ref --> Used{"Token already used?"}
    Used -- yes --> Kill["Revoke family + audit"]
    Used -- no --> Rot["Rotate: new token same family"]

    style Used fill:#1e90ff,stroke:#1565c0,color:#fff
    style Mfa fill:#1e90ff,stroke:#1565c0,color:#fff
```

| Flyt | Ruter (under `/api/v1`) | Viktige regler |
| --- | --- | --- |
| Innlogging | `POST /auth/login` | argon2id med en dummy-verifisering for ukjente eller deaktiverte brukere; utestenging per e-posthash `min(30·2^(f-5), 900)` s etter 5 feil; ratebegrensning for auth 20/60 s per IP |
| MFA | `/auth/mfa/verify`, `/auth/mfa/enroll/start`, `/auth/mfa/enroll/verify` | påkrevd for OWNER, ADMIN, PLATFORM_DEV, SUPER_ADMIN; RFC 6238 ±1 steg; godtatt steg må øke strengt (ingen gjenbruk); gjenopprettingskoder kan brukes én gang |
| Sesjon | `/auth/refresh`, `/auth/logout`, `GET /me` | tilgangs-JWT (10 min) holdes i JS-minnet; informasjonskapselen `fr_rt` er `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`; DB lagrer en HMAC av tokenet; gjenbruk tilbakekaller hele familien; en familie lever maks 30 dager |
| CSRF | `GET /auth/csrf` | informasjonskapselen `fr_csrf` == `X-CSRF-Token` == `nonce.HMAC(secret, nonce)`, pluss en Origin-kontroll |
| Gjenoppretting | `/auth/forgot`, `/auth/reset`, `/auth/change-password` | samme svar for ukjente e-poster; tilbakestilling tilbakekaller alle sesjoner; glemt passord er begrenset til 5/15 min |
| Invitasjoner | `/users/invites`, `/auth/invites/inspect`, `/auth/invites/accept` | rolletildeling er rangbasert (`canAssignRole`); OWNER kan aldri tildeles |

## RBAC

`packages/shared/src/rbac.ts` er eneste sannhetskilde. API-et kontrollerer `can(role, permission)` på
hver forespørsel. Nettappen importerer de samme frosne dataene bare for å skjule kontroller.

| Tillatelse | OWNER | ADMIN | MANAGER | REVIEWER | ANALYST | VIEWER | PLATFORM_DEV | SUPER_ADMIN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `claims:read` | x | x | x | x | x | x | | |
| `claims:assign` | x | x | x | | | | | |
| `packets:edit`, `packets:approve` | x | x | x | x | | | | |
| `demands:send` | x | x | x | | | | | |
| `import:run` (steg 3: batcher, opplasting, dokumenter, nedlasting, opprett krav) | x | x | x | x | x | | | |
| `import:review` (steg 3: gjennomgangskø og beslutninger) | x | x | x | x | | | | |
| `export:claims` (steg 3) | x | x | x | x | x | | | |
| `export:packets`, `export:outcomes` (steg 3) | x | x | x | x | | | | |
| `users:read`, `users:manage`, `audit:read`, `settings:manage`, `integrations:manage` | x | x | | | | | | |
| `admins:manage`, `billing:manage`, `tenant:delete` | x | | | | | | | |
| `platform:health` | | | | | | | x | x |
| `platform:flags`, `platform:logs` | | | | | | | x | |
| `platform:tenants:list`, `platform:cross_tenant_read` | | | | | | | | x |

Plattformroller har ingen tenant og ingen tillatelse til tenant-data. En SUPER_ADMIN-lesing på tvers av
tenants er skrivebeskyttet, krever en begrunnelse på minst 10 tegn og logges først i revisjonssporet til
måltenanten. Det finnes ingen Team-modell, så alle tenant-roller ser alle krav i sin tenant (antakelse
A4).

## Tenant-isolasjon (tre lag, feiler lukket)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    C["request.ctx (Layer 3)"] --> T{"tenantId from DB membership?"}
    T -- no --> F403["403 before handler"]
    T -- yes --> X["Prisma extension (Layer 2)"]
    X --> M{"Model allow-listed?"}
    M -- no --> Err["TenantScopeError"]
    M -- yes --> Inj["Force tenantId in where/data"]
    Inj --> SetCfg["set_config app.tenant_id (tx-local)"]
    SetCfg --> R["RLS + FORCE (Layer 1)"]
    R --> Role{"Role is freight_app?"}
    Role -- yes --> Rows["Only own-tenant rows"]

    style X fill:#1e90ff,stroke:#1565c0,color:#fff
    style R fill:#1e90ff,stroke:#1565c0,color:#fff
```

- **Lag 1, PostgreSQL RLS.** Hver tenant-avgrenset tabell (`claims`, `evidence_packets`,
  pakkens undertabeller, `approvals`, `memberships`, `invites`, `audit_events`) har `ENABLE` og
  `FORCE ROW LEVEL SECURITY` med `USING/WITH CHECK (tenant_id = fr_current_tenant())`. Uten
  `app.tenant_id` satt ser spørringer null rader. Bare `memberships` og `invites` tillater i tillegg
  `fr_system_mode()` (oppstart av autentisering), og `platform`-revisjonskjeden er bare synlig i
  systemmodus.
- **Roller.** API-et kjører som `freight_app` (`NOSUPERUSER NOBYPASSRLS NOINHERIT`, ikke eier; bare
  DML-tildelinger; `evidence_packets` får bare `UPDATE (status)`; tabeller som bare kan utvides får bare
  `SELECT, INSERT`). `freight_owner` eier skjemaet og kjører migrasjoner, seed og testoppsett
  (BYPASSRLS).
- **Lag 2, Prisma-utvidelse som feiler lukket** (`api/src/db/tenant.ts`). Modellene er hvitelistet;
  `tenantId` legges inn i hver where-betingelse og hver create, og en motstridende verdi kaster en feil.
  Rå SQL er blokkert på tenant-klienten.
- **Lag 3, forespørselskontekst.** Bruker, rolle, tenant-status og om refresh-familien lever lastes på
  nytt fra DB ved hver forespørsel, aldri fra token-claims. Plattformbrukere får `db = null`.

## Revisjonsspor med hashkjede

- Én kjede per tenant (`chain_key = t:<tenantId>`) pluss en `platform`-kjede.
  `hash_n = SHA-256(hash_{n-1} + "\n" + canonicalJson(event_n))`; genesis er 64 nuller; `seq` er
  sammenhengende under `pg_advisory_xact_lock(hashtextextended(chain_key, 0))`.
- Triggere blokkerer UPDATE, DELETE og TRUNCATE på `audit_events` (og på `approvals`,
  `login_attempts` og pakkens undertabeller), også for eieren. Bare `db:seed -- --reset` i dev/test
  omgår dem via `session_replication_role`.
- `GET /api/v1/audit/verify` (`audit:read`) regner ut kjeden på nytt og rapporterer `brokenAtSeq`.
  Metadata går gjennom en hviteliste; mislykkede innlogginger registreres med `actor = null`.

## Tilstandsmaskin for godkjenning

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    P["PENDING_REVIEW"] -- "approve (reason)" --> A["APPROVED"]
    P -- "reject (reason)" --> J["REJECTED"]
    A -- "send (reason, hash match)" --> S["SEND_READY (terminal)"]
    P -- "edit" --> N["new revision PENDING_REVIEW"]
    A -- "edit" --> N
    J -- "edit" --> N
    N -. "old revision" .-> X["SUPERSEDED"]

    style S fill:#1e90ff,stroke:#1565c0,color:#fff
```

Hver handling krever en begrunnelse og skriver en `approvals`-rad (som bare kan utvides) pluss en
revisjonshendelse i én transaksjon, med kravraden låst `FOR UPDATE`. Godkjenning lagrer pakkens kanoniske
innholdshash. Sending regner den ut på nytt og krever at den er lik både godkjenningens hash og den lagrede
hashen. «Send» merker bare kravet som klart til sending: ingen e-post, ingen betaling. DB-triggeren
`fr_packet_update_guard` håndhever de samme overgangene og gjør alle kolonner unntatt `status`
uforanderlige. Redigering lager en ny revisjon; godkjenningsraden registrerer grunnrevisjonen (avvik 18).

| Funksjon | Definert i | Kalles av | Formål |
| --- | --- | --- | --- |
| `canTransition`, `targetStatus` | `api/src/claims/state-machine.ts` | kravtjenesten | overgangstabell (speiler SQL-triggeren) |
| `packetContentHash` | `api/src/claims/content-hash.ts` | godkjenn, rediger, send, integritet i visningen | kanonisk hash med ordenstall i stedet for UUID-er |
| `lockClaimForUpdate` | `api/src/db/tenant.ts` | kravtjenesten | serialiserer samtidige beslutninger |
| `appendAudit` | `api/src/audit/audit.ts` | hver endrende handler, lesing på tvers av tenants | tilføying til kjeden i kallerens transaksjon |
| `crossTenantRead` | `api/src/platform/cross-tenant.ts` | plattformruter | revisjonslogg først, så lesing, feiler lukket |

## AWS-kartlegging (nettstack)

`infra/` erstatter `deploy/terraform/` **kun for nettstacken**. Den følger prinsippene i
[deploy/aws.md](deploy/aws.md) ([norsk](deploy/aws.no.md)): hemmeligheter kommer fra Secrets Manager via
task-definisjonen og er aldri i state, migrasjoner kjøres som en engangs ECS-oppgave før utrullingen, WAF
står foran, og ingenting anvendes automatisk.

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    U["Browser"] --> CF["CloudFront + headers policy"]
    CF --> S3W["S3 static SPA (OAC)"]
    CF --> ALB["ALB + WAFv2 (regional)"]
    ALB --> ECS["ECS Fargate api"]
    ECS --> RDS["RDS PostgreSQL 16"]
    ECS --> RED["ElastiCache Redis 7"]
    ECS --> S3D["S3 documents (SSE-KMS)"]
    ECS --> SM["Secrets Manager"]
    ECS --> CW["CloudWatch Logs"]
    MIG["ECS one-off migrate"] --> RDS

    style ALB fill:#1e90ff,stroke:#1565c0,color:#fff
    style ECS fill:#1e90ff,stroke:#1565c0,color:#fff
```

| Komponent | Lokalt (`compose.web.yml`) | AWS (`infra/`) |
| --- | --- | --- |
| SPA | nginx-unprivileged, hoder fra `web/security-headers.json` | S3 + CloudFront (OAC), respons-hode-policy generert fra den samme JSON-filen |
| API | `api`-container (uid 10001, skrivebeskyttet rotfilsystem, capabilities fjernet) | ECS Fargate, samme herding, private subnett, VPC-endepunkter (ingen NAT) |
| Kant | kun loopback | ALB nåbar bare fra CloudFronts origin-områder, TLS 1.2/1.3-policy, WAFv2 (administrerte regler, IP-ratebegrensning, Content-Length > 64 KiB; steg 3: opplastingsruten har en egen regel > 10 MiB) |
| DB | `postgres:16.15-alpine` + `00-roles.sql` | RDS PostgreSQL 16, KMS, `rds.force_ssl=1`, administrert masterpassord; roller legges inn av en operatør |
| Lager for ratebegrensning | `redis:7-alpine` | ElastiCache Redis 7, TLS + kryptering i hvile, AUTH-token satt utenom Terraform |
| Dokumenter | MinIO (`chainguard/minio`) med innebygd KMS (`fr-dev-key`) og versjonering | S3 SSE-KMS (bucket-policyen avviser opplasting uten CMK-en), versjonering, livssyklusregler; task-rollen begrenset til prefikset `t/*`, `s3:DeleteObject` bare på `t/*/imports/*` |
| Hemmeligheter | offentlige `local-dev-*`-verdier (avvist i produksjon) | 7 Secrets Manager-beholdere; verdiene settes utenom Terraform |

## Arkitekturmønstre

- **Sikkerhetspipeline som én hook**: en eksakt, testbar rekkefølge (rate → Origin → CSRF → autentisering → autorisasjon → validering).
- **Feil lukket overalt**: ukjente ruter hindrer oppstart; uten tenant gir null rader; en feil i revisjonssporet ruller tilbake forretningsendringen; produksjonskonfigurasjonen avviser dev-verdier.
- **Delt kontraktspakke**: roller, matrise og DTO-er er definert én gang i `@fr/shared` og brukes av både API og web.
- **Dybdeforsvar i databasen**: RLS, tildelinger og triggere håndhever invariantene selv om applikasjonskoden er feil.
- **Innholdsadresserte godkjenninger**: beslutninger bindes til en kanonisk hash, ikke til en rad som kan endres.

## Merknader

- Avvik fra briefen: Node 22 i stedet for 20 (Node 20 er EOL); en Prisma-klientutvidelse i stedet for den fjernede `$use`-mellomvaren; eslint 9; framer-motion utelatt. Hele listen (22 punkter) står i kjøringens `implementation.md`.
- Ikke verifisert: Docker-imagene og compose-stacken, Playwright-ende-til-ende-tester, enhver AWS-utrulling. Se «Known gaps» i trusselmodellen.

---

# Nettplattform: import og eksport (steg 3)

> Skrevet av scriber for kjøringen `REQ-20261008-step3-import-export` 2026-10-09 (grenen
> `feat/import-export`). **Før produkt, kun syntetiske data, aldri utrullet.** Trusselradene for dette
> steget er T18-T31 i [technical/web-platform-security.md](technical/web-platform-security.md) (engelsk).
> E-postvideresending er kun et design: [docs/design/email-ingest.md](docs/design/email-ingest.md)
> (engelsk). Mermaid-diagrammene er de samme som i den engelske originalen
> ([ARCHITECTURE.md](ARCHITECTURE.md#web-platform-import-and-export-step-3)).

## Oversikt (steg 3)

Steg 3 legger til **import** og **eksport** av dokumenter. Import dekker opplasting, typegjenkjenning,
kryptert lagring, parsing i sandkasse, deterministisk uttrekk med kildehenvisninger, menneskelig
gjennomgang og opprettelse av krav. Eksport strømmer krav, bevispakker og godkjenningsutfall som CSV
eller XLSX, med nøytralisering av formler. Steg 3 legger ikke til OCR, AI- eller LLM-kall, utgående
e-post eller mottak av videresendt e-post. Parsing og uttrekk er en TypeScript-port av Python-modulene
`ingest/` og `extraction/`. Paritetstester sjekker den mot Python-koden. Python er bare et testorakel og
kjører aldri i produksjon.

Hovedbeslutninger:

- Pipelinen er **synkron** inne i opplastingsforespørselen og begrenset av tidsgrenser. Statusmodellen
  åpner allerede for en kø senere.
- API-et **videreformidler** originalene. Det finnes ingen signerte URL-er.
- PDF-er leses bare fra tekstlaget. Bilder lagres og flagges for manuell registrering.
- Krav som opprettes fra import, starter i den nye statusen `AWAITING_ANALYSIS`, uten beløp og uten
  bevispakke. Steg 5 legger til analysen.

## Modulstruktur (steg 3)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    subgraph Web["web/ (SPA)"]
        WI["features/imports pages"]
        WE["ui/ExportMenu"]
        WC["api/client upload+download"]
    end

    subgraph Shared["packages/shared"]
        SR["rbac.ts (+4 permissions)"]
        SD["import-dto + decimal"]
        SS["text-sanitize (plain/md)"]
    end

    subgraph Imp["api/src/imports"]
        IR["routes.ts R40-R53"]
        IS["service.ts ingestDocument"]
        IN["sniff + display-name"]
        RV["review + commit services"]
        BU["bundle.ts (step 5 input)"]
    end

    subgraph Sbx["api/src/imports/sandbox"]
        EX["executor.ts"]
        SP["spawn.ts (only spawner)"]
        WM["worker-main + guard"]
    end

    subgraph Parse["api/src/imports/parse (pure)"]
        PP["pipeline.ts"]
        PD["pdf + pdf-prescan"]
        PX["csv, text, image"]
        DE["deterministic + confidence"]
    end

    subgraph Exp["api/src/exports"]
        ER["routes.ts R54-R56"]
        EW["rows + writers"]
        NZ["neutralize.ts"]
    end

    subgraph Data["storage + db"]
        S3["storage/s3.ts SSE-KMS"]
        DB["5 tables, RLS FORCE"]
    end

    WI --> WC
    WE --> WC
    WC --> IR
    WC --> ER
    IR --> IS
    IR --> RV
    IS --> IN
    IS --> EX
    IS --> S3
    IS --> DB
    RV --> DB
    RV --> BU
    EX --> SP
    SP --> WM
    WM --> PP
    PP --> PD
    PP --> PX
    PP --> DE
    DE --> SD
    PX --> SS
    ER --> EW
    EW --> NZ
    EW --> DB
    IR --> SR
    ER --> SR

    style IS fill:#1e90ff,stroke:#1565c0,color:#fff
    style IN fill:#1e90ff,stroke:#1565c0,color:#fff
    style EX fill:#1e90ff,stroke:#1565c0,color:#fff
    style SP fill:#1e90ff,stroke:#1565c0,color:#fff
    style WM fill:#1e90ff,stroke:#1565c0,color:#fff
    style PD fill:#1e90ff,stroke:#1565c0,color:#fff
    style NZ fill:#1e90ff,stroke:#1565c0,color:#fff
    style S3 fill:#1e90ff,stroke:#1565c0,color:#fff
```

> Alt i dette diagrammet er nytt eller endret i steg 3. Blått markerer modulene som håndterer fiendtlige
> bytes eller fiendtlig celleinnhold. Modulreferansen (filer, eksporter, endringer) står i den engelske
> originalen.

## Importpipeline (dataflyt)

Én opplasting er én forespørsel `POST /api/v1/imports/:batchId/documents?filename=` med filens rå bytes.
Pipelinen kjører synkront, og svaret inneholder dokumentets endelige tilstand.

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    Up["R43 raw bytes + ?filename="] --> Sec["Security pipeline (step 1-2)"]
    Sec --> Pre{"Batch open, gate free, name ok?"}
    Pre -- no --> E4["400 / 404 / 409 / 429"]
    Pre -- yes --> Rd["Stream body: cap, idle timeout, SHA-256"]
    Rd --> Big{"Over IMPORT_MAX_FILE_BYTES?"}
    Big -- yes --> E413["413, nothing stored"]
    Big -- no --> Sn{"Magic + extension ok?"}
    Sn -- no --> E415["415 reason, audited, nothing stored"]
    Sn -- yes --> Tx1["Tx 1: dedupe, quota, RECEIVED + audit"]
    Tx1 --> Put["S3 put SSE-KMS + verify"]
    Put --> Slot{"Parse slot in time?"}
    Slot -- no --> E503["503 parser_busy, FAILED"]
    Slot -- yes --> Wk["Sandbox worker parse"]
    Wk --> Ok{"Parsed, response valid?"}
    Ok -- no --> Rej["Tx 2: REJECTED, objects deleted"]
    Ok -- yes --> Txt["Store derived text (SSE-KMS)"]
    Txt --> Tx2["Tx 2: fields + status + audit"]
    Tx2 --> St{"Any review reason?"}
    St -- yes --> NR["NEEDS_REVIEW (review queue)"]
    St -- no --> AC["ACCEPTED"]

    style Rd fill:#1e90ff,stroke:#1565c0,color:#fff
    style Sn fill:#1e90ff,stroke:#1565c0,color:#fff
    style Put fill:#1e90ff,stroke:#1565c0,color:#fff
    style Wk fill:#1e90ff,stroke:#1565c0,color:#fff
```

1. **Opplasting.** Klienten sender rå bytes (`Content-Type: application/octet-stream`, ingen multipart).
   Filnavnet er en spørreparameter og renses til et visningsnavn. Klientens medietype brukes aldri.
   Ratebegrensning, Origin, CSRF, autentisering og tillatelse kjøres før innholdet leses.
2. **Typegjenkjenning.** API-et godtar `%PDF-` på posisjon 0, PNG-signaturen eller `FF D8 FF`. Alt annet
   behandles som tekst. Tekst kan ikke inneholde NUL, C0-kontrolltegn eller DEL utenom HT, LF, CR og FF,
   og kan ikke starte som HTML, SVG, XML eller PHP. Kjente signaturer som ikke er tillatt (zip, gzip, PE,
   ELF, GIF, RIFF, OLE, PostScript, rar, 7z) avvises. Den siste filendelsen må være en av
   `.pdf .png .jpg .jpeg .csv .txt` og stemme med den gjenkjente typen.
3. **Lagring.** Transaksjon 1 setter inn raden `RECEIVED` og revisjonshendelsen før all treg I/O.
   Originalen lagres under `t/<tenantId>/imports/<batchId>/<docId>/original` med SSE-KMS og
   SHA-256-kontrollsum. I produksjon verifiserer en `HEAD`-forespørsel krypteringen. Nøkler inneholder
   aldri klientens filnavn.
4. **Isolert parsearbeider.** `ChildProcessExecutor` tar en plass fra en semafor per instans. Den
   starter `node` med `--permission`, som bare gir lesetilgang til arbeiderens filer. Arbeideren får
   ingen skrive-, barneprosess-, worker-, addon- eller WASI-tillatelse. Den får også
   `--max-old-space-size`, et **tomt miljø** og en tom arbeidsmappe. En vaktmodul sletter `fetch`,
   `WebSocket`, `EventSource` og `XMLHttpRequest`, og blokkerer nettverks-, prosess- og VM-modulene.
   Forelderprosessen håndhever veggklokke, utdatagrense og (på Linux) en RSS-grense. Den behandler
   arbeideren som upålitelig: hele svaret valideres på nytt, og et ugyldig svar blir `parse_failed`.
5. **PDF-forhåndsskanning.** `pdf-prescan.ts` går gjennom PDF-strukturen med faste grenser før pdf.js
   ser filen. Den avviser som `malformed_pdf`: mer enn 3 kjedede filtre, et indirekte `/Filter`,
   dekompresjonsbomber (32 MiB per strøm, 64 MiB totalt), `/Prev`-løkker, mer enn 64 xref-seksjoner,
   sidetrær større enn sideantallet pluss 16, og null sider. Den teller også tekst i innholdsstrømmene,
   også tekst utenfor siden, slik at grensen `PARSE_MAX_TEXT_CHARS` holder (`text_too_large`). Deretter
   leser pdf.js bare tekstlaget, uten merknader, vedlegg, JavaScript eller XFA.
6. **Uttrekk med kildehenvisning.** Den deterministiske leverandøren (`deterministic`, versjon 1) leser
   `Nøkkel: verdi`-linjer og gir bare tillatte felt. Hvert felt har en kildepeker (side, linje,
   UTF-16-start og -slutt, CSV-rad, renset utdrag) og en regelbasert konfidens. Et felt flagges når
   konfidensen er under `REVIEW_CONFIDENCE_THRESHOLD` (0,90), når verdien ikke kan tolkes, eller når
   duplikater er i konflikt. PDF-felt starter på 0,85, så alle PDF-felt flagges som standard.
7. **Gjennomgang.** Et dokument med en gjennomgangsgrunn får `NEEDS_REVIEW` og havner i
   gjennomgangskøen (`GET /reviews`). En gjennomgåer bekrefter, korrigerer eller avviser hvert flagget
   felt. For bilder kan gjennomgåeren også sette dokumenttypen og legge inn felt manuelt. Deretter godtar
   eller avviser gjennomgåeren dokumentet. Hver handling krever en begrunnelse og gir en rad i tabellen
   `import_review_decisions`, som bare kan utvides, pluss en revisjonshendelse. Godtatte dokumenter kan
   ikke endres.
8. **Opprett krav.** `POST /imports/:batchId/commit` grupperer batchens godtatte dokumenter etter
   normalisert lastnummer (NFKC, sammenslått mellomrom, store bokstaver). Den oppretter et
   `AWAITING_ANALYSIS`-krav eller kobler til et eksisterende. Har kravet allerede en bevispakke, kobles
   dokumentene bare til (`new_evidence_not_in_packet`), og pakken og feltene endres aldri. Operasjonen er
   atomisk og idempotent.

### Funksjonskall (opplasting)

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    R43["R43 handler"] --> ING["ingestDocument"]
    ING --> ABA["assertBatchAcceptsUploads"]
    ING --> BODY["read body (body.ts)"]
    ING --> SNF["sniff"]
    ING --> PUT["ObjectStore.putObject"]
    ING --> RUN["ChildProcessExecutor.run"]
    RUN --> SEM["semaphore acquire"]
    RUN --> STW["startWorker (spawn.ts)"]
    STW --> WMN["worker-main"]
    WMN --> PDOC["parseDocument"]
    PDOC --> PSC["prescanPdf"]
    PDOC --> PDF["pdf.js text layer"]
    PDOC --> CSV["csv / text / image"]
    PDOC --> EXT["deterministic extract"]
    RUN --> VAL["validateWorkerResponse"]
    ING --> TX2["Tx 2 + appendAudit"]

    style ING fill:#1e90ff,stroke:#1565c0,color:#fff
    style RUN fill:#1e90ff,stroke:#1565c0,color:#fff
    style PSC fill:#1e90ff,stroke:#1565c0,color:#fff
    style VAL fill:#1e90ff,stroke:#1565c0,color:#fff
```

## Dokumenttilstander

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    RC["RECEIVED (transient)"] --> AC["ACCEPTED (terminal)"]
    RC --> NR["NEEDS_REVIEW"]
    RC --> RJ["REJECTED (terminal, no object)"]
    RC --> FL["FAILED (terminal)"]
    NR -- "R49 accept + reason" --> AC
    NR -- "R50 reject + reason" --> RJ

    style NR fill:#1e90ff,stroke:#1565c0,color:#fff
```

Et felt går én gang fra `PROPOSED` til `CONFIRMED`, `CORRECTED` eller `REJECTED`. En databasetrigger
håndhever overgangene og holder uttrukket verdi, råverdi, konfidens og pekere uforanderlige.

## Datamodell og lagring

Fem nye tenant-tabeller: `import_batches`, `import_documents`, `extracted_fields`,
`import_review_decisions` (kun tillegg) og `claim_documents` (kun innsetting). Alle har `ENABLE` og
`FORCE ROW LEVEL SECURITY`, kolonnevise tildelinger for `freight_app`, og står i `TENANT_MODELS`. En
CHECK krever at `storage_key` starter med `t/<egen tenant_id>/`. Objektlagringen er privat. Hvert kall i
`ObjectStore` kontrollerer tenant-prefikset på nytt, og API-et returnerer aldri en lagrings-URL.
Nedlasting av originalen strømmes gjennom API-et med et syntetisk filnavn, og SHA-256 av de strømmede
bytene kontrolleres.

## Eksportstrømming

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TD
    Rq["R54/R55/R56 + format"] --> Gt{"Permission, rate, gate ok?"}
    Gt -- no --> X4["403 / 429"]
    Gt -- yes --> Cn["Count rows (R26 filters)"]
    Cn --> Mx{"Over EXPORT_MAX_ROWS?"}
    Mx -- yes --> X422["422 export_too_large"]
    Mx -- no --> St["Commit export.started audit"]
    St --> Bt["Keyset batch of 500 (short tx)"]
    Bt --> Nz["cleanText + neutralizeFormula"]
    Nz --> Wr["CSV or XLSX writer"]
    Wr --> More{"More rows?"}
    More -- yes --> Bt
    More -- no --> Dn["export.completed: rows, bytes, SHA-256"]
    Wr -. "client abort" .-> Ab["export.aborted: rowsWritten"]

    style Nz fill:#1e90ff,stroke:#1565c0,color:#fff
    style St fill:#1e90ff,stroke:#1565c0,color:#fff
```

- **Formater.** CSV er UTF-8 med BOM og CRLF, og hver tekstcelle står i anførselstegn. XLSX er ett ark,
  skrevet som en strømmet ZIP med `fflate`, med typede tekster og tall og en fet, fastfrosset
  overskriftsrad. Det finnes ingen formler, lenker, makroer, tegninger eller eksterne relasjoner.
- **Formelnøytralisering.** Tekstceller mister kontrolltegn, bidi- og nullbreddetegn (tab, CR, LF, LS og
  PS blir ett mellomrom) og kuttes ved 10 000 tegn. Er første tegn etter eventuelt mellomrom `=`, `+`,
  `-`, `@` eller en fullbreddeform (U+FF1D, U+FF0B, U+FF0D, U+FF20), får cellen en ledende `'`. Tall
  skrives som tall og nøytraliseres aldri.
- **Begrenset minne.** Hver bolk på 500 rader bruker sin egen korte transaksjon, og skriverne respekterer
  mottrykk (backpressure).

## Python-paritet: registrerte avvik (D1-D8)

TypeScript-parseren skal gi samme resultat som Python-referansen (`ingest_bytes`, `classify`,
`DeterministicStubProvider.extract`) for den støttede delmengden. `api/test/parity/extract.parity.test.ts`
kjører Python-koden via `tools/parity/extract_dump.py` og sammenligner dokumenttype, sha256, tekst og
felt. Avvikene nedenfor er de **eneste** tillatte forskjellene. Alle andre forskjeller er feil.

| ID | Avvik (TS mot Python) | Begrunnelse |
| --- | --- | --- |
| D1 | PDF-signaturen `%PDF-` må stå på posisjon 0. Python tåler opptil 1024 søppelbytes foran. | Søppel foran er et klassisk polyglott-triks. Posisjon 0 gjør typen entydig. |
| D2 | PDF-tekst kommer fra pdf.js, ikke pdfplumber. Paritet gjelder bare enkle PDF-er med tekstlag (én tekstlinje per linje, standard Helvetica eller Times, én spalte). | pdfplumber finnes bare i Python, og TS-porten skal ikke kalle Python under kjøring. To motorer ordner og spatierer tekst ulikt på komplekse oppsett. |
| D3 | Filendelsen og den gjenkjente typen må stemme overens. Tillatte endelser: `.pdf .png .jpg .jpeg .csv .txt` (uten hensyn til store og små bokstaver, bare siste endelse). Python ser bare på endelsen. | Hindrer at en PDF eller et skript forkledd som `.csv` (og omvendt) havner i feil parser. |
| D4 | Ugyldig UTF-8 dekodes med U+FFFD som i Python, men gir advarselen og gjennomgangsgrunnen `DECODE_REPLACEMENTS`. NUL, C0-kontrollbytes utenom HT, LF, CR og FF, **eller DEL (0x7F)** avviser filen som `binary_content`. Python ville fortsatt. | Binært innhold i en «tekstfil» tyder på en forkledd eller ødelagt fil. DEL-regelen kom i rettingsrunde 1 (lederavgjørelse SQ2). Python har ingen binærsperre, så DEL har ingen motpart i Python. |
| D5 | Tekst over `PARSE_MAX_TEXT_CHARS` (standard 2 000 000) avvises som `text_too_large`. Pythons grense er 5 000 000. For PDF-er teller også tekst utenfor siden (forhåndsskanning, rettingsrunde 1). | Strammere grense for minne og tid i parseren. |
| D6 | Tekstverdier renses for usikre tegn (kontrolltegn, linjeskilletegn, bidi-kontrolltegn) og kuttes ved 200 tegn, med feltgrunnen `SANITIZED_VALUE` når noe ble endret. | Verdiene vises i brukergrensesnittet og eksporteres, så de må være trygg tekst på én linje. |
| D7 | Ikke-ASCII-sifre og eksotisk Unicode-bokstavfolding godtas ikke der Pythons regulære uttrykk ville godtatt dem. Dato- og tidssifre er bare ASCII `0-9`, og `USD`-endelsen godtar bare ASCII-bokstaver. | Hindrer at sifre og bokstaver som ser like ut, endrer beløp eller datoer. |
| D8 | PNG og JPEG godtas og strukturvalideres, men gir **ingen felt** (ingen OCR). Status er `NEEDS_REVIEW` med grunnen `IMAGE_NO_TEXT_LAYER`. En gjennomgåer kan sette typen (R46) og legge inn felt (R47). | Python leser ikke bilder, og OCR er utenfor omfanget av steg 3. |

Beslektede merknader (ikke nye avvik): `parseMoney` beholder CPython-paritet, så `"1,2,3"` blir `123` og
`"$-5"` blir `-5` (avgjørelse SQ1; steg 5 kan gjøre dette strengere som et nytt registrert avvik).
Forhåndsskanningen avviser fiendtlige PDF-er utenfor D2-delmengden. Opptil 16 nullbytes etter `IEND` i
PNG tåles, som for JPEG. `strptime`-paritet følger CPython 3.12 for et ledende mellomrom foran `%H` eller
`%d`. Feltrekkefølgen følger N7-nøkkelrekkefølgen og deretter `groupIndex` (SQ4).

## Grensesnitt for steg 5 (port av regler og bevis)

1. **Inndata.** `loadBundleForClaim(tx, claimId)` gir `{bundle, sources}`. `bundle` er TS-versjonen av
   `ExtractedBundle`, bygget fra de effektive feltverdiene i kravets dokumenter. Den er inndata til den
   fremtidige `analyze(bundle, perspective, settings) -> Packet`, motparten til Pythons `run_pipeline`
   etter `extract_bundle`.
2. **Kildehenvisning.** `pointerToLocator(displayName, pointer)` gir sitatlokatorer som `invoice.txt:L5`
   eller `file.pdf:p2:L14`. `sources[]` har `documentId`, `displayName`, `sha256` og `docType`.
3. **Penger.** `packages/shared/src/decimal.ts` er grunnlaget for penge- og timeregning. Steg 5 legger
   til avrunding med paritet mot Pythons `Decimal`.
4. **Tekst.** `plain` og `md` (`packages/shared/src/text-sanitize.ts`) er allerede portert med paritet.
5. **Kravets livsløp.** Steg 5 legger til overgangen `AWAITING_ANALYSIS -> PENDING_REVIEW`, med
   pakkerevisjon 1 og en revisjonshendelse i samme transaksjon. `claim_documents` viser kildedokumentene.
6. **Paritetsmønster.** `tools/parity/` og `api/test/parity/` er mønsteret for regel-dumpen. CI setter
   allerede opp Python.
7. **Leverandører.** `ExtractionProvider` er der en LLM-leverandør kan kobles inn senere, bak rensing og
   med obligatorisk kildehenvisning. Den kan aldri senke et flagg som de deterministiske kontrollene har
   satt.

## Slik kjører du kontrollene for steg 3

```bash
npm run db:migrate:deploy && npm run db:seed -- --reset
npm run ensure-bucket        # creates the dev/test bucket (MinIO), enables versioning; refuses production
npm run build                # builds the parser worker; run it before the integration and acceptance tests
npm run test:integration     # needs Postgres, S3 (MinIO) and Python for the parity suite (PYTHON=<interpreter>)
npm run test:acceptance      # black-box suites; same services
```

README-avsnittet «Import og eksport (steg 3)» beskriver lokalt oppsett uten Docker: portabel PostgreSQL,
MinIO med KMS og Python for paritet.

## Merknader (steg 3)

- Kjøringens `implementation.md` lister avvikene fra spesifikasjonen (14 punkter pluss rettingsrunde 1).
  De to viktigste: arbeideren startes ikke med `--no-experimental-fetch` (vakten sletter
  nettverksglobalene i stedet), og WAF-regelen for Content-Length har et eget unntak for
  opplastingsruten.
- Samtidighetsgrensene (opplasting, eksport, parseplasser) gjelder per API-instans, ikke distribuert.
- Ikke verifisert: container-images, compose-stacken, Playwright-ende-til-ende-tester, enhver
  AWS-utrulling.
