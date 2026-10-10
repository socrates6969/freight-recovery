> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse, ikke juridisk/finansiell fagoversettelse. Ved avvik gjelder den engelske originalen ([README.md](README.md)). Juridisk og skattemessig innhold er utkast og må gjennomgås av advokat/rådgiver før bruk.

# scoup.ai

(kodebasens navn: freight-recovery)

(c) 2026 Marius Carlsson (socrates6969) - eier og opphavsrettshaver. Proprietær; alle rettigheter forbeholdt.

> **Status: før produkt.** Ingenting her er validert på reelle kundedata ennå. Tallene er gradert A/B/C ut fra research; det aller viktigste første steget er en pilot med en designpartner. Ikke investeringsrådgivning.

## Problemet
$15.1B/år i ventetid (detention) (ATRI, sept. 2024; grad A/B); under halvparten av detention-fakturaene blir betalt

## Vår kile (wedge)
En agent setter sammen bevispakken for detention/tilleggsgebyrer (accessorials) og kravbrevet, følger frister og sender inn tvister — for mellomstore avsendere og små transportører som de etablerte aktørene (Cass, Trax, CTSI) overser.

## Prising
Suksesshonorar (contingency): en prosentandel av innkrevde dollar.

## Sannsynlige oppkjøpere
Cass, Trax, Descartes, project44, FourKites

## Ærlig risiko
De etablerte aktørene kan gå ned i markedet; tall for feilprosent på fakturaer er leverandørgrad. Valider reelt tap på én partners avsluttede saker først.

## Kartlegging av repoet
- business/ — forretningsplan, marked- og konkurrentanalyse, GTM.
- financial/ — enhetsøkonomi, modell, ARR-til-verdsettelse-regnestykket.
- technical/ — arkitektur, den verifiserte verktøy-/agentpipelinen, eval-rammeverk (pass^k).
- fundraising/ — passende VC-/englefirmaer + deres **offisielle** kontaktkanaler + utkast til henvendelser. (Ingen personlige dossierer.)
- marketing/ — B2B SEO + innhold + kanalplan (`seo-and-growth.md`, norsk: `seo-and-growth.no.md`) og en landingssideskisse (`landing/`); kun plan, ingen live nettside ennå.
- hiring/ — rollebeskrivelser + hvordan finne en operatør/daglig leder i Norge (rekrutterere og offisielle kanaler).
- web/, api/, packages/shared/, infra/ — den nye TypeScript-nettplattformen (før produkt, kun syntetiske data); se [Nettplattform](#nettplattform-typescript-før-produkt-kun-syntetiske-data) nedenfor.
- docs/design/ — designdokumenter for funksjoner som ikke er bygget ennå (e-postvideresending: kun design).
- docs/secrets.no.md — alle hemmeligheter og all legitimasjon i nettplattformen, rotasjon, og sjekklisten for overlevering til kjøper.

## Hemmeligheter og overlevering
Alle hemmeligheter nettplattformen bruker (miljøvariabel, formål, hvordan den lages, oppstartsregler, rotasjon og konsekvenser, hvor den ligger i produksjon), de offentlige utviklings-/CI-verdiene som aldri må brukes i noe ekte, og **sjekklisten for overlevering til kjøper** (selger tilbakekaller og roterer alt, kjøper lager sine egne, hvordan man beviser at ingen hemmelighet ligger i git-historikken, hvorfor Terraform-tilstanden ikke inneholder hemmelige verdier) står i **[docs/secrets.no.md](docs/secrets.no.md)** (engelsk original: [docs/secrets.md](docs/secrets.md)). Les den før enhver utrulling og før ethvert salg eller overdragelse av koden.

## Byggeplan
Følger spillboken med 12 prompter: eval-sett først → verifisert verktøylag → utkast + uavhengig verifikator (målt pass^k) → henting/minne → ruting/kostnadskontroll → red-team → revisjonsspor + menneskelig godkjenning → målt innkrevingsrate → pilot-enpager → seed-deck som kun bygger på målte resultater.

---

# MVP-kodebase (før produkt, IKKE produksjonsklar)

Et fungerende vertikalt snitt av kjerneflyten: **ingest -> extract -> rules -> innkrevingsbeløp -> bevispakke + UTKAST til kravbrev**. Det kjører helt offline med en deterministisk ekstraksjonsstub (ingen API-nøkkel). Det er **ikke** validert på reelle kundedata. Det har nå produksjons*fundamentet* (API-nøkkelautentisering med isolasjon per tenant, PostgreSQL-persistens med migrasjoner, sandboxet parsing, en hash-låst forsyningskjede), men reelle integrasjoner, en tredjeparts sikkerhetsrevisjon og samsvarsgodkjenning kreves fortsatt før reelle kundedata (se «Før reelle kundedata»). Det er et utgangspunkt, ikke et enterprise-system. Se [ARCHITECTURE.md](ARCHITECTURE.md) ([norsk](ARCHITECTURE.no.md)) og [deploy/aws.md](deploy/aws.md).

## Stack
Python 3.11+ (utviklet på 3.14, CI/Docker på 3.12), FastAPI, pydantic v2, uvicorn, pdfplumber (PDF-tekstlag), SQLAlchemy 2 + Alembic, psycopg 3 (PostgreSQL), pytest. Direkte pinner ligger i `requirements.in` / `requirements-dev.in`; `requirements.txt` / `requirements-dev.txt` er de **hash-låste** filene generert fra dem (hver transitiv avhengighet er pinnet og hashet). CSV håndteres med stdlib (pandas ble bevisst hoppet over: for tungt for det som trengs).

## Oppsett, kjøring, test
```bash
python -m venv .venv
.venv/Scripts/activate            # Windows (Git Bash: source .venv/Scripts/activate); Linux/macOS: source .venv/bin/activate
pip install --require-hashes --no-deps -r requirements-dev.txt   # hash-locked; pip aborts on any mismatch

pytest                                            # run the test suite (offline, SQLite)
python -m freight_recovery.cli --perspective carrier tests/fixtures/ld5002/*   # CLI (set PYTHONPATH=src); no auth/DB needed
```
For å kjøre API-et (trenger database, tenant og nøkkel), se **Kjøring med auth + Postgres** nedenfor.

### Endre avhengigheter
Rediger `requirements.in` (eller `requirements-dev.in`), generer deretter låsefilene på nytt og gå gjennom diffen:
```bash
pip install uv     # or any recent pip-tools; uv is only used to resolve, not at runtime
uv pip compile requirements.in     --universal --python-version 3.12 --generate-hashes --no-header -o requirements.txt
uv pip compile requirements-dev.in --universal --python-version 3.12 --generate-hashes --no-header -o requirements-dev.txt
```
`--universal` gir én lås som gjelder for Linux/macOS/Windows (plattformmarkører beholdes). Dependabot åpner disse oppdateringene ukentlig; CI kjører `pip-audit` og `trivy` på hver PR.

## API
Hver rute unntatt `GET /health` krever en API-nøkkel (`X-API-Key: <key>` eller `Authorization: Bearer <key>`): ingen nøkkel = **401**, enhver ugyldig nøkkel = **403**. Tenanten utledes kun fra nøkkelen.
- `GET /health` - anonym liveness-probe.
- `POST /v1/analyze` - multipart-opplasting av faktura / rate confirmation / BOL (PDF, CSV, TXT) for én last, pluss `perspective` (`shipper` | `carrier`). Lagrer analysen; svaret inneholder `analysis_id`.
- `POST /v1/analyze/text` - samme, med innebygde tekstdokumenter (JSON).
- `GET /v1/analyses?limit=&offset=` - innringerens analyser, nyeste først.
- `GET /v1/analyses/{id}` - én lagret analyse med dokumentenes metadata og hele pakken. En annen tenants id gir **404**, umulig å skille fra en som mangler.
- `/docs` og `/openapi.json` er **av som standard** (`FR_DOCS_MODE=off`); `auth` serverer dem kun med gyldig nøkkel (bruk `curl`/Postman/kodegenerering; nettlesere kan ikke legge ved headeren ved første sidelasting); `open` er anonym og avvist i produksjon.

Feilmapping: dårlig/misformet input 422 (faste meldinger, aldri ekko av innhold), for stor 413, tidsgrense for parsing overskredet 422, minne-/utdatagrense for parsing overskredet 413, alle arbeiderplasser opptatt 503 (`Retry-After`).

Perspektiv: **shipper** krever tilbake overfakturering; **carrier** krever tilbake detention/tilleggsgebyrer som er opptjent, men ikke fakturert eller underfakturert.

## Utviklerportal
Statiske B2B API-docs (MkDocs + Material, pinnet) i [developer-portal/](developer-portal/README.md): autentisering, quickstart, generert API-referanse og Redoc, feil, ratebegrensninger (planlagt), endringslogg. Bygges i CI, **ikke utrullet**. Bygg lokalt med `python developer-portal/build.py`. Portalsidene forblir på engelsk (standard for API-/utviklerdokumentasjon) og er ikke oversatt.

## Hva reglene gjør i dag
Detention (klokken starter ved det seneste av avtale/ankomst, fri tid og sats fra rate con, rundet ned til konfigurert inkrement med eksakt heltalls-minutt-aritmetikk, begrenset til kontraktens maks), linehaul over rate con, drivstofftillegg over rate con, tilleggsgebyrer som ikke er autorisert på rate con (flagget for menneskelig gjennomgang), gjentatte identiske linjer (også flagget for menneskelig gjennomgang: kan være legitime), fakturatotal over summen av linjene. **Kun bekreftede funn teller mot `recoverable_total` og kravbrevet; `needs_human_review`-poster listes og summeres separat som `pending_review_total`.** Regelnøkkelord-tabeller og terskler er illustrative og ikke målt. Konvensjonene er eksplisitte i `src/freight_recovery/rules/`; reelle kontrakter/tariffer varierer og vil kreve konfigurasjon per kunde.

## Hva som faktisk ble kjørt mot hva som er overlatt til CI
- **Kjørt lokalt (Windows, Python 3.14.7): `pytest` -> 344 passed** (SQLite, sandbox i prosess som standard; også kjørt én gang med `FR_TEST_SANDBOX=process`, hver forespørsel gjennom en ekte arbeiderunderprosess). Et ferskt venv bygget fra den hash-låste `requirements-dev.txt` med `pip install --require-hashes --no-deps` består også testsuiten; `pip check` er ren; `pip-audit` rapporterer ingen kjente sårbarheter i noen av låsefilene.
- **Kjørt i GitHub Actions på Linux / Python 3.12 (master, run 37257873084): alle seks jobber grønne** - testsuiten på SQLite med sandbox i prosess og med hver forespørsel gjennom en ekte arbeiderunderprosess (Linux rlimit minne/CPU-løpet), testsuiten på **PostgreSQL 16**, `pip-audit` på begge låsefilene, `trivy` på repoet (sårbarheter + hemmeligheter) og på det bygde imaget (ingen fikserbare HIGH/CRITICAL etter OS-oppdateringer), og en container-røyktest (migrering, 401/403/404-oppførsel, opprettelse av tenant + nøkkel, en full analyse gjennom sandbox-arbeideren, tenant-avgrenset liste). Ikke kjørt noe sted: Terraform (fortsatt et skjelett), `trivy config`-funn er kun informative, og ingenting er utrullet til AWS.

## Stubbet / TODO (reelt arbeid gjenstår)
- Ekstraksjon er en deterministisk `Key: Value`-parser; reelle transportør-PDF-er trenger layoutbevisst parsing/OCR og en hostet-modell-leverandør bak `ExtractionProvider` (plassholderen `LLMExtractionProvider` kaster NotImplementedError).
- Ingen TMS-/transportørportal-/EDI-integrasjoner (204/210/214), ingen betalinger eller kreditnota-avstemming, ingen e-post-/portal-innsending av tvister, ingen fristsporing.
- Ingen asynkron jobbkø (analyser kjører synkront; `analyses`-raden modellerer allerede jobblivssyklusen), ingen ratebegrensning, ingen malware-skanning av opplastinger, ingen oppbevarings-/slettepolicy, kun en revisjonslogglinje på applikasjonsnivå (ingen manipulasjonssikker lagring). Naive tidsstempler behandles som anleggslokale (blandet naiv/bevisst input avvises; DST-overganger på naive tider er ikke modellert).
- Regler er énveis per perspektiv (linehaul/drivstoff/total flagger kun overfakturering), så en kjøring fra transportørperspektiv finner ikke underfakturert linehaul.
- Regler er ikke validert mot reelle avsluttede saker; treffsikkerhetstall finnes ikke ennå. Kravbrev er utkast og sendes aldri automatisk.

## Produksjonsfundament (hva som finnes nå)
- **Autentisering + tenant-isolasjon:** API-nøkler per tenant, lagret kun som en HMAC-SHA256-hash (nøklet med en pepper holdt utenfor DB-en); nøkler vises én gang; kan tilbakekalles; auth kjører før request-body leses. Alle lagrede/hentede data er avgrenset til nøkkelens tenant (repository bundet til én tenant; lagringsnøkler tenant-prefiksede). Tester beviser 401 / 403 / kryss-tenant 404.
- **Persistens:** SQLAlchemy 2 + Alembic (`src/freight_recovery/db/`), SQLite for lokalt/tester, PostgreSQL i compose/prod. Analyser er jobb- og resultatposter per tenant. Rå opplastinger ligger bak en `StorageProvider` (lokalt filsystem som standard; en **S3-stub** bak `FR_STORAGE_BACKEND=s3` *og* `FR_STORAGE_S3_ENABLED=true`, aldri prøvd mot ekte AWS, `boto3` er ikke en avhengighet).
- **Avgrenset parsing:** hele pipelinen kjører i en separat arbeiderprosess per forespørsel med hard veggklokke-timeout, minnetak, CPU-grense, utdatatak og et rent miljø (ingen DB-URL, pepper eller AWS-legitimasjon). **Dette er prosessisolasjon, ikke en sikkerhetssandbox**: full inneslutning (seccomp, skrivebeskyttet rotfilsystem, ingen egress, fjernede capabilities, grenser per oppgave) er et anliggende på utrullingslaget, se `deploy/aws.md`.
- **Forsyningskjede:** hash-låste requirements, hash-verifisert image-installasjon, digest-pinnede base-/Postgres-images, SHA-pinnede Actions, `pip-audit`, `trivy`, Dependabot.
- **Feilsikker konfigurasjon:** `FR_ENV=production` (image-standarden) nekter å starte uten en `FR_API_KEY_PEPPER` på >=32 tegn, PostgreSQL, `FR_SANDBOX_MODE=process`, og med `FR_DOCS_MODE=open`.

## Kjøring med auth + Postgres
Lokalt, med Docker (API + PostgreSQL + engangsmigrering; kun loopback; offentlig pepper/passord kun for utvikling):
```bash
docker compose up --build                       # db -> migrate -> api on http://127.0.0.1:8000
docker compose run --rm api python -m freight_recovery.admin create-tenant "Acme Logistics"
docker compose run --rm api python -m freight_recovery.admin issue-key "Acme Logistics" --label dev
#   prints the raw key ONCE (frk_<id>_<secret>); only its hash is stored. Lost key => issue a new one.
export KEY=frk_...                              # paste it

curl http://127.0.0.1:8000/health                                   # 200, no key needed
curl http://127.0.0.1:8000/v1/analyses                              # 401: no key
curl -H "X-API-Key: wrong" http://127.0.0.1:8000/v1/analyses        # 403: invalid key
curl -H "X-API-Key: $KEY" -F perspective=shipper \
     -F files=@tests/fixtures/ld5001/invoice.txt \
     -F files=@tests/fixtures/ld5001/rate_confirmation.txt \
     -F files=@tests/fixtures/ld5001/bol.txt \
     http://127.0.0.1:8000/v1/analyze                               # 200 + analysis_id
curl -H "X-API-Key: $KEY" http://127.0.0.1:8000/v1/analyses         # your analyses only
curl -H "X-API-Key: $KEY" http://127.0.0.1:8000/openapi.json        # docs_mode=auth in compose
```
Uten Docker (SQLite-fil, fra repo-roten med venv aktivt):
```bash
export PYTHONPATH=src FR_ENV=dev FR_API_KEY_PEPPER=dev-pepper-not-a-secret-0123456789abcdef FR_DOCS_MODE=auth
python -m freight_recovery.db.migrate           # creates ./freight_recovery.db (Alembic upgrade head)
python -m freight_recovery.admin create-tenant "Acme Logistics"
python -m freight_recovery.admin issue-key "Acme Logistics"
uvicorn freight_recovery.api.main:app --app-dir src
```
Konfigurasjon (alle `FR_*`-miljøvariabler; se `src/freight_recovery/config.py`):

| Variabel | Standard | Betydning |
|---|---|---|
| `FR_ENV` | `dev` (image: `production`) | `production` håndhever vernene ovenfor |
| `FR_DATABASE_URL` | `sqlite:///./freight_recovery.db` | f.eks. `postgresql+psycopg://user:pass@host:5432/freight` |
| `FR_API_KEY_PEPPER` | tom | HMAC-pepper for nøkkelhasher (>= 32 tegn i produksjon; hemmelig) |
| `FR_DOCS_MODE` | `off` | `off` / `auth` / `open` (kun dev) |
| `FR_STORAGE_BACKEND` | `local` | `local` eller `s3` (stub; trenger også `FR_STORAGE_S3_ENABLED=true`, `FR_STORAGE_S3_BUCKET`, valgfritt `FR_STORAGE_S3_PREFIX`, `FR_STORAGE_S3_KMS_KEY_ID`) |
| `FR_STORAGE_LOCAL_DIR` | `./var/documents` | rot for lagring på lokalt filsystem |
| `FR_SANDBOX_MODE` | `process` | `process` (arbeider per forespørsel) eller `inprocess` (kun dev/tester) |
| `FR_SANDBOX_TIMEOUT_SECONDS` / `FR_SANDBOX_MEMORY_MB` | `30` / `1024` | hard veggklokkegrense / minnetak utover arbeiderens oppstartsavtrykk |
| `FR_SANDBOX_MAX_WORKERS` / `FR_SANDBOX_QUEUE_TIMEOUT_SECONDS` | `4` / `10` | samtidige arbeidere / ventetid på ledig plass før 503 |

Skjemaendringer: rediger `src/freight_recovery/db/tables.py`, kjør `alembic revision --autogenerate -m "..."` (bruker `FR_DATABASE_URL`), gå gjennom den genererte filen; en test feiler hvis modeller og migrasjoner driver fra hverandre. Ved utrulling anvendes migrasjoner som et engangssteg før den nye versjonen tar trafikk (`python -m freight_recovery.db.migrate`), ikke fra hver app-instans.

## Inputherding på plass (siden gjennomgangen før produkt)
Tak på request-body og per fil / antall filer (sjekket før og under lesing), avgrensede JSON-felt på `/v1/analyze/text`, lineær-tid `Key: Value`-parsing (ingen ReDoS), streng pengeparsing (NaN/Infinity/eksponenter avvist), PDF-magic-byte-sjekk med side- og veggklokkevern, parse-/domenefeil mappet til 4xx med faste meldinger (ingen input ekkoet), upålitelige verdier escapet i Markdown-pakken og kravbrevutkastet, compose bundet til 127.0.0.1, base-image pinnet med digest, CI med minste-privilegium-token og SHA-pinnede actions. Regresjons- og invarianttester ligger i `tests/test_regressions_*.py`; auth-/tenant-tester i `tests/test_auth_api.py`; persistens i `tests/test_persistence.py` og `tests/test_storage.py`; sandbox i `tests/test_sandbox.py`.

## Prognoser (veikart)
**Fremtidig funksjon, ikke i drift.** Prognoser for etterspørsel/lane-volum for å hjelpe til med å prioritere hvilke lanes og forsendelser som skal følges opp først for innkreving. En avhengighetsfri sesongnaiv / glidende-gjennomsnitt-baseline finnes nå i `src/freight_recovery/forecast/` (testet, ingen ekstra avhengigheter). En nevral backend (`neuralforecast`) er valgfri via `pip install ".[forecast]"`, er IKKE validert ennå, og er av som standard. Den trenger reelle historiske data med flere tidsserier og blir ofte bare likt med enkle baselines. Ingen treffsikkerhetstall finnes. Ikke en del av kjerneflyten for innkreving.

## Før reelle kundedata (IKKE gjort; ikke hopp over)
Programvarefundamentet ovenfor er nødvendig, ikke tilstrekkelig. Fortsatt påkrevd:
1. **Reelle integrasjoner** som erstatter stub-ekstraksjonsleverandøren og de manglende TMS-/transportørportal-/EDI-forbindelsene (med databehandler-/leverandørgjennomgang, sladding og forsvar mot prompt-injeksjon før en hostet LLM ser et dokument).
2. **Uavhengig tredjeparts penetrasjonstest** og trusselmodell, kjørt mot en utrullet staging-stack. Dette repoets egne tester og den interne førrevisjonen er ingen erstatning.
3. **Samsvarsgodkjenning** som passer til dataene (kontraktskonfidensialitet/NDA-er, personvernlovgivning og SOC 2-beredskap etter hvert som kunder krever det): oppbevarings-/slettepolicy, databehandleravtaler, datalokalisering (residency), prosedyre for nøkkelrotasjon.
4. **Herding på utrullingslaget** som kode ikke kan gi: WAF + ratebegrensning, TLS, privat nettverk, containere uten egress/med seccomp/skrivebeskyttet rotfilsystem for parseren, KMS-kryptert RDS og S3, Secrets Manager, manipulasjonssikker revisjonslogging, alarmer, backup/PITR. En komplett, validert Terraform-stack (den nåværende er et skjelett) er en del av dette.
5. Malware-skanning av opplastinger, en asynkron jobbkø for store dokumenter, og PostgreSQL radnivåsikkerhet som dybdeforsvar for tenant-isolasjon.
6. Målt treffsikkerhet i en designpartner-pilot (se forretningsdokumentene): ingen treffsikkerhetstall finnes ennå.

---

# Nettplattform (TypeScript, før produkt, kun syntetiske data)

> **Status: før produkt, IKKE produksjonsklar, kun syntetiske data.** Plattformen har aldri vært utrullet,
> har ikke hatt noen tredjeparts penetrasjonstest og har aldri sett reelle kundedata. Oppstart i
> produksjon **avvises av konfigurasjonsvalideringen** til en ekte e-posttransport finnes: i produksjon
> avvises alle `MAIL_TRANSPORT`-verdier (`outbox` er kun for utvikling, `ses` er en uimplementert stubb). Docker-imagene og
> compose-stacken har aldri vært bygget eller startet (Docker-motoren var nede under hele byggingen). Alt
> under «Før reelle kundedata» ovenfor gjelder her også. Trusselmodell og kjente mangler (engelsk):
> [technical/web-platform-security.md](technical/web-platform-security.md). Arkitektur:
> [ARCHITECTURE.no.md, «Nettplattform»](ARCHITECTURE.no.md#nettplattform-typescript-steg-1-2).

En nettapplikasjon med flere tenants for arbeidsflyten rundt bevispakker, bygget med sikkerhet først.
Byggesteg 1 til 4 er ferdige:

- **Steg 1:** innlogging med e-post og passord (argon2id), et kortlivet tilgangstoken pluss en roterende
  refresh-informasjonskapsel, TOTP-MFA for eier, administrator og plattformroller, utestenging med
  eksponentiell backoff, CSRF-beskyttelse, streng CSP og sikkerhetshoder, ratebegrensning, RBAC for 8
  roller, tenant-isolasjon som feiler lukket (PostgreSQL radnivåsikkerhet pluss en Prisma-vakt), og et
  hashkjedet revisjonsspor som bare kan utvides.
- **Steg 2:** en kravliste (filtrering, sortering, søk), et detaljpanel for kravet med visning av
  bevispakken, og godkjenningsporten med menneske i løkken (godkjenn / rediger / avvis / send, hver med
  begrunnelse).
- **Steg 3:** import av dokumenter (PDF, CSV, TXT, PNG, JPEG) med typegjenkjenning, kryptert lagring,
  parsing i en isolert arbeiderprosess, deterministisk uttrekk av felt med kildepekere, en kø for
  menneskelig gjennomgang og opprettelse av krav; pluss eksport av krav, bevispakker og
  godkjenningsbeslutninger til CSV og Excel med formelnøytralisering. Se
  [Import og eksport (steg 3)](#import-og-eksport-steg-3).
- **Steg 4:** et internt **utviklerdashbord** for plattformansatte (pipelinehelse, telemetri for
  forespørsler, filtrerte logger, funksjonsflagg, evalueringskjøringer, plattformens revisjonsspor; bare
  aggregater, aldri kundedata), **Recovery intelligence** for tenantbrukere (en prioritert arbeidsliste,
  lignende tidligere krav og et sammendrag av proveniens, alt beregnet med faste, dokumenterte regler på
  tenantens egne data), **API-nøkler for tenanter** for maskintilgang til ni ruter, og et
  **evalueringsverktøy** på kommandolinjen (pass^k på syntetiske testdata). Se
  [Utviklerdashbord, Recovery intelligence og API-nøkler (steg 4)](#utviklerdashbord-recovery-intelligence-og-api-nøkler-steg-4).

«Send» merker bare et krav som klart til sending og logger det i revisjonssporet. Ingen e-post sendes, og
ingen penger flyttes. De seedede kravene og bevispakkene er syntetiske og er transkribert fra
Python-CLI-ens utdata på `tests/fixtures/`. Krav som opprettes ved import, har ennå ingen beløp eller
pakke. OCR, mottak av videresendt e-post, enhver lært modell eller LLM-kall og TS-porten av
Python-reglene (byggesteg 5, som skal analysere importerte krav) er senere steg.

**Python-tjenesten og pilotdashbordet `webapp/` er uendret og blir værende.** Nettplattformen har sin
egen compose-fil (`compose.web.yml`), sin egen CI-arbeidsflyt (`.github/workflows/web-ci.yml`) og sin
egen Terraform (`infra/`, som erstatter `deploy/terraform/` kun for nettstacken). Rotens
`docker-compose.yml`, `ci.yml`, `src/`, `tests/`, `webapp/` og `deploy/` ble ikke endret.

## Struktur

| Sti | Innhold |
| --- | --- |
| `web/` | React 19 + TypeScript + Vite SPA (React Router, TanStack Query, Zustand, Tailwind) |
| `api/` | Node 22 + Fastify 5 + Prisma 7 (PostgreSQL 16) + Zod + Pino. Skjema, migrasjon og RLS-SQL ligger i `api/prisma/`; DB-roller i `api/db/init/00-roles.sql`; den syntetiske seeden i `api/scripts/seed.ts` |
| `packages/shared/` | `@fr/shared`: roller og tillatelsesmatrisen (eneste sannhetskilde), Zod-DTO-er, kanonisk JSON, tekstsikkerhet |
| `infra/` | Terraform-skjelett for AWS (VPC, RDS, S3 + KMS, ECS Fargate, ALB + WAF, ElastiCache, Secrets Manager, CloudFront). Kun `fmt` og `validate`, **aldri anvendt**; se `infra/README.md` |
| `compose.web.yml` | Lokal stack: postgres, redis, minio, migrate, api, web (kun loopback) |
| `.env.example` | Alle variabler, med plassholdere. Plassholdere avvises ved oppstart |

## Lokal hurtigstart (uten Docker: veien som faktisk ble verifisert)

Forutsetninger: Node 22 (`.nvmrc` låser 22.23.3, versjonen i de digest-låste `node:22-alpine`-bildene;
`engines` tillater `>=22.15.0 <23 || >=23.5.0 <25`: steg 3 trenger `module.registerHooks`, lagt til i Node
22.15.0 / 23.5.0, for vakten i parse-sandkassen, og API-et nekter å starte uten den), PostgreSQL 16, og `openssl` (eller Node, se nedenfor). Import/eksport trenger i
tillegg en S3-kompatibel lagring (MinIO lokalt) og, for paritetstestene, Python: se
[Lokal verifisering uten Docker](#lokal-verifisering-uten-docker).

```bash
npm ci --ignore-scripts                 # install scripts stay disabled (.npmrc)
npm run verify:no-install-scripts
npm run prisma:generate

# 1. Database roles + databases (once, as the Postgres superuser; .env.example assumes port 5433):
psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5433 -U postgres -f api/db/init/00-roles.sql

# 2. Environment: copy and replace EVERY <...> placeholder (the API refuses to start with them).
cp .env.example .env
openssl rand -hex 32        # JWT_SECRET      (hex is valid ...)
openssl rand -hex 32        # CSRF_SECRET
openssl rand -base64 48     # REFRESH_PEPPER  (... and so is base64)
openssl rand -base64 32     # MFA_ENC_KEY     (must be base64 of exactly 32 random bytes)
openssl rand -hex 32        # API_KEY_PEPPER  (step 4; optional outside production, required in production)
#   no openssl? node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
set -a; . ./.env; set +a    # the API and the seed read process.env only (no .env loader)

# 3. Schema + synthetic seed (owner role via MIGRATE_DATABASE_URL). The seed runs only with NODE_ENV=development|test
#    AND a loopback/compose DB host (127.0.0.1, localhost, ::1, postgres) or an explicit ALLOW_SEED=1; never RDS.
npm run db:migrate:deploy
npm run db:seed             # idempotent;  npm run db:seed -- --reset  wipes and recreates the seed tenants

# 4. Run (two terminals, each with the env loaded)
npm run dev -w api          # http://127.0.0.1:3001
npm run dev -w web          # http://127.0.0.1:5173 (proxies /api to the API)
```

Regler for hemmeligheter: `JWT_SECRET`, `CSRF_SECRET` og `REFRESH_PEPPER` må hver være minst 43 tegn og
må være forskjellige fra hverandre. `API_KEY_PEPPER` (steg 4) må, når den er satt, være minst 43 tegn og
forskjellig fra alle andre hemmeligheter; satt men tom avvises overalt, og når den ikke er satt utenfor
produksjon, brukes den offentlige utviklingsverdien. Verdier som ser ut som plassholdere avvises i alle
miljøer. I produksjon avvises i tillegg de dokumenterte dev-/CI-verdiene, og hver hemmelighet må bestå en
entropisjekk der regelen «ett tegn dominerer» er en eksakt binomisk grense, slik at en virkelig tilfeldig
hemmelighet feilaktig avvises med sannsynlighet under 10^-12. Tilfeldig hex (`openssl rand -hex 32`) og
base64 (`openssl rand -base64 48`) består begge. Full oversikt, rotasjon og sjekklisten for overlevering
står i [docs/secrets.no.md](docs/secrets.no.md).

Seed-kontoer (syntetiske, kun lokalt): `owner@acme.test`, `admin@acme.test`, `manager@acme.test`,
`reviewer@acme.test`, `analyst@acme.test`, `viewer@acme.test`, en andre tenant `*@globex.test`, og
plattformbrukerne `dev@platform.test` og `super@platform.test`. Passordet er `Synthetic-Pass-2026!`.
Eier-, administrator- og plattformkontoer krever TOTP. Seeden bruker den offentlige testhemmeligheten
`JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`, som du kan legge inn i en hvilken som helst autentiseringsapp.
Tilbakestillings- og invitasjonstokener vises på `GET /api/v1/dev/outbox`. Den ruten er kun for
utvikling: den finnes bare med `ENABLE_DEV_OUTBOX=true` utenfor produksjon.

**Med Docker (ikke verifisert):** `docker compose -f compose.web.yml up --build -d`, seed deretter med
`docker compose -f compose.web.yml run --rm api node dist/scripts/seed.js` og åpne http://127.0.0.1:8080.
Filen består `docker compose config`, men imagene har aldri vært bygget. Behandle første kjøring som en
test.

## Import og eksport (steg 3)

Steg 3 lar ansatte laste opp fraktdokumenter, kontrollere hva som ble lest ut av dem, gjøre godtatte
dokumenter om til krav, og eksportere krav, bevispakker og godkjenningsbeslutninger. Hver opplastet fil
behandles som fiendtlig. Arkitektur: [ARCHITECTURE.no.md, steg 3](ARCHITECTURE.no.md#nettplattform-import-og-eksport-steg-3).
Trusler: avsnitt 6 i [technical/web-platform-security.md](technical/web-platform-security.md) (engelsk).

**Ikke med i steg 3:** OCR, AI- eller LLM-kall, utgående e-post og mottak av videresendt e-post.
E-postvideresending er **kun et design** (design-only); se
[docs/design/email-ingest.md](docs/design/email-ingest.md) (engelsk).

### Hvem kan gjøre hva

| Rolle | Import (laste opp, se, laste ned, opprette krav) | Gjennomgang (avgjøre felt, godta eller avvise) | Eksportere krav | Eksportere pakker og beslutninger |
| --- | --- | --- | --- | --- |
| OWNER, ADMIN, MANAGER, REVIEWER | ja | ja | ja | ja |
| ANALYST | ja | nei | ja | nei |
| VIEWER, PLATFORM_DEV, SUPER_ADMIN | nei | nei | nei | nei |

Tillatelsene er `import:run`, `import:review`, `export:claims`, `export:packets` og `export:outcomes`,
definert i `packages/shared/src/rbac.ts`. API-et håndhever dem på hver forespørsel. Brukergrensesnittet
skjuler bare kontrollene.

### Formater og grenser

- **Godtatte filer:** PDF (bare tekstlaget), CSV, TXT, PNG og JPEG. Typen leses fra filens bytes, ikke fra
  nettleserens medietype, og filendelsen må stemme med den. Bilder strukturkontrolleres og lagres, men det
  leses ingen tekst fra dem (ingen OCR), så de går alltid til gjennomgang for manuell registrering.
- **Avvist før lagring:** filer over 10 MiB (`413`); ukjente eller feilmerkede typer; tekstfiler med binære
  kontrollbytes; HTML, SVG, XML eller PHP forkledd som tekst; tomme filer (`415` med en grunnkode). Ingenting
  lagres for en avvist fil.
- **Avvist etter parsing** (dokumentet får status `REJECTED`, og den lagrede kopien slettes): ødelagte
  eller krypterte PDF-er, PDF-er over 50 sider, mer enn 2 000 000 tegn tekst, ødelagt CSV, ødelagte eller
  for store bilder, og parsing som treffer tids- eller minnegrensen.
- **Batcher:** opptil 10 filer per batch. Samme fil to ganger i samme batch gir `409`. Lagringskvoten er
  1 GiB per tenant (`422 quota_exceeded`).
- **Opplasting** sender filens rå bytes (`POST /api/v1/imports/:batchId/documents?filename=...`,
  `Content-Type: application/octet-stream`). Nettleseren laster opp 2 filer om gangen og viser fremdrift.

### Hva som skjer med en opplasting

1. API-et strømmer innholdet med en hard størrelsesgrense og beregner SHA-256.
2. Det kontrollerer filtypen ut fra bytene.
3. Det lagrer originalen i S3 under `t/<tenantId>/imports/...`, kryptert med SSE-KMS.
4. En egen, avlåst arbeiderprosess parser filen. Prosessen har ikke miljøvariabler, hemmeligheter,
   nettverksmoduler eller databasetilgang.
5. Deterministiske regler trekker ut felt fra `Nøkkel: verdi`-linjer. Hvert felt registrerer hvor det
   kom fra (side, linje, tegn, CSV-rad og et utdrag).
6. Dokumentet ender som `ACCEPTED` (ingenting å kontrollere), `NEEDS_REVIEW`, `REJECTED` eller `FAILED`
   (infrastrukturfeil). Svaret på opplastingen inneholder allerede denne endelige tilstanden.

### Gjennomgang

- Et dokument går til **gjennomgangskøen** (`/import/review`) når et felt er flagget, typen er ukjent, det
  ikke ble funnet felt eller lastnummer, det er et bilde, det er et duplikat av en tidligere opplasting,
  eller noe innhold ikke kunne brukes.
- En gjennomgåer (`import:review`) bekrefter, korrigerer eller avviser hvert flagget felt. For bilder kan
  gjennomgåeren også sette dokumenttypen og skrive inn felt for hånd. Deretter godtar eller avviser
  gjennomgåeren hele dokumentet. Hver beslutning krever en begrunnelse på minst 10 tegn og lagres i en
  tabell som bare kan utvides, og i revisjonssporet. Godtatte dokumenter kan ikke endres.
- **Opprett krav fra godtatte dokumenter** (på importsiden; du velger avsender eller transportør)
  grupperer de godtatte dokumentene etter lastnummer. Det oppretter et nytt krav med status **Venter på
  analyse** (`AWAITING_ANALYSIS`), eller kobler dokumentene til et eksisterende krav. Et nytt krav har
  ingen beløp og ingen bevispakke før analysesteget (byggesteg 5) finnes. Har kravet allerede en pakke,
  kobles dokumentene bare til, og pakken endres ikke.

**Konfidens er en regelbasert parsepoengsum, ikke et mål på nøyaktighet.** Den sier hvordan verdien ble
lest (for eksempel 0,95 for en eksplisitt `Nøkkel: verdi`-linje i en tekst- eller CSV-fil, 0,85 for en
PDF, lavere for en gjettet dokumenttype eller et tvetydig datoformat). Den sier ikke hvor sannsynlig det
er at verdien er riktig, og produktet presenterer den aldri som nøyaktighet. Felt under 90 %
(`REVIEW_CONFIDENCE_THRESHOLD`) må gjennomgås, så alle PDF-felt gjennomgås som standard.

### Eksport

- **Kravliste** (`Export` på `/claims`): den gjeldende filtrerte listen. **Bevispakker** (`Export packet`
  på et krav): én rad per funn i den nyeste pakken. **Beslutninger** (`Export decisions` på `/approvals`):
  én rad per godkjenningspost.
- **Formater:** CSV (UTF-8 med BOM, CRLF, tekstceller i anførselstegn) eller Excel `.xlsx` (ett ark, fet
  fastfrosset overskriftsrad, typede tall). Filene strømmes; ingenting lagres på serveren. Grensen er
  50 000 rader per fil (`422`).
- **Formelnøytralisering:** en tekstcelle som ville startet med `=`, `+`, `-` eller `@` (også
  fullbreddeformene), etter eventuelt ledende mellomrom, får en `'` foran, slik at et regneark viser den
  som tekst i stedet for å kjøre den. Kontrolltegn og usynlige tegn fjernes først. Tall forblir tall
  (`-12.50` endres ikke). `.xlsx`-filene inneholder ingen formler, lenker eller makroer.
- **Innhold:** ingen brukernavn, e-postadresser eller bruker-id-er, og ingen tekst fra kravbrev. Beløp er
  i USD med to desimaler. `Invoice Date` er `YYYY-MM-DD`; andre tidsstempler er ISO-8601 UTC.
- **Revisjon:** `export.started` skrives før første byte. `export.completed` registrerer antall rader,
  størrelse og SHA-256 av nøyaktig den filen som ble sendt. En avbrutt nedlasting registreres som
  `export.aborted`.

### Konfigurasjon (steg 3)

Tabellen over alle innstillinger (navn, standardverdier, grenser i produksjon) står i den engelske
README-en under «Configuration (step 3)», og `.env.example` lister dem. De viktigste: `IMPORT_MAX_FILE_BYTES`
(10485760), `IMPORT_MAX_FILES_PER_BATCH` (10), `TENANT_STORAGE_QUOTA_BYTES` (1073741824), `PARSE_TIMEOUT_MS`
(20000), `PARSE_MEMORY_MB` (256), `PARSE_MAX_PDF_PAGES` (50), `PARSE_MAX_TEXT_CHARS` (2000000),
`REVIEW_CONFIDENCE_THRESHOLD` (0.90), `EXPORT_MAX_ROWS` (50000), `S3_SSE` (`aws:kms`) og `S3_KMS_KEY_ID`.
Samtidighetsgrensene for opplasting, eksport og parsing gjelder **per API-instans**.

### Lokal verifisering uten Docker

Docker-motoren virket ikke på byggemaskinen, så steg 3 ble verifisert med portable programmer. CI
(`.github/workflows/web-ci.yml`) er autoriteten for container-bygg. Hold alle programfiler utenfor repoet,
og commit dem aldri.

1. **PostgreSQL 16:** en portabel PostgreSQL 16 på en ledig loopback-port (bygget brukte
   `127.0.0.1:55433`). Kjør `api/db/init/00-roles.sql`, og migrer og seed som i hurtigstarten.
2. **MinIO med KMS:** last ned Windows-filen `minio.exe` fra MinIOs offisielle GitHub-utgivelse, og
   kontroller den publiserte SHA-256 før første kjøring (bygget brukte `RELEASE.2025-09-07T16-13-09Z`).
   Start den på loopback med en statisk KMS-nøkkel, slik at SSE-KMS virker lokalt:
   ```bash
   export MINIO_ROOT_USER=localdev MINIO_ROOT_PASSWORD=localdev-minio-password   # public dev values
   export MINIO_KMS_SECRET_KEY="fr-dev-key:$(openssl rand -base64 32)"          # <key name>:<base64 of 32 bytes>
   ./minio.exe server ./minio-data --address 127.0.0.1:59000
   ```
3. **API-miljø for S3** (i skallet som kjører testene):
   ```bash
   export S3_ENDPOINT=http://127.0.0.1:59000 S3_FORCE_PATH_STYLE=true S3_REGION=us-east-1
   export S3_BUCKET=fr-documents-dev S3_ACCESS_KEY_ID=localdev S3_SECRET_ACCESS_KEY=localdev-minio-password
   export S3_SSE=aws:kms S3_KMS_KEY_ID=fr-dev-key      # S3_SSE=none is the dev-only fallback
   npm run ensure-bucket                               # creates the bucket, enables versioning
   ```
   `ensure-bucket` kjører bare med `NODE_ENV=development` eller `test`. Den nekter i produksjon og når
   `NODE_ENV` ikke er satt, fordi AWS-bucketen styres av Terraform.
4. **Python-paritet:** paritetstestene kjører Python-referansekoden. Sett `PYTHON` til en tolk med
   repoets kjøretidsavhengigheter (for eksempel Python-tjenestens `.venv`). Testen setter
   `PYTHONPATH=<repo>/src` selv. I CI (`CI=true`) feiler testene hvis Python mangler; lokalt hoppes de
   over med en melding.
   ```bash
   export PYTHON=/path/to/.venv/Scripts/python    # Linux/macOS: .venv/bin/python
   ```
5. **Bygg, deretter test:** parsearbeideren er et byggeprodukt, så bygg før testene som bruker databasen.
   ```bash
   npm run build
   npm run test:integration
   npm run test:acceptance
   ```

Stopp de portable tjenestene etterpå. Med Docker starter `compose.web.yml` MinIO med samme KMS-nøkkelnavn
(`fr-dev-key`) og slår på versjonering (ikke verifisert lokalt).

### Python-paritet og registrerte avvik

TypeScript-parseren er en port av Python-koden i `ingest/` og `extraction/`. Paritetstestene
(`api/test/parity/`, kjøres av `npm run test:integration`) sammenligner begge på testfiler, genererte
tekst- og CSV-filer og genererte PDF-er med tekstlag. Disse registrerte avvikene er de eneste tillatte
forskjellene. Hele registeret med begrunnelser står i
[ARCHITECTURE.no.md](ARCHITECTURE.no.md#python-paritet-registrerte-avvik-d1-d8).

- **D1:** PDF-signaturen må stå på byte 0 (Python tåler 1024 søppelbytes).
- **D2:** PDF-tekst kommer fra pdf.js i stedet for pdfplumber. Paritet gjelder bare enkle PDF-er med tekstlag.
- **D3:** filendelsen må stemme med den gjenkjente typen (Python ser bare på endelsen).
- **D4:** ugyldig UTF-8 gir `DECODE_REPLACEMENTS`. NUL, C0-kontrollbytes (unntatt tab, LF, CR, FF) og
  DEL (0x7F) avviser filen som `binary_content`; Python ville fortsatt.
- **D5:** tekst over 2 000 000 tegn avvises (Python: 5 000 000).
- **D6:** tekstverdier renses og kuttes ved 200 tegn (`SANITIZED_VALUE`).
- **D7:** bare ASCII-sifre i datoer og klokkeslett, og bare en ASCII-endelse `USD`.
- **D8:** PNG og JPEG godtas, men gir ingen felt (ingen OCR); de går til manuell gjennomgang.

## Utviklerdashbord, Recovery intelligence og API-nøkler (steg 4)

Steg 4 legger til et internt dashbord for plattformansatte, forklarbare arbeidshjelpemidler for
tenantbrukere, API-nøkler for tenanter og et evalueringsverktøy. Arkitektur:
[ARCHITECTURE.no.md, steg 4](ARCHITECTURE.no.md#nettplattform-utviklerdashbord-recovery-intelligence-og-api-nøkler-steg-4).
Trusler (engelsk): avsnitt 7 i [technical/web-platform-security.md](technical/web-platform-security.md).
Hemmeligheter: [docs/secrets.no.md](docs/secrets.no.md).

**Ærlighetsregel.** Hvert tall på disse skjermene er beregnet fra data systemet har når forespørselen
kommer (databaserader, tellere i denne API-instansen eller evalueringskjøringer registrert av verktøyet),
og hvert tall sier hva det bygger på. Det finnes **ingen lært modell, ikke noe nevralt nettverk, ingen
cache, ingen LLM eller annet «AI»-kall, og ingen tall for treffsikkerhet eller hastighetsgevinst** noe
sted. Briefens «Hebbian router», «neural mesh» og «solved-problems cache (~250x)» er **ikke
implementert**; hva som leveres i stedet, står i
[ARCHITECTURE.no.md, «Begreper i briefen mot det som er bygget»](ARCHITECTURE.no.md#begreper-i-briefen-mot-det-som-er-bygget).

### Hvem ser hva

| Funksjon | OWNER | ADMIN | MANAGER | REVIEWER | ANALYST | VIEWER | PLATFORM_DEV | SUPER_ADMIN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Utviklerdashbord: Pipeline health, Telemetry (`platform:health`) | - | - | - | - | - | - | ja | ja |
| Utviklerdashbord: Logs, Feature flags, Evaluation (`platform:logs`, `platform:flags`, `platform:eval`) | - | - | - | - | - | - | ja | - |
| Utviklerdashbord: Audit, plattformens revisjonskjede (`platform:audit`) | - | - | - | - | - | - | - | ja |
| Recovery intelligence: arbeidsliste, lignende krav, proveniens (`claims:read`) | ja | ja | ja | ja | ja | ja | - | - |
| API-nøkler: opprette, liste, tilbakekalle (`apikeys:manage`) | ja | ja | - | - | - | - | - | - |

Plattformbrukere havner på `/dev` og får ingen tenantlenker; en tenantbruker som åpner `/dev`, sendes til
`/claims`. API-et håndhever den samme matrisen (`packages/shared/src/rbac.ts`): en tenantrute svarer 403
til en plattformbruker, og en plattformrute svarer 403 til en tenantbruker. Plattformansatte ser aldri
kundedata, og de kan aldri se, opprette eller tilbakekalle en tenants API-nøkler.

### Utviklerdashbord (`/dev`)

Hver lesing i dashbordet registreres i plattformens revisjonskjede (`platform.dashboard_viewed` eller
`platform.logs_viewed`) **før** dataene returneres; feiler den skrivingen, feiler forespørselen uten data.
Dashbordet oppdaterer seg aldri av seg selv: hver visning er et bevisst klikk på «Refresh». Lesinger er
begrenset til `RATE_LIMIT_PLATFORM_MAX` (120) per bruker per 10 minutter.

- **Pipeline health** (`GET /api/v1/platform/pipeline?window=1h|24h|7d`). Tellinger på tvers av **alle
  tenanter**, lest fra databasen ved forespørselen: dokumenter per status og per gjenkjent type,
  avvisninger per årsak, andelen avviste/feilede/til gjennomgang, tid fra opplasting til parsing (p50 og
  p95, interpolert over vinduets dokumenter), dybden på gjennomgangskøen og eldste ventetid, dokumenter
  som har stått i `RECEIVED` lenger enn `IMPORT_STALE_SECONDS`, og krav som venter på analyse. En
  `SECURITY DEFINER`-funksjon i SQL returnerer bare tellinger: ingen tenant, bruker, filnavn eller
  kravnummer. Filer som avvises før lagring (413/415), har ingen databaserad og vises bare i Telemetry.
- **Telemetry** (`/dev/telemetry`). Tellere for **denne API-instansen siden den startet** (de nullstilles
  ved omstart; med flere instanser har hver sine): forespørsler per statusklasse, antall 401/403/429, og
  per rutemønster (høyst 200 mønstre, resten under `(other)`, ukjente URL-er under `(unmatched)`) et
  varighetshistogram med bøttegrensene 5, 10, 25, 50, 100, 250, 500, 1000, 2500 og 5000 ms. p50 og p95
  vises som **øvre grense for bøtta** de faller i, aldri som et punktanslag. I tillegg tellerne for
  parsersandkassen og tabellen **Intelligence components**: `priority-v1` og `similar-v1`, hver med
  Method «Fixed rules», Learned model «None», flaggstatus, kall, feil og varighetsgrenser.
- **Logs** (`/dev/logs`). De siste `LOG_BUFFER_SIZE` (500) loggpostene fra **denne instansen**, holdt i
  minnet og tapt ved omstart. Bare åtte felt avledet fra den allerede maskerte logglinjen beholdes: tid,
  nivå, forespørsels-id, metode, rute**mønster**, status, varighet og hendelse. Hendelsesteksten vises
  bare når den samsvarer med `^[A-Za-z0-9 _.:/()-]{1,80}$`, ikke inneholder `@` og ikke har en rekke på 20
  eller flere tokenlignende tegn; alt annet vises som `(message withheld)`. Ingen spørrestreng, konkret
  sti, header, informasjonskapsel, body, IP-adresse, e-postadresse, token, API-nøkkel, filnavn eller
  dokumentverdi vises noen gang. Filtre: minimumsnivå og en eksakt forespørsels-id. Sentralt loggsøk
  ligger fortsatt hos skyleverandøren (ECS-logggruppen i CloudWatch).
- **Feature flags** (`/dev/flags`). Nøyaktig tre globale flagg, alle på som standard:
  `intelligence.worklist`, `intelligence.similar_claims` og `intelligence.provenance`. De kan bare slå av
  disse tre funksjonene, aldri en sikkerhetskontroll, og det finnes ingen overstyring per tenant. En
  endring krever en begrunnelse på minst 10 tegn og gjeldende versjon (en utdatert versjon gir 409), og
  skrives sammen med en `platform.flag_changed`-hendelse i revisjonssporet. Den virker innen
  `FLAGS_CACHE_TTL_MS` (5 sekunder som standard, per instans). Kan flaggtabellen ikke leses, regnes flagget
  som av.
- **Evaluation** (`/dev/evaluation`). Skrivebeskyttet liste over kjøringene evalueringsverktøyet (nedenfor)
  har registrert, med resultater per sak.
- **Audit** (`/dev/audit`, bare SUPER_ADMIN). Plattformens revisjonskjede og knappen «Verify chain».

### Recovery intelligence (tenantbrukere)

Siden «Intelligence» (`/intelligence`) og to nye faner i kravpanelet, «Similar» og «Provenance». Alle tre
bruker **bare tenantens egne data**, hver visning registreres som `intelligence.viewed` i tenantens
revisjonskjede, de er begrenset til `RATE_LIMIT_INTELLIGENCE_MAX` (120) forespørsler per bruker per 10
minutter, og en funksjon som er slått av med flagget sitt, svarer 404.

**Prioritert arbeidsliste (`priority-v1`).** Krav i `PENDING_REVIEW` eller `APPROVED` som har en
bevispakke, sorteres etter penger. Bekreftet innkrevbare dollar teller fullt; dollar som fortsatt venter
på menneskelig gjennomgang, teller med **W = 25 %**. W er en uttalt policy, ikke noe som er lært fra data
(det finnes ingen innkrevingsutfall å lære av); den settes med `INTELLIGENCE_PENDING_WEIGHT_PERCENT` og
vises sammen med hvert resultat.

```
priority score (cents) = recoverable + floor(pending_review * W / 100)      W = 25 by default
order: score (high first), then recoverable (high first), then waiting longest first, then claim id
```

Eksempel: $1,000.00 bekreftet og $400.00 til gjennomgang gir $1,000.00 + $100.00 = **$1,100.00**. Hver rad
forklarer plasseringen («Confirmed recoverable $1,000.00 (counted at 100%)», «Pending human review
$400.00 (counted at 25%)», hvor mange funn som fortsatt trenger gjennomgang, og «Waiting 3 days (not part
of the score)») og neste handling (Resolve findings, Review and approve, Mark send-ready). Siden sier:
«This is a work-order aid, not a forecast of what will be recovered.» Krav som fortsatt er
`AWAITING_ANALYSIS`, rangeres ikke; siden teller dem («Not ranked: n claims awaiting analysis»). Til
byggesteg 5 analyserer importerte krav, er arbeidslisten for en ekte tenant tom; bare de seedede
demokravene rangeres.

**Lignende tidligere krav (`similar-v1`).** Det åpne kravet sammenlignes med de 500 sist oppdaterte
kravene i samme tenant (`SIMILAR_CANDIDATE_LIMIT`) som teamet allerede har avgjort (`APPROVED`,
`SEND_READY` eller `REJECTED`) og som har en bevispakke. Poeng (faste vekter, totalt 0-100):

| Signal | Poeng |
| --- | --- |
| Samme transportør (store/små bokstaver og ekstra mellomrom ignoreres) | 35 |
| Felles regler: 40 x (regler i begge) / (regler i minst ett), rundet ned | 0-40 |
| Lignende beløp: 15 x (minste total) / (største total), rundet ned | 0-15 |
| Samme perspektiv (avsender eller transportør) | 10 |

Et krav vises bare med minst 30 poeng **og** samme transportør eller minst én felles regel; de beste
treffene kommer først (likt: sist oppdatert). Hvert treff viser grunnene, hvordan teamet behandlet kravet
(endelig status, regel-id-er, dokumenttyper i kildene, beslutningsdato) og linjen «Computed in X ms over N
claims», som er den målte tiden for **akkurat den** forespørselen. Det finnes ingen cache og ingen påstand
om hastighetsgevinst. «Final status shows how your team handled the claim, not whether the carrier paid.»

**Proveniens.** For hvert dokument knyttet til kravet: antall uttrukne og manuelle felt per
gjennomgangsstatus, uavklarte flaggede felt og laveste konfidens. «Confidence is a rule-based parse score,
not an accuracy measure.»

### API-nøkler (maskintilgang)

- **Hvem.** OWNER og ADMIN forvalter nøkler under Innstillinger > «API keys» (`/settings/api-keys`). En
  nøkkel tilhører én tenant; tenanten hentes fra nøkkelen, aldri fra forespørselen.
- **Opprette.** Navn, minst ett omfang (scope) og en utløpstid på 30, 90, 180 eller 365 dager
  (**standard 90**, `API_KEY_DEFAULT_TTL_DAYS`). Produksjon tillater aldri nøkler uten utløp. Du kan bare
  gi omfang du selv har tillatelsen til. Høyst `API_KEY_MAX_ACTIVE` (20) aktive nøkler per tenant.
- **Vises én gang.** Hele nøkkelen vises bare i dialogen «API key created», med en kopieringsknapp. Når
  dialogen lukkes, slettes den; serveren lagrer bare en HMAC-SHA-256-hash nøklet med `API_KEY_PEPPER`, så
  ingen kan vise den igjen. En tapt nøkkel erstattes med en ny. Listen viser bare det offentlige prefikset
  `fr_live_<16 hex>`.
- **Bruk.** Formatet er `fr_live_<16 hex>_<43 tegn>`, og nøkkelen sendes **bare** som header:
  ```bash
  curl -H "Authorization: Bearer $FR_API_KEY" http://127.0.0.1:3001/api/v1/claims
  ```
  Legg aldri en nøkkel i en URL, spørrestreng, informasjonskapsel eller body: en forespørsel med
  `fr_live_` i URL-en avvises med 400 før noe annet skjer, og verdien logges aldri (loggeren erstatter
  også enhver `fr_live_...`-streng med `[REDACTED]`). Nøkkelforespørsler trenger ikke CSRF-token og får
  aldri informasjonskapsler; har de en `Origin`-header, må den være lik `APP_ORIGIN`.
- **Omfang og de ni rutene som godtar en nøkkel.** Alle andre ruter avviser en nøkkel med 403, selv om den
  har alle omfang: bevispakker, godkjenninger, gjennomgang, commit, nedlasting av originaler, eksport av
  pakker og beslutninger, brukere, revisjonsspor, intelligence, `/features`, `/me`, autentisering,
  plattformrutene, nøkkelrutene og helsesjekken.

  | Omfang | Ruter (under `/api/v1`) | Tillatelse som kontrolleres på nytt ved hver forespørsel |
  | --- | --- | --- |
  | `claims.read` | `GET /claims`, `GET /claims/:id`, `GET /claims/:id/documents` | `claims:read` |
  | `exports.claims` | `GET /exports/claims` | `export:claims` |
  | `imports.write` | `POST /imports`, `GET /imports`, `GET /imports/:batchId`, `POST /imports/:batchId/documents`, `GET /imports/:batchId/documents/:docId` | `import:run` |

- **Samme regler som en bruker.** En nøkkelforespørsel går gjennom samme tenant-isolasjon,
  tillatelseskontroller, ratebegrensninger, flagg og revisjonsspor som en bruker i den tenanten.
  Revisjonshendelser viser aktørrollen `API_KEY` og `viaApiKey: <nøkkel-id>`; eierkolonner får skaperens
  id. **Skaperens nåværende rolle** sjekkes ved hver forespørsel: er skaperen deaktivert eller har ikke
  lenger tillatelsen omfanget krever, eller er tenanten suspendert, får nøkkelen 401.
- **Feil.** Ukjent nøkkel, feil hemmelighet, feil format, tilbakekalt eller utløpt: en identisk 401
  (ingenting skiller dem). En gyldig nøkkel på en rute den ikke får bruke: 403.
- **Tilbakekalle.** «Revoke <name>» med en begrunnelse på minst 10 tegn. Det virker fra neste forespørsel på
  alle instanser (nøkkelstatus leses fra databasen ved hver forespørsel og bufres aldri).
- **Rotere.** Lag en ny nøkkel, bytt klienten over, og tilbakekall deretter den gamle. Å rotere
  `API_KEY_PEPPER` gjør alle nøkler ugyldige på én gang (se [docs/secrets.no.md](docs/secrets.no.md)).
- **Ratebegrensning.** `RATE_LIMIT_API_KEY_MAX` (300) forespørsler per nøkkel per 60 sekunder. Mislykket
  nøkkelautentisering: `RATE_LIMIT_API_KEY_FAIL_MAX` (30) per klientadresse per 10 minutter; etter den 30.
  feilen får hver videre nøkkelforespørsel fra den adressen, også med gyldig nøkkel, 429 **før** noen
  verifisering til vinduet er over. Grensene for opplasting og eksport fra steg 3 gjelder også. «Last
  used» oppdateres høyst én gang i minuttet.

### Evalueringsverktøy (pass^k på syntetiske testdata)

```bash
npm run build      # the tool runs the built parser worker
npm run eval -- --set api/eval/sets/extraction-v1 --k 3 --min-pass-hat-k 1   # the CI gate
npm run eval -- --set api/eval/sets/extraction-v1 --k 3 --json               # machine-readable output
npm run eval -- --set api/eval/sets/extraction-v1 --k 3 --record             # also store the run (needs DATABASE_URL)
```

Hver sak kjøres k ganger (1-20, standard 3) gjennom de **samme** kontrollene før lagring og den **samme**
sandkasseparsingen som API-et, uten nettverk og uten database. En kjøring regnes som riktig bare hvis
resultatet er nøyaktig likt fasiten (dokumenttype og hvert felt, eller nøyaktig samme avvisningsårsak).

- **pass^k** = andelen saker der **alle k kjøringer** var riktige. Det straffer ustabil oppførsel: en sak
  som er riktig 9 av 10 ganger, feiler pass^k langt oftere enn pass^1. Verktøyet rapporterer også andelen
  riktige kjøringer, pass^j-kurven for j = 1..k (et forventningsrett anslag), ustabile saker og saker som
  alltid feiler, hvor mange saker som ga byte-identisk utdata i alle kjøringer, og et Wilson
  95 %-intervall for pass^k.
- Dette uttrekkssteget er deterministisk, så pass^k er lik pass^1 her, og dashbordet sier det.
- **Bare syntetiske testdata.** Settet `api/eval/sets/extraction-v1` har 30 syntetiske saker (9 med
  fasit fra Python-referansen, 9 forventede avvisninger, 12 håndskrevne). Resultatene er **ikke et mål på
  treffsikkerhet** på ekte dokumenter. Siste kjøring: 30 av 30 saker besto alle 3 kjøringene, alle
  deterministiske, Wilson 95 %-intervall 88,6 %-100 %. Det sier bare at steget gjenskaper 30 kjente svar
  konsekvent.
- Avslutningskoder: 0 suksess (og terskel nådd), 1 `--min-pass-hat-k` ikke nådd, 2 bruks- eller
  manifestfeil, 3 infrastrukturfeil. Uten `--record` skrives ingenting noe sted. `--record` skriver
  kjøringen og saksresultatene i én transaksjon og legger `eval.run_recorded` til plattformens
  revisjonskjede; den skriver aldri ut database-URL-en. CI kjører terskelen ved hver bygging.

### Konfigurasjon (steg 4)

Alle innstillinger leses én gang ved oppstart og områdesjekkes; produksjonsgrenser gjelder bare med
`NODE_ENV=production`. `.env.example`, `compose.web.yml` og `infra/ecs.tf` lister dem.

| Variabel | Standard | Betydning |
| --- | --- | --- |
| `LOG_BUFFER_SIZE` | 500 | loggposter holdt i minnet for Logs-fanen (50..5000) |
| `FLAGS_CACHE_TTL_MS` | 5000 | flaggbuffer per instans (0..60000; produksjonstak 30000; 0 = ingen buffer) |
| `INTELLIGENCE_PENDING_WEIGHT_PERCENT` | 25 | W, vekten på dollar til gjennomgang i arbeidslisten (0..100) |
| `SIMILAR_CANDIDATE_LIMIT` | 500 | tidligere krav som sammenlignes per «Similar»-forespørsel (10..2000) |
| `RATE_LIMIT_PLATFORM_MAX` / `RATE_LIMIT_INTELLIGENCE_MAX` | 120 / 120 | forespørsler til dashbord / intelligence per bruker per 10 minutter |
| `API_KEY_PEPPER` | utviklingsverdi utenfor produksjon | HMAC-nøkkel for lagrede hasher av API-nøkler; **hemmelig**, påkrevd i produksjon (se [docs/secrets.no.md](docs/secrets.no.md)) |
| `API_KEY_MAX_ACTIVE` | 20 | aktive nøkler per tenant (1..200) |
| `API_KEY_DEFAULT_TTL_DAYS` | 90 | standard utløpstid (1..365) |
| `API_KEY_ALLOW_NON_EXPIRING` | true utenfor produksjon | nøkler uten utløp; må være false i produksjon |
| `RATE_LIMIT_API_KEY_MAX` | 300 | forespørsler per nøkkel per 60 sekunder |
| `RATE_LIMIT_API_KEY_FAIL_MAX` | 30 | mislykkede nøkkelautentiseringer per klientadresse per 10 minutter |

## Tester og kontroller

```bash
npm run typecheck
npm run lint                 # --max-warnings 0
npm test                     # unit tests (shared, api, web); no database needed
npm run ensure-bucket        # step 3: create the dev/test bucket in MinIO (S3_* env; refuses production)
npm run build                # shared + api + web (+ dist check: no inline script/style, no sourcemaps);
                             # builds the parser worker, so run it BEFORE the integration/acceptance suites
npm run test:integration     # api, against a migrated + seeded test DB (TEST_DATABASE_URL, TEST_ADMIN_DATABASE_URL,
                             # and the same MFA_ENC_KEY the seed used), S3 (MinIO) and Python (PYTHON=...) for the
                             # parity suite; see the env block in .github/workflows/web-ci.yml
npm run test:acceptance      # black-box acceptance suites under */test-acceptance/ (when present)
npm run eval -- --set api/eval/sets/extraction-v1 --k 3 --min-pass-hat-k 1   # step 4: after npm run build
npm run audit && npm audit signatures
terraform -chdir=infra fmt -check -recursive && terraform -chdir=infra init -backend=false && terraform -chdir=infra validate
```

Hva som faktisk ble kjørt (2026-10-08, Windows, Node 24, portabel PostgreSQL 16.15): typecheck, lint,
enhetstester (shared 30, api 83, web 29), integrasjon (3/3), build, `npm audit` (0 sårbarheter),
`npm audit signatures`, migrering + seed, og terraform fmt/validate (portabel 1.16.5). Den uavhengige
akseptansekjøringen ga 334 bestått, 0 feilet, 5 hoppet over, 2 todo. **Ikke kjørt:** Docker-imagene eller
compose-stacken, Playwright-ende-til-ende-tester og enhver AWS-utrulling.

Steg 3 (2026-10-09, Windows, Node 24 pluss en kontroll av arbeideren på Node 22.23, portabel PostgreSQL
16.15, portabel MinIO med SSE-KMS, Python 3.14 og 3.12 for paritet): typecheck, lint, enhetstester (shared
113, api 279, web 46), migrering + seed, `ensure-bucket`, build, integrasjon (55 bestått, 2 plassholdere
hoppet over), `npm audit` (0 sårbarheter), `npm audit signatures`, terraform fmt/validate. Paritet med
Python-referansen: null uregistrerte forskjeller. Uavhengig akseptansekjøring (runde 2): shared 22/22, web
87 bestått (1 Playwright hoppet over), api 500 bestått; de 3 api-feilene var denne dokumentasjonen (nå lagt
til) og to testfeil som ble rettet og kjørt på nytt. **Ikke kjørt:** container-images og compose-stacken,
Playwright, eksporttesten med tvunget revisjonsfeil, tester for krypterte PDF-er (ingen `qpdf`), enhver
AWS-utrulling.

Steg 4 (2026-10-09, kjøringen `REQ-20261009-step4-intelligence`, Windows, Node 22.23.3 (CI-versjonen) og
Node 24.21.0, portabel PostgreSQL 16, portabel MinIO med SSE-KMS, Python for paritet, i stegrekkefølgen
og med miljøet fra `web-ci.yml`): lint, typecheck, enhetstester (shared 134, api 346, web 62), migrering
+ seed, `ensure-bucket`, build, evalueringsterskelen (30 av 30 saker besto alle 3 kjøringene),
integrasjon (85 bestått, 2 plassholdere hoppet over). Uavhengig akseptansekjøring (runde 2): shared
33/33, web 138 bestått (1 hoppet over), api 651 bestått (9 hoppet over på grunn av manglende verktøy eller
erklærte unntak, 2 todo). Runde 1 fant seks feil (D-1..D-6); alle ble rettet og verifisert på nytt.
**Ikke kjørt:** container-images og compose-stacken, Playwright, terraform i testkjøringen (byggeren kjørte
fmt/validate), enhver AWS-utrulling.
