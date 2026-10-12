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
Byggesteg 1 til 8 er ferdige:

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
- **Firøyeprinsippet (etter steg 4):** den som har redigert en revisjon, kan ikke godkjenne eller avvise
  den; den som har lastet opp, korrigert eller lagt til felt i et dokument, kan ikke godta det. Se
  [Firøyeprinsippet (arbeidsdeling)](#firøyeprinsippet-arbeidsdeling).
- **Steg 5:** **kravanalyse**. Python-reglene og utkastet til kravbrev er portert til TypeScript (utdata
  identisk tegn for tegn med Python-referansen på et paritetskorpus, bortsett fra seks registrerte avvik).
  En **analyse**-handling gjør et importert krav som venter på analyse, om til bevispakkerevisjon 1 for
  menneskelig gjennomgang; en massehandling analyserer opptil 10 om gangen. Se
  [Kravanalyse (steg 5)](#kravanalyse-steg-5).
- **Steg 6:** **gebyrforslag og teametiketter**. Fanen Charges foreslår en kategori for hver gebyrlinje på
  fakturaen ved å sammenligne den med merkede eksempler (175 gebyrnavn fra seks offentlige tariffer fra
  transportører, pluss teamets egne etiketter); gjennomgåere bekrefter eller retter den, og senere analyser
  bruker etikettene. Analysen kan legge til funn om mulige ikke-godkjente tilleggstjenester som bare går til
  gjennomgang, og setter ventetidsfunn til gjennomgang når en linje ligner ventetid under et annet navn.
  Forslag er ikke verifisert og bekrefter aldri et beløp. Se
  [Gebyrforslag og teametiketter (steg 6)](#gebyrforslag-og-teametiketter-steg-6).
- **Steg 7:** **drivstoffkontroll og kostnadsutsikt**. Organisasjoner lagrer drivstofftabellene til sine
  transportører; for et krav med sendingsdato og miles regner analysen tillegget på nytt fra den offentlige
  ukentlige dieselprisen i USA og legger til et funn bare til gjennomgang når fakturaen avviker. Offentlig
  prishistorikk (diesel fra EIA og trailerlastindeks fra BLS, via FRED) ligger i globale tabeller som bare
  kan utvides, og som bare en import kjørt av eieren skriver. En side Outlook viser prognoser for diesel og
  trailerlastindeksen bare for horisonter der en modell slo «ingen endring» i en walk-forward-backtest, med
  80 %-intervaller; backtestet på offentlige data, ingen garanti. Se
  [Drivstoffkontroll og kostnadsutsikt (steg 7)](#drivstoffkontroll-og-kostnadsutsikt-steg-7).
- **Steg 8:** **kontroll av demurrage og detention for sjøcontainere**. En side Ocean D&D der en
  organisasjon legger inn (eller importerer fra CSV) fakturaer for demurrage og detention for containere i
  USA, knytter til en tariff (fire offentlige tariffer fra rederier tilbys som utgangspunkt) og en
  terminalkalender, og registrerer datoer som dokumentasjon. Faste regler kontrollerer regnestykkene på
  fakturaen, regner gebyret på nytt fra tariffen med nøyaktig gebyrfri tid i kalender- og arbeidsdager, og
  markerer mulige forhold etter 46 CFR Part 541 (påkrevd innhold, utstedelse innen 30 dager) og 46 CFR 545.5
  til gjennomgang. Når kontrollen kjøres, opprettes et D&D-krav med bevispakke og et utkast til tvistebrev til
  gjennomgang etter firøyeprinsippet. **Ikke juridisk rådgivning.** Se
  [Kontroll av demurrage og detention for sjøcontainere (steg 8)](#kontroll-av-demurrage-og-detention-for-sjøcontainere-steg-8).
- **Herding (etter steg 8):** ingen nye funksjoner. De eksisterende er tydeligere og vanskeligere å misbruke:
  databasesperrer bak firøyereglene, en ny firøyeregel for teamets gebyretiketter, synlige grunner når en
  analyse feiler eller en masseanalyse stopper, klarere formuleringer, og rettelser i innlogging, invitasjoner og
  klientadressen bak CloudFront. Se [Herding: forbedringer av eksisterende funksjoner](#herding-forbedringer-av-eksisterende-funksjoner).

«Send» merker bare et krav som klart til sending og logger det i revisjonssporet. Ingen e-post sendes, og
ingen penger flyttes. De seedede kravene og bevispakkene er syntetiske og er transkribert fra
Python-CLI-ens utdata på `tests/fixtures/`. Krav som opprettes ved import, har ingen beløp eller pakke før
noen kjører analysen (steg 5). Funn er regelresultater på uttrukne felt og er utkast som trenger
menneskelig gjennomgang. Gebyrforslagene i steg 6 sammenligner navn med merkede eksempler; det finnes ingen
trent modell. Funnene fra drivstoffkontrollen i steg 7 er nye beregninger fra tabeller og data som
mennesker legger inn, og kostnadsutsikten er backtestet på offentlige data, ingen garanti. D&D-funnene i
steg 8 sammenligner fakturadata som mennesker legger inn, med regelverksteksten og den tilknyttede tariffen;
de er utkast til menneskelig gjennomgang og ikke juridisk rådgivning (la en advokat gå gjennom dem). OCR, mottak av
videresendt e-post og ethvert LLM-kall er senere steg.

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
  tabell som bare kan utvides, og i revisjonssporet. Godtatte dokumenter kan ikke endres. Den som lastet
  opp et dokument, eller korrigerte eller la til et av feltene, kan ikke godta det; en annen gjennomgåer
  må gjøre det ([firøyeprinsippet](#firøyeprinsippet-arbeidsdeling)).
- **Opprett krav fra godtatte dokumenter** (på importsiden; du velger avsender eller transportør)
  grupperer de godtatte dokumentene etter lastnummer. Det oppretter et nytt krav med status **Venter på
  analyse** (`AWAITING_ANALYSIS`), eller kobler dokumentene til et eksisterende krav. Et nytt krav har
  ingen beløp og ingen bevispakke før noen analyserer det ([Kravanalyse (steg 5)](#kravanalyse-steg-5)).
  Har kravet allerede en pakke, kobles dokumentene bare til, og pakken endres ikke.

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
Denne regelen gjelder skjermene fra steg 4. Steg 6 la senere til gebyrforslag i kravpanelet: en
sammenligning med nærmeste merkede gebyrnavn, uten trent modell og uten LLM-kall (se
[Gebyrforslag og teametiketter (steg 6)](#gebyrforslag-og-teametiketter-steg-6)). Steg 7 la til siden
Outlook: en liten autoregressiv modell på offentlige prisindekser, tilpasset på nytt fra den lagrede
historikken og vist bare der walk-forward-backtesten slo «ingen endring», med backtesttallene ved siden av
hvert tall (se [Drivstoffkontroll og kostnadsutsikt (steg 7)](#drivstoffkontroll-og-kostnadsutsikt-steg-7)).
Steg 8 la til siden Ocean D&D: faste regler over fakturadataene, regelverksteksten og en tilknyttet tariff,
uten modell og uten LLM-kall (se
[Kontroll av demurrage og detention for sjøcontainere (steg 8)](#kontroll-av-demurrage-og-detention-for-sjøcontainere-steg-8)).

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
`AWAITING_ANALYSIS`, rangeres ikke; siden teller dem («Not ranked: n claims awaiting analysis»). Et
importert krav kommer med i arbeidslisten når det er analysert ([Kravanalyse (steg 5)](#kravanalyse-steg-5)).

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
  id (så skaperen regnes som den som lastet opp en nøkkelopplasting, og kan ikke godta det dokumentet). **Skaperens nåværende rolle** sjekkes ved hver forespørsel: er skaperen deaktivert eller har ikke
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

## Firøyeprinsippet (arbeidsdeling)

Kjøringen `REQ-20261009-four-eyes` gjør at to beslutninger krever en annen person. Serveren håndhever
dette; skjermbildene skjuler bare knappen.

- **Krav.** Den som har laget en revisjon av kravets bevispakke (den gjeldende eller en eldre), kan ikke
  godkjenne eller avvise kravet. En annen bruker med godkjenningsrett må gjøre det. En seedet revisjon 1
  har ingen registrert oppretter og utelukker ingen. Siden steg 5 registreres den som kjører analysen,
  som oppretter av revisjon 1 (se [Kravanalyse (steg 5)](#kravanalyse-steg-5)). Å merke en godkjent revisjon som
  klar til sending er uendret: godkjenneren kan gjøre det, og det kan også en forfatter når en annen har
  godkjent.
- **Importerte dokumenter.** Den som lastet opp et dokument, eller korrigerte eller la til et av feltene,
  kan ikke godta det. En annen gjennomgåer må gjøre det. Å bekrefte et felt, avvise et felt, endre
  dokumenttypen og avvise dokumentet teller ikke, og står åpent for alle med gjennomgangsrett. Et
  dokument som er lastet opp med en API-nøkkel, regnes som lastet opp av den som opprettet nøkkelen.
- **Hva du ser.** På `/approvals` viser raden hvorfor du ikke kan avgjøre, i stedet for Approve/Reject (siden
  herdingskjøringen én tekst per grunn, for eksempel «You created a revision of this claim (by editing,
  analyzing or running the D&D audit). Another approver must approve it.»; se
  [Herding](#firøyeprinsippet-hvem-som-ikke-kan-godkjenne-og-hvorfor)). I gjennomgangsdialogen erstatter «You uploaded or edited this
  document. Another reviewer must accept it.» knappen Accept document (tekstene i appen er på engelsk).
  Prøver du likevel (et gammelt skjermbilde eller en annen fane), svarer API-et 403 `four_eyes_required`
  («A different person must make this decision.»), endrer ingenting og registrerer forsøket i
  revisjonssporet som `authz.four_eyes_denied`. API-kallere får nøyaktig samme svar.
- **Hvor det håndheves.** En kontroll i API-tjenesten, under samme radlås som beslutningen, pluss
  databasetriggere fra migreringen `20261011000000_four_eyes` som avviser en slik beslutningsrad selv om
  kontrollen i tjenesten skulle bli hoppet over.
- **Ikke dekket (akseptert foreløpig).** Et dokument uten grunner til gjennomgang godtas automatisk og har
  dermed ingen menneskelig godkjenner. Endringer av funksjonsflagg gjøres av én person. Den fullstendige
  listen over restrisikoer og standardvalgene står i
  [technical/web-platform-security.md, del 8](technical/web-platform-security.md#8-four-eyes-separation-of-duties)
  (engelsk).

## Kravanalyse (steg 5)

Kjøringen `REQ-20261010-step5-analysis` lukker sløyfen fra import til gjennomgang: import -> gjennomgang ->
opprett krav -> **analyser** -> bevispakkerevisjon 1 -> godkjenning av en annen person. Arkitektur:
[ARCHITECTURE.no.md, kravanalyse](ARCHITECTURE.no.md#nettplattform-kravanalyse-steg-5). Trusselmodell og
restrisikoer: [technical/web-platform-security.md, del 9](technical/web-platform-security.md#9-step-5-claim-analysis)
(engelsk).

**Hva analysen er, og hva den ikke er.** Den kjører de faste reglene fra Python-referansetjenesten
(dupliserte gebyrlinjer, linehaul og drivstoff over ratebekreftelsen, tilleggstjenester som ikke er oppført
som godkjent, fakturasum over summen av linjene, opptjent mot fakturert ventetid) på feltverdiene i kravets
godtatte dokumenter, og skriver et utkast til kravbrev. Funn er **deterministiske regelresultater på
uttrukne felt. De er utkast som trenger menneskelig gjennomgang, ikke verifiserte resultater.** Konfidensen
som vises på et funn, er et fast tall per regel, ikke en målt sannsynlighet, og ingenting her påstår
nøyaktighet. Evalueringsterskelen (steg 4) kjøres på syntetiske testdata og er ikke et mål på nøyaktighet.

### Hvem kan analysere

| Rolle | Analysere ett krav, analysere krav som venter |
| --- | --- |
| OWNER, ADMIN, MANAGER, REVIEWER, ANALYST | ja |
| VIEWER, PLATFORM_DEV, SUPER_ADMIN | nei |

Tillatelsen er `claims:analyze` i `packages/shared/src/rbac.ts`. API-nøkler kan ikke kalle noen av rutene
(403 `forbidden`), uansett scope.

### Analysere ett krav

1. Åpne et krav med status **Venter på analyse** (`AWAITING_ANALYSIS`). Det trenger minst ett koblet
   dokument med status godtatt.
2. Velg **Analyze claim** i fanen **Summary** eller **Evidence**. Seksjonen sier: «Runs fixed rules on
   the accepted document fields. Findings are drafts for human review, not verified results.» og «You will
   be recorded as the author of revision 1, so another approver must approve it.» (tekstene i appen er på
   engelsk).
3. Ved suksess sier varselet «Analysis complete. Revision 1 is ready for review.», og Evidence-fanen viser
   revisjon 1: kilder, funn med sitater tilbake til dokumentlinjene, en tidslinje og utkastet til brev.
   Kravet har nå status **Venter på gjennomgang** (`PENDING_REVIEW`) med beløp, og det vises i `/approvals` og i
   arbeidslisten i Recovery intelligence.

Avvises analysen, viser seksjonen en fast melding: 409 «This claim is no longer awaiting analysis or has no
accepted documents. Reload to continue.», 422 én av tre grunntekster (siden herdingskjøringen; se
[Analyser som feiler](#analyser-som-feiler)), 403 «You do not have permission to analyze claims.», 429 «Too many requests. Try again
later.», alt annet «Analysis failed. Try again.» En avvist analyse endrer ingenting.

En 422 betyr at reglene avviste inndataene (for eksempel et feilformet beløp eller en feilformet dato),
eller at resultatet ikke kan lagres (et negativt beløp, eller mer enn 2 147 483 647 cent). Kravet blir
stående som Venter på analyse. Godtatte dokumenter kan ikke endres, så et slikt krav trenger en ny import
av rettede dokumenter (se restrisikoene). Siden herdingskjøringen viser kravarket en merknad med dato, antall
mislykkede forsøk og grunnen, synlig for alle som kan lese kravet.

### Analysere krav som venter (masseanalyse)

På kravsiden åpner **Analyze awaiting claims** en dialog («Analyzes up to 10 claims awaiting analysis,
oldest first. Claims whose analysis failed before are tried after the others.»). **Analyze** sender én forespørsel med `{ "limit": 10 }` og viser et sammendrag som «Analyzed
8. Skipped 1. Could not analyze 1. 4 still awaiting analysis.», pluss kravnumrene som ikke kunne
analyseres.

- API-et godtar `limit` 1..25 (standard 10) og ser på høyst `min(4 x limit, 100)` kandidater: krav som
  venter på analyse og har minst ett godtatt dokument. Krav uten en tidligere mislykket analyse kommer først,
  deretter de som har feilet før; innenfor hver gruppe eldste først.
- Hvert krav analyseres i sin egen transaksjon, nøyaktig som enkelthandlingen. Et krav som noen andre har
  analysert i mellomtiden, **hoppes over** (skipped); et krav som får 422, **kunne ikke analyseres**
  (could not analyze). Krav som allerede er analysert, forblir analysert selv om et senere feiler.
- **Ratebudsjett.** Begge rutene deler ditt `analysis`-budsjett per bruker (`RATE_LIMIT_ANALYSIS_MAX`,
  standard 30 per 10 minutter). En masseforespørsel bruker én enhet for det første kravet den prøver, og
  én enhet til for hvert nytt krav den prøver, også krav som hoppes over eller ikke kunne analyseres. Når
  budsjettet er brukt opp, stopper kjøringen tidlig og svarer likevel normalt: kravene den ikke prøvde,
  blir stående som Venter på analyse og telles i «still awaiting analysis». Siden herdingskjøringen sier
  dialogen da «Stopped early: your analysis budget is used up for now. Try again later.»; vent til vinduet er
  over og kjør på nytt. Er budsjettet allerede tomt, får
  forespørselen 429.
- Et krav som fortsetter å feile med 422, forblir en kandidat til det importeres på nytt. Siden
  herdingskjøringen prøves det etter kravene som ikke har feilet, så det holder ikke lenger nyere krav tilbake.
  Når det prøves, belastes det fortsatt.

### Firøyeprinsippet etter analyse

Den som kjører analysen (enkeltvis eller som masseanalyse), registreres som forfatter av revisjon 1.
Firøyeprinsippet avviser da den personens godkjenning eller avvisning av kravet, og `/approvals` viser dem
«You created a revision of this claim (by editing, analyzing or running the D&D audit). Another approver must
approve it.» (siden herdingskjøringen). En annen
godkjenner må avgjøre. De som lastet opp eller redigerte kravets dokumenter, regnes **ikke** som forfattere
av kravet; firøyeprinsippet for dokumenter krevde allerede at en annen person godtok dokumentene, unntatt
dokumenter som ble godtatt automatisk ved opplasting.

### API

| Rute | Innhold | Suksess |
| --- | --- | --- |
| `POST /api/v1/claims/:id/analyze` | `{}` (eller uten innhold) | 201: `claim` (status og beløp i cent), `packet` (id, revisjon 1, innholdshash), `analysis` (`rulesVersion: "rules-v1"`, antall funn) |
| `POST /api/v1/claims/analyze-awaiting` | `{ "limit": 1..25 }` (valgfritt, standard 10) | 200: `limit`, `examined`, `analyzed[]`, `skipped[]`, `failed[]` (hver med `reasonCode` siden herdingskjøringen), `remaining`, `stoppedBy` |

Begge rutene krever en innlogget bruker (API-nøkler avvises) og går gjennom de samme Origin- og
CSRF-kontrollene som alle andre ruter som endrer data. Hver vellykket analyse registreres i tenantens
revisjonsspor som `claim.analyzed`; hver masseforespørsel skriver også ett sammendrag
`claim.bulk_analyzed` (bare antall).

### Konfigurasjon (steg 5)

| Variabel | Standard | Betydning |
| --- | --- | --- |
| `RATE_LIMIT_ANALYSIS_MAX` | 30 | analyser per bruker per 10 minutter, delt av enkeltruten og masseruten (1..100000; av bare med `RATE_LIMIT_ENABLED=false`, som produksjon avviser) |

Regelinnstillingene er faste i dette steget: ventetid i trinn på 15 minutter, en toleranse på $0,01 og en
tvistefrist på 90 dager (Python-standardene). De kan ikke konfigureres.

### Ikke dekket (akseptert foreløpig)

Analysen kjører ikke automatisk når krav opprettes; massehandlingen er automatiseringen. Et dokument som
kobles til et krav etter analysen, siteres ikke i revisjon 1. Dokumenter som godtas automatisk ved
opplasting, brukes i analysen på samme måte som gjennomgåtte dokumenter. Den fullstendige listen over
restrisikoer står i
[technical/web-platform-security.md, del 9.5](technical/web-platform-security.md#95-accepted-residuals-step-5)
(engelsk).

## Gebyrforslag og teametiketter (steg 6)

Kjøringen `REQ-20261011-charge-intelligence` legger til forslag til kategori for gebyrlinjer på fakturaer,
et etikettminne for teamet og funn i analysen som bare går til gjennomgang. Arkitektur:
[ARCHITECTURE.no.md, gebyrintelligens](ARCHITECTURE.no.md#nettplattform-gebyrintelligens-steg-6).
Trusselmodell og restrisikoer:
[technical/web-platform-security.md, del 10](technical/web-platform-security.md#10-step-6-charge-intelligence)
(engelsk).

**Hvorfor.** De faste reglene gjenkjenner en gebyrlinje på nøkkelord. På 175 gebyrnavn fra seks offentlige
tariffer fra transportører gjenkjente de 19 av de 159 navnene på tilleggstjenester (accessorials). En linje
reglene ikke gjenkjenner, blir aldri kontrollert mot tilleggstjenestene som er godkjent i fraktavtalen
(rate confirmation).

**Hva et forslag er, og hva det ikke er.** Klassifisereren sammenligner et gebyrnavn med merkede
eksempler (overlapp i tegn og ord, nærmeste eksempel) og foreslår eksemplets kategori når likheten er
minst 0,30. Under det viser den «No suggestion». Eksemplene er 175 gebyrnavn fra seks offentlige tariffer
fra transportører (bare navn, med kildehenvisning) og teamets egne etiketter. Det finnes ingen trent
modell, ingen LLM-kall og ingen nettverkskall. Et forslag er ikke verifisert. Det kan bare legge til et
punkt for menneskelig gjennomgang og bekrefter aldri et beløp. Evalueringen i CI er en regresjonskontroll
på de offentlige tariffnavnene, ikke et mål på nøyaktighet på fakturaer.

**Dataenes opphav.** De 175 navnene er kopiert fra offentlige regeltariffer fra XPO, Estes, Dohrn, Magnum,
Gardewine og States Logistics; kildene og URL-ene står i `packages/shared/src/charge-intel/seed-v1.ts`.
Ingen satser, kunder, forsendelser eller fakturaer lagres. Å bruke disse reelle offentlige navnene er en
eierbeslutning fra 2026-10-10/11. Regelen «kun syntetiske data» i `CLAUDE.md` er ikke endret; en datert
unntaksmerknad der er et åpent spørsmål til eieren (OQ1).

### Hvem kan gjøre hva

| Rolle | Se fanen Charges og etiketter | Bekrefte eller rette en kategori (teametikett) |
| --- | --- | --- |
| OWNER, ADMIN, MANAGER, REVIEWER | ja | ja |
| ANALYST, VIEWER | ja | nei |
| PLATFORM_DEV, SUPER_ADMIN | nei | nei |

Tillatelsen heter `charge_labels:manage`. Lesing krever `claims:read`. API-nøkler kan ikke kalle
gebyrrutene (403). ANALYST kan ikke merke, fordi en etikett endrer senere analyser for hele organisasjonen.

### Fanen Charges

Åpne et krav og velg **Charges**. Fanen viser hver gebyrlinje på fakturaene i kravets godtatte dokumenter,
uansett status på kravet. Den starter med: «Suggestions compare each charge name with labelled examples:
public carrier tariff charge names and your team's labels. They are not verified. A suggestion only adds
items for human review; it never confirms an amount.» Per linje ser du:

- beskrivelsen og beløpet;
- `Rules: <kategori>`: det de faste reglene kaller linjen;
- `Suggested: <kategori> (0.xxx)` med likheten, eller `No suggestion`;
- `Nearest example: '<navn>' (<kilde>)`: den offentlige tariffen eller «Your team's label»;
- `Team label: <kategori>` når teamet har merket denne formuleringen.

Med `charge_labels:manage` får du også **Confirm <kategori>** (når det finnes et forslag som er ulikt
teametiketten) og en liste **Category** med **Save label**. Ved suksess: «Label saved. It applies to future
analyses.» Feil gir en fast tekst: «You do not have permission to label charges.» (403), «This organization
has reached the maximum number of charge labels.» (409), «Too many requests. Try again later.» (429), ellers
«Could not save the label. Try again.» Kontrollene er deaktivert for en beskrivelse serveren ville avvist
(over 200 tegn, kontrolltegn eller tegn for skriveretning, eller ingenting igjen etter normalisering).
Tekstene i appen er på engelsk.

**Slik virker en etikett.** En etikett lagres per organisasjon for den normaliserte formuleringen (små
bokstaver, tegnsetting fjernet): én etikett per formulering, og den siste gjelder. Den brukes straks av
fanen Charges og av alle senere analyser, for akkurat den formuleringen og, gjennom likhet, for lignende
formuleringer. Pakker som allerede er laget, endres ikke. En etikett endrer aldri det de faste reglene
bestemmer: den betyr bare noe for linjer reglene kaller `other`. En organisasjon kan ha høyst 2 000
etiketter. Hver endring registreres i revisjonssporet (`charge_label.set`, `charge_label.deleted`) med
etikettens id, kategorien og en SHA-256 av formuleringen, aldri selve formuleringen.

### Hva som endres i analysen

Bare for fakturalinjer som de faste reglene kaller `other`:

- **Mulig ikke-godkjent tilleggstjeneste.** Hvis det nærmeste eksemplet er en tilleggstjeneste, kravet har
  en fraktavtale, linjen ikke står der som godkjent, og beløpet ikke er det avtalte beløpet for linehaul
  eller fuel, legger analysen til funnet `LRN-ACCESSORIAL-REVIEW` («Possible unauthorized accessorial
  (suggestion)»). Det trenger alltid menneskelig gjennomgang, har en fast konfidens på 0,5 (ikke en
  sannsynlighet), teller bare i summen som venter på gjennomgang, og kommer aldri med i utkastet til brev.
  Teksten nevner det nærmeste eksemplet og slutter med «Suggestion only - verify before disputing.»
- **Ventetid under et annet navn.** Hvis det nærmeste eksemplet er ventetid (detention), lager analysen
  ikke noe nytt beløp. I stedet settes ventetidsfunnene «ufakturert» og «underfakturert» (`DET-UNBILLED`,
  `DET-UNDERBILLED`) til å trenge menneskelig gjennomgang, med trinnet «Possible detention billed under
  another name: ... Confirm before claiming.» Beløpet flyttes fra innkrevbar sum til sum som venter på
  gjennomgang, og ut av utkastet til brev, til en gjennomgåer bekrefter.

Alt annet er nøyaktig som i steg 5. Svaret fra analysen får `classifierVersion`, `learnedFindingsCount` og
`reviewFlagsCount`; `claim.analyzed` registrerer også hvilke teametiketter som påvirket resultatet
(`learnedLabelIds`).

### API

| Rute | Tillatelse | Svar ved suksess |
| --- | --- | --- |
| `GET /api/v1/claims/:id/charge-lines` | `claims:read` | 200: linjer med regelkategori, forslag og teametikett |
| `GET /api/v1/charge-labels?page=1&pageSize=25` | `claims:read` | 200: organisasjonens etiketter (`pageSize` 1..100) |
| `PUT /api/v1/charge-labels` | `charge_labels:manage` | 200: `{ "label": ..., "outcome": "created" \| "changed" \| "unchanged" }`; kropp `{ "description": "...", "category": "accessorial" }` |
| `DELETE /api/v1/charge-labels/:id` | `charge_labels:manage` | 204 |

Alle fire bruker ratebegrensningen `intelligence` per bruker (`RATE_LIMIT_INTELLIGENCE_MAX`, standard 120).
PUT og DELETE går gjennom de samme Origin- og CSRF-kontrollene som alle andre ruter som endrer noe. 409
`label_limit_reached` når organisasjonen allerede har 2 000 etiketter (å endre en eksisterende etikett er
alltid tillatt).

### Slå det av

Plattformansatte kan slå av flagget **`intelligence.charge_suggestions`** («Charge-line suggestions and team
labels», på som standard) i fanen Flags på utviklerdashbordet. Av: analysen er nøyaktig som i steg 5, de
fire rutene svarer 404, og fanen Charges forsvinner. Etikettene blir liggende lagret og brukes igjen når
flagget slås på.

### Evaluering (regresjonskontroll på frøsettet)

```bash
npm run build
npm run eval:charges -- --min-top1 173 --min-accessorial-top1 158 --min-accessorial-recognised 145 --max-wrong-suggested 1
```

Den klassifiserer hvert av de 175 offentlige tariffnavnene med bare navnene fra de fem andre
transportørene (ingen database, ikke noe nettverk, ingenting registreres). I dag: nærmeste eksempel riktig
for 173 av 175; ved terskelen 0,30 er 161 foreslått (160 riktige, 1 feil) og 14 uten forslag; navn på
tilleggstjenester gjenkjent 145 av 159, mot 19 av 159 for nøkkelordreglene. CI kjører akkurat denne
kommandoen; grensene er lik dagens tall, så en endring som senker dem, får bygget til å feile. `--json`
skriver hele rapporten. Disse tallene gjelder tariffnavn, ikke fakturaer: de er en regresjonskontroll på
dette frøsettet, ikke et mål på nøyaktighet.

### Ventetid etter tariffvilkår (ikke i bruk ennå)

`computeTariffDetention` i `@fr/shared` regner ut ventetid slik tariffene til transportørene beskriver den:
fritid, fakturering i trinn rundet opp («or fraction thereof») eller ned, en sats per trinn, og et minste-
og høyestebeløp. Eksempel (vilkårene i XPO-tariffen: 60 minutter fritid, $72,25 per påbegynte 15 minutter,
minstebeløp $95,50): 08:00 til 09:20 er 2 trinn, $144,50. **Analysen bruker den ikke ennå**: å lese disse
vilkårene fra fraktavtaler er et senere steg, så ventetid regnes fortsatt ut med reglene fra steg 5.

### Ikke dekket (akseptert foreløpig)

Generiske formuleringer for linehaul, som «Freight charges», ligger nær navn på tilleggstjenester i
frøsettet til teamet merker dem; bare kontrollen mot avtalte beløp og menneskelig gjennomgang stopper et
feil funn. Etiketter gjelder per organisasjon, ikke per transportør eller kunde. Frøsettet har få navn for
linehaul (1) og fuel (3). En gjennomgåer som kan merke, kan ved å merke en linje som ventetid flytte
ventetidsfunn i senere analyser til gjennomgang (det registreres i revisjonssporet, kan spores, og lager
aldri penger). Den fullstendige listen står i
[technical/web-platform-security.md, del 10.5](technical/web-platform-security.md#105-accepted-residuals-step-6)
(engelsk).

## Drivstoffkontroll og kostnadsutsikt (steg 7)

Kjøringen `REQ-20261011-fuel-outlook` legger til en kontroll av drivstofftillegg i analysen, et lager for
offentlige prisdata og en kostnadsutsikt. Arkitektur:
[ARCHITECTURE.no.md, steg 7](ARCHITECTURE.no.md#nettplattform-drivstoffkontroll-offentlige-prisdata-og-kostnadsutsikt-steg-7).
Trusselmodell og restrisiko:
[technical/web-platform-security.md, del 11](technical/web-platform-security.md#11-step-7-fuel-check-public-price-data-and-cost-outlook)
(engelsk).

**Hva det er, og hva det ikke er.**

- **Drivstoffkontroll.** Organisasjonen lagrer drivstofftabellene (FSC-tabellene) til sine transportører.
  For et krav legger en gjennomgåer inn sendingsdato, miles og tabell. Analysen tar så den offentlige
  ukentlige gjennomsnittsprisen for diesel i USA som gjelder for sendingsdatoen, regner tillegget nøyaktig på
  nytt og sammenligner med de fakturerte drivstofflinjene. En differanse blir et funn **til gjennomgang**
  («Fuel surcharge differs from the fuel table (review)») som viser prisuken, tabellraden og hvert steg i
  regnestykket, og som sier fra når fakturaen stemmer med prisen for en nabouke. Det bekrefter aldri et
  beløp og vises aldri i utkastet til kravbrev.
- **Kostnadsutsikt.** En side med diesel om 1, 4, 8 og 13 uker og produsentprisindeksen for langdistanse
  trailerlast om 1 måned, hver med et 80 %-intervall. En modellprognose vises bare der den slo «ingen
  endring» i en walk-forward-backtest på den offentlige historikken; ellers viser siden «ingen endring» med
  et intervall. Den er **backtestet på offentlige data 2011-2026 (diesel) og 2009-2026
  (trailerlastindeksen); ingen garanti.** Den gir prognoser for nasjonale indekser, ikke for dine
  rutepriser: på rater per rute ble «ingen endring» ikke slått i våre tester, så det finnes ingen
  ruteprognose.

**Dataenes opphav.** Prishistorikken kommer fra FRED (Federal Reserve Bank of St. Louis): ukentlig diesel
fra U.S. Energy Information Administration (`GASDESW`) og PPI `PCU4841214841212` fra U.S. Bureau of Labor
Statistics, begge merket «Public Domain: Citation Requested» på FRED. Kopien som følger med, ligger i
`api/data/public-prices/` med sha256-verdier og kildehenvisninger. Den inneholder ingen kunde-,
transportør- eller sendingsdata. Å legge inn disse reelle offentlige dataene er en eierbeslutning fra
2026-10-11; regelen «kun syntetiske data» i `CLAUDE.md` er ikke endret, og et datert unntak der er et åpent
spørsmål for eieren (OQ1).

### Hvem kan gjøre hva

| Rolle | Se drivstofftabeller, fanen Fuel og Outlook | Legge til, endre, arkivere drivstofftabeller | Legge inn eller fjerne drivstoffdata på et krav |
| --- | --- | --- | --- |
| OWNER, ADMIN | ja | ja | ja |
| MANAGER, REVIEWER, ANALYST | ja | nei | ja |
| VIEWER | ja | nei | nei |
| PLATFORM_DEV, SUPER_ADMIN | nei | nei | nei |

Tillatelsene er de eksisterende: `settings:manage` for tabeller, `claims:analyze` for drivstoffdata,
`claims:read` for lesing. API-nøkler kan ikke kalle noen av disse rutene (403).

### Legge til en drivstofftabell

Åpne **Fuel tables** (`/settings/fuel-tables`). Siden starter med «Fuel tables are your carriers' surcharge
schedules. The fuel check applies them to the public weekly U.S. diesel price.» Med `settings:manage` velger
du **Add fuel table** og så:

| Type | Fyll inn | Sats |
| --- | --- | --- |
| Step, above base | basispris, trinnstørrelse, sats per trinn | ett trinn for hver trinnstørrelse eller del av den over basis (den klassiske «1 cent per mile for hver 6 cent over $1.20») |
| Step, from base | basispris, trinnstørrelse, sats per trinn | første trinn starter ved basisprisen (tabeller som «fra $1.12, +1 cent per 5 cent») |
| MPG | basispris, miles per gallon, 2-4 desimaler | (pris - basis) / mpg, avrundet halv opp; bare per mile |
| Rows | ett par `atLeast,rate` per linje (opptil 200) | satsen i den siste raden der prisen er lik eller under dieselprisen |

Enheten er **per mile** eller **prosent** (av avtalt linehaul fra fraktavtalen, ellers av fakturaens
linehaul-linjer). **Ukeregel:** som standard gjelder mandagsprisen onsdag til tirsdag (GSA-regelen); en tabell
kan forskyve dette med 0 til 6 dager (0 = mandag til søndag). Navn må være unike i organisasjonen. En
organisasjon kan opprette høyst 50 tabeller, arkiverte medregnet. En tabell i bruk arkiveres, den slettes
ikke; en endring øker versjonen, og analysen lagrer versjonen og en sha256 av parameterne den brukte.

### Legge inn drivstoffdata på et krav

Åpne et krav som **venter på analyse** og velg **Fuel**. Fyll inn **Ship date**, **Miles** (én desimal, 0,1
til 10 000; trengs ikke for en prosenttabell) og **Fuel table**, og velg **Save fuel inputs** («Fuel inputs
saved. They apply when the claim is analysed.»). **Clear fuel inputs** fjerner dem. Etter analysen er
dataene låst («Fuel inputs can only change before the claim is analysed.»). Fanen viser kontrollen når som
helst som en forhåndsvisning: status, publiseringsdato og pris, forventet, fakturert, differanse og
beregningen. Den endrer aldri en lagret pakke. Kjør deretter **Analyze** som vanlig.

Hva statusene betyr:

| Status | Betydning |
| --- | --- |
| No fuel inputs yet | ingenting lagt inn; analysen er nøyaktig som uten steg 7 |
| The selected fuel table is archived | velg en annen tabell |
| The rate confirmation states a fixed fuel surcharge; that amount is checked instead | den eksisterende regelen for fast beløp gjelder; ingen FSC-kontroll |
| No fuel surcharge line on the invoice | ingenting å sammenligne |
| No public diesel price is available for this ship date | ingen publisering dekker datoen (for eksempel nyere enn de importerte dataene) |
| Miles are required for a per-mile fuel table | legg inn miles |
| No linehaul amount to apply a percent table to | ingen avtalt linehaul og ingen linehaul-linje |
| The billed fuel surcharge matches the fuel table | innenfor analysens toleranse |
| The billed fuel surcharge differs from the fuel table. Review the finding. | ett funn `FSC-INDEX-MISMATCH` bare til gjennomgang |

**Eksempel** (en tabell med basis $1.20, trinn $0.06 og $0.01 per mile per trinn; sendingsdato 2026-10-07,
så publiseringen 2026-10-05 på $6.199 gjelder): 84 trinn, $0.84 per mile, forventet $420.00 for 500.0 miles.
Fakturert $435.00 gir et funn til gjennomgang på $15.00, som opplyser at $435.00 er lik tabellresultatet for
prisen 2026-09-28 ($6.382), én uke før gjeldende publisering. Kontroller tabellen, milene og sendingsdatoen
før noe bestrides.

### Siden Outlook

Åpne **Outlook** (`/outlook`). Den starter med: 'Forecasts are shown only at horizons where a model beat "no
change" in a walk-forward backtest on public data; other horizons show "no change" with a range. Not a
guarantee.' For hver serie vises siste verdi, «Backtested on public data <fra>-<til>; not a guarantee.», én
rad per horisont med måldato, metode («Trend model», «Average of trend model and no change» eller «No
change»), grunn, punkt, intervall, «80% range. In the backtest, <n>% of outcomes fell inside ranges built
this way.» og backtestens forholdstall og DM-statistikk, samt kildelinjen med filens sha256. Hvis du kan se
drivstofftabeller, legger listen **Fuel table** til din tilleggssats for hver dieselhorisont.

På den medfølgende historikken (siste diesel 2026-10-05, siste indeks 2026-08-01) viser siden:

| Horisont | Metode | Punkt | 80 %-intervall | Backtest: MASE mot ingen endring, DM | Intervalldekning i backtesten |
| --- | --- | --- | --- | --- | --- |
| Diesel 1 uke | Trend model | 6.124 | 5.903 - 6.392 | 0.85, 5.64 | 78 % |
| Diesel 4 uker | Average of trend model and no change | 6.136 | 5.301 - 7.175 | 0.96, 2.75 | 79 % |
| Diesel 8 uker | No change | 6.199 | 4.777 - 8.189 | bevisst | 78 % |
| Diesel 13 uker | No change | 6.199 | 4.384 - 9.395 | bevisst | 77 % |
| Trailerlastindeks 1 måned | Trend model | 218.0 | 210.9 - 225.9 | 0.87, 2.33 | 74 % |

En modell brukes bare hvis feilen over minst 100 walk-forward-startpunkter er lavere enn for «ingen endring»
(MASE < 1) og forskjellen er statistisk signifikant (Diebold-Mariano >= 1.96). Hvis en senere import gjør at
en modell ikke lenger består, bytter horisonten automatisk til «ingen endring». Vises ikke:
trailerlastindeksen om 3 måneder (fortrinnet er ikke signifikant, og intervalldekningen lå for langt fra
80 %), rater for dyphavsfrakt og lastebilrater per rute (ingen pålitelig fordel over «ingen endring» i våre
backtester).

### Importere eller oppdatere prisdata (operatører)

Prisene er globale (felles for alle organisasjoner) og kan bare skrives med **eierforbindelsen til
databasen**; API-et i drift kan bare lese dem. Seed importerer allerede den medfølgende historikken.

```bash
npm run build
export MIGRATE_DATABASE_URL=...           # owner connection; never printed
npm run prices:import -- --list           # active import per series: id, sha256, rows, dates, source kind
npm run prices:import -- --bundled        # the files in api/data/public-prices (sha256 checked)
npm run prices:import -- --series diesel_us --fetch      # download the pinned FRED CSV (CLI only)
npm run prices:import -- --series ppi_tl --file ./PCU4841214841212.csv \
  --source-url "https://fred.stlouisfed.org/graph/fredgraph.csv?id=PCU4841214841212" --retrieved-at 2026-10-11
```

- En import er alt eller ingenting og alltid en full historikk. Den nyeste importen blir aktiv; eldre
  beholdes og kan aldri endres eller slettes.
- Samme fil igjen: `unchanged`. En fil som dekker mindre historikk enn den aktive: avvist
  (`would_remove_history`). En fil som endrer verdier som allerede er importert (for eksempel reviderte
  foreløpige indeksmåneder): avvist med antallet endrede verdier (`revisions_refused`); legg til
  `--accept-revisions` for å importere den med vilje.
- Avslutningskoder: 0 importert eller uendret, 2 bruk, validering eller avvisning (ingenting skrevet), 3 feil
  i database eller nettverk (ingenting skrevet). Hver import registreres i plattformens revisjonsspor
  (`price_data.imported`).
- `--fetch` kontakter bare den faste FRED-adressen (ingen omdirigeringer, tidsavbrudd 20 s, tak 1 MiB).
  API-et selv laster aldri ned noe.

### Backtest-terskel

```bash
npm run build
npm run eval:outlook -- --min-coverage 0.70 --max-coverage 0.90 --require-model diesel_us:1,diesel_us:4,ppi_tl:1
```

Den kjører backtesten på nytt på de medfølgende filene (ingen database, intet nettverk, ingenting skrives;
`--json` skriver hele rapporten). CI kjører nøyaktig denne kommandoen; den feiler hvis en intervalldekning
havner utenfor 70-90 %, eller hvis en av de tre modellhorisontene ikke lenger slår «ingen endring». Den er en
regresjonskontroll av prognose- og intervallreglene, ingen garanti om framtidige priser.

### API

| Rute | Tillatelse | Suksess |
| --- | --- | --- |
| `GET /api/v1/fuel-tables?includeArchived=false` | `claims:read` | 200: `{ "items": [...] }` |
| `POST /api/v1/fuel-tables` | `settings:manage` | 201: tabellen. Body f.eks. `{ "name": "Carrier A 2026", "kind": "step", "unit": "per_mile", "priceSeries": "diesel_us", "params": { "basePrice": "1.20", "stepSize": "0.06", "ratePerStep": "0.01", "bracket": "above_base" } }` |
| `PUT /api/v1/fuel-tables/:id` | `settings:manage` | 200: samme body pluss `"expectedVersion"` |
| `DELETE /api/v1/fuel-tables/:id` | `settings:manage` | 204 (arkiverer) |
| `GET /api/v1/claims/:id/fuel-check` | `claims:read` | 200: drivstoffdata, tabell og beregnet resultat |
| `PUT /api/v1/claims/:id/fuel-inputs` | `claims:analyze` | 200: `{ "inputs": ..., "outcome": "created" \| "changed" \| "unchanged" }`; body `{ "shipDate": "2026-10-07", "miles": "500.0", "fscTableId": "<uuid>" }` |
| `DELETE /api/v1/claims/:id/fuel-inputs` | `claims:analyze` | 204 |
| `GET /api/v1/outlook?fscTableId=<uuid>` | `claims:read` | 200: utsikten (`fscTableId` valgfri) |

Alle bruker ratebegrensningen `intelligence` per bruker. Nye feil: 409 `fuel_table_limit_reached`, 422
`fuel_table_unavailable`, 422 `miles_required`; 503 `service_unavailable` når prisdataene ikke kan leses.
Analysesvaret får `fuelCheckStatus` og `fuelFindingsCount`.

### Slå det av, og konfigurasjon

Plattformpersonell kan slå av **`intelligence.fuel_check`** («Fuel tables and fuel-surcharge check») og
**`intelligence.cost_outlook`** («Cost outlook from public price data») i fanen Flags på utviklerdashbordet
(begge er på som standard). Med drivstoffkontrollen av er analysen nøyaktig som i steg 6, og
drivstoffrutene, fanen og siden forsvinner; tabeller og drivstoffdata blir liggende. `PRICE_CACHE_TTL_MS`
(standard 60000) bestemmer hvor lenge API-et husker hvilken import som er aktiv.

### Ikke dekket (akseptert foreløpig)

Bare den nasjonale gjennomsnittsprisen for diesel i USA (ingen regionale priser); miles og sendingsdato
skrives inn, de leses ikke fra dokumenter; pakker som ble analysert før drivstoffdata ble lagt inn,
kontrolleres ikke på nytt; bare USD. Modellene i utsikten ble valgt på den samme offentlige historikken som
CI-terskelen kjører på nytt. Hele listen står i
[technical/web-platform-security.md, del 11.5](technical/web-platform-security.md#115-accepted-residuals-step-7)
(engelsk).

## Kontroll av demurrage og detention for sjøcontainere (steg 8)

Kjøringen `REQ-20261011-ocean-dd` legger til en kontroll av fakturaer for demurrage og detention (D&D) for
sjøcontainere i USA. Arkitektur:
[ARCHITECTURE.no.md, steg 8](ARCHITECTURE.no.md#nettplattform-kontroll-av-demurrage-og-detention-for-sjøcontainere-steg-8).
Trusselmodell og restrisiko:
[technical/web-platform-security.md, del 12](technical/web-platform-security.md#12-step-8-ocean-demurrage-and-detention-audit)
(engelsk).

> **Ikke juridisk rådgivning.** Kontrollen sammenligner fakturadataene du legger inn, med teksten i
> 46 CFR Part 541, 46 CFR 545.5 og tariffen du knytter til. Funnene er utkast til menneskelig gjennomgang,
> ikke en juridisk vurdering. Om en faktura faktisk ikke skal betales, eller om et gebyr er urimelig, er et
> juridisk spørsmål: la en advokat gå gjennom funnene før du bygger på dem eller sender noe.

**Hva den kontrollerer.** Siden 28. mai 2024 lister Federal Maritime Commissions regel 46 CFR Part 541
informasjonen en faktura for demurrage eller detention i USA må inneholde (541.6), sier at manglende
informasjon fjerner betalingsplikten (541.5), krever fakturaen innen 30 kalenderdager fra datoen gebyret sist
påløp (541.7; for en NVOCC 30 dager fra fakturaen den selv mottok) og fastsetter frister for tvister (541.8).
46 CFR 545.5 sier blant annet at detention som kreves når en tom container ikke kan leveres tilbake,
sannsynligvis er urimelig. Regelverksteksten i produktet er kontrollert mot eCFR (tittel 46 oppdatert per
2026-10-07) og sitert ordrett. 46 CFR 541.4 (hvem som kan faktureres) kontrolleres **ikke**: D.C. Circuit
opphevet den 2025-09-23, og FMC fjernet den med virkning fra 2025-12-29.

| Regel | Hva den ser etter | Type funn |
| --- | --- | --- |
| `DD-TOTAL-MISMATCH` | totalbeløpet er høyere enn summen av gebyrlinjene | bekreftet regning |
| `DD-PERIOD-ARITH` | en gebyrlinje er høyere enn dager x oppgitt sats | bekreftet regning |
| `DD-TARIFF-OVERCHARGE` | en container er fakturert for mer enn tariffen du knyttet til gir | bekreftet regning (mot din tariff) |
| `DD-545-RETURN-REFUSED` | detention fakturert for dager der du har registrert at retur av tom container ble avvist | til gjennomgang (46 CFR 545.5) |
| `DD-545-AVAILABILITY` | gebyrfri tid for importdemurrage startet før datoen du har registrert at lasten var tilgjengelig | til gjennomgang (46 CFR 545.5) |
| `DD-541-7-LATE` | fakturaen ble utstedt mer enn 30 kalenderdager etter at gebyret sist påløp | til gjennomgang («may not be payable under 46 CFR 541.7 - review») |
| `DD-541-6-CONTENT` | påkrevd informasjon mangler eller stemmer ikke (for eksempel gebyrfri tid som avviker fra tariffen, eller en tvistefrist kortere enn 30 dager) | til gjennomgang: når noe mangler, «... 46 CFR 541.5 ... - review whether this applies»; når opplysninger bare er unøyaktige, «Required invoice information inaccurate (46 CFR 541.6)» med henvisning til 541.6(b) eller (d) |

«Bekreftet» betyr at regnestykket er sikkert for dataene du har lagt inn; de beløpene utgjør den bekreftede
summen. Alt som bygger på regelverket, er «til gjennomgang» og teller bare i summen til gjennomgang. Hvert
beløp telles én gang: reglene tar beløp i rekkefølgen i tabellen, og en senere regel får bare det tidligere
regler har latt ligge, så funnene blir aldri til sammen mer enn fakturaen. Hvert funn viser alle stegene i
utregningen og viser til fakturafeltet, tariffen eller regelverksteksten det bygger på.

**Gebyrfri tid og tariffer.** En tariff angir de gebyrfrie dagene, om de er kalender- eller arbeidsdager, om
startdagen teller som dag 1 eller den gebyrfrie tiden starter dagen etter (for eksempel Hapag-Lloyds «day of
interchange plus 4 working days»), om gebyrer løper per kalender- eller arbeidsdag, hvilke ukedager som er
arbeidsdager, og trinnvise dagsatser per containerstørrelse. En kalender lister terminalens stengte dager
(helligdager: ikke gebyrfrie ved arbeidsdagsbasis, men fakturert ved kalenderbasis) og shutout-dager
(uplanlagt stengt: aldri gebyrfrie og aldri fakturert). Det finnes ingen innebygd helligdagsliste.

Fire offentlige tariffer tilbys som **utgangspunkt** («Start from a public tariff»). De har satsene slik de var
publisert 2026-10-11; servicekontrakten din eller en nyere tariff kan avvike, så kontroller før bruk:

| Mal | Gebyrfri tid og satser (tørrcontainere) | Kilde og verifisering |
| --- | --- | --- |
| Maersk US import detention (2026) | 4 arbeidsdager (man.-lør.); $210 for gebyrdag 1-4, $260 for 5-8, deretter $290 | Maersks tariff gjeldende fra 01 Jan 2026; lest gjennom en søkemotors utdrag av PDF-en (direkte nedlasting feilet) |
| MSC US import demurrage (alle havner unntatt Baltimore) | 4 arbeidsdager; 20DV $65 i 5 dager, deretter $120; 40DV/40HC/45HC $80 i 5 dager, deretter $150 | MSC-PDF, sha256 registrert |
| Hapag-Lloyd US import detention, merchant haulage (unntatt California) | utleveringsdagen pluss 4 arbeidsdager; $200 x 3 dager, $250 x 3 dager, deretter $300 | Hapag-Lloyd-PDF gjeldende fra 1. okt. 2025, sha256 registrert |
| CMA CGM US import demurrage, standard US ports (40 fot tørr) | 4 arbeidsdager; $295 x 5 dager, $355 x 5 dager, deretter $395 | **bare sekundærkilde** (en bransjepublikasjon som siterer CMA CGM); kontroller mot CMA CGMs tariff |

Hver mal viser dokumentet, hentedatoen, verifiseringsnivået og forutsetningene som er gjort der tariffen ikke
sier noe.

**Regneeksempler** (låst i testene; fakturaene rundt dem er syntetiske): Maersk 40DV ut mandag 2026-03-02 og
tilbake 2026-03-20: gebyrfri tid slutter 2026-03-05, 15 gebyrdager, **$3,910.00**; med terminalen stengt på
Memorial Day (2026-05-22 til 2026-06-02): **$1,360.00**. Hapag-Lloyd 40HC utlevert torsdag 2026-07-02, stengt
2026-07-03, shutout 2026-07-14, levert tilbake 2026-07-20: **$2,550.00** (**$2,850.00** uten shutout). MSC 40DV
tilgjengelig mandag 2026-09-07 (Labor Day, stengt) og ut 2026-09-22: **$1,300.00** (20DV **$1,045.00**); regnet
fra 2026-09-04 i stedet blir det **$1,450.00**, og differansen på $150.00 er det tilgjengelighetsregelen melder
til gjennomgang. CMA CGM 40DV 2026-02-02 til 2026-02-20: **$5,225.00** (satser fra sekundærkilde).

### Hvem kan gjøre hva

| Rolle | Se D&D-fakturaer, tariffer og kalendere | Legge inn, endre, slette fakturautkast; importere CSV | Opprette og endre tariffer og kalendere | Kjøre kontrollen |
| --- | --- | --- | --- | --- |
| OWNER, ADMIN, MANAGER, REVIEWER | ja | ja | ja | ja |
| ANALYST | ja | ja | nei | ja |
| VIEWER | ja | nei | nei | nei |
| PLATFORM_DEV, SUPER_ADMIN | nei | nei | nei | nei |

Tillatelsene er `dd_invoices:manage`, `dd_tariffs:manage` (nye), `claims:analyze` for kontrollen og
`claims:read` for lesing. API-nøkler kan ikke kalle noen D&D-rute (403).

### Legge inn en faktura

Åpne **Ocean D&D** (`/ocean`) og velg **New invoice**. Legg inn fakturahodet (nummer, fakturerende part og
typen: rederi, terminaloperatør eller NVOCC; fakturert part; import eller eksport; faktura- og forfallsdato og,
for en NVOCC, datoen på fakturaen den mottok; B/L-numre; lossehavn; ansvarsgrunnlag; totalbeløp; tariffregel;
kontakt, lenke og frister for tvister; de to erklæringene), deretter hver container (nummer, type som `40DV`,
demurrage eller detention, oppgitte gebyrfrie dager, start og slutt på gebyrfri tid, tilgjengelighetsdato
eller tidligste returdato) med gebyrperiodene (fra, til, sats, beløp) og **dokumentasjonen** din: klokkestart
og -stopp, datoen lasten var tilgjengelig, og datoene retur av tom container ble avvist. Knytt til en tariff
og en kalender hvis du har dem. **Forhåndsvisningen** under skjemaet kjører de samme kontrollene i nettleseren
mens du skriver. **Save** lagrer et utkast; utkast kan endres eller slettes.

Grenser: 50 containere per faktura, 20 perioder per container, høyst 2 000 fakturaer per organisasjon
(utkast og kontrollerte), 200 tariffer og 200 kalendere. Datoene må ligge mellom 2000-01-01 og 2099-12-31.

### Importere fakturaer fra CSV

**Import CSV** leser en UTF-8-fil i nettleseren (høyst 4 MB på disk, 1 000 000 tegn, 2 000 rader og 50
fakturaer); ingenting lastes opp før du importerer. Rad 1 må være nøyaktig disse 35 kolonnene:

```
invoice_number, billing_party, billing_party_type, billed_party, direction, invoice_date, due_date,
upstream_invoice_date, bl_numbers, port_of_discharge, liability_basis, total_due, rule_reference,
dispute_contact, dispute_digital_means, dispute_request_days, dispute_resolution_days, certifies_fmc_rules,
certifies_performance, container_number, size_type, charge_type, free_days, free_time_start, free_time_end,
availability_date, earliest_return_date, period_from, period_to, rate, amount, clock_start, clock_stop,
cargo_available_date, return_refused_dates
```

Rader med samme fakturerende part og fakturanummer blir én faktura; rader med samme containernummer og
gebyrtype blir én container; hver rad med en periode legger til én gebyrperiode. `bl_numbers` og
`return_refused_dates` er lister skilt med `;`; beløp kan ha `$` foran og komma som tusenskille; datoer er
`YYYY-MM-DD`; ja/nei-kolonner godtar `yes`, `no`, `true`, `false`, `y`, `n`, `1`, `0`. Forhåndsvisningen viser
alle fakturaer og alle radfeil; en faktura med feil blir utelatt («Rows with errors were not imported.»).
Importen oppretter så de andre fakturaene som utkast, én og én, og viser resultatet for hver.

### Kjøre kontrollen

Åpne et utkast og velg **Run audit** (krever `claims:analyze`). «Creates a claim with revision 1 for review. You
will be recorded as its author, so another approver must approve it.» Kontrollen:

- oppretter et krav merket **D&D** i kravlisten, med bevispakkerevisjon 1 til gjennomgang;
- lagrer et fryst øyeblikksbilde av fakturaen, tariffen og kalenderen med sha256-verdiene deres, så senere
  endringer i tariffen eller kalenderen aldri endrer det; fakturaen kan ikke lenger endres eller slettes;
- legger ved regelverksteksten den viser til, en tidslinje (fakturadato, siste gebyrdato, 30-dagersfristen for
  utstedelse) og et **utkast til tvistebrev** som begynner med «DRAFT - FOR HUMAN REVIEW. NOT SENT. NOT LEGAL
  ADVICE.», lister funnene og minner deg om 30-dagersfristen for krav i 46 CFR 541.8(a). Ingenting sendes på
  e-post.

Kravet går deretter gjennom vanlig godkjenning med firøyeprinsippet: den som kjørte kontrollen, og også den som
på noe tidspunkt opprettet eller endret dataene i D&D-fakturaen (hentet fra revisjonssporet), kan ikke
godkjenne eller avvise det. Godkjenning med funn til
gjennomgang krever fortsatt at de bekreftes.

### API

| Rute | Tillatelse | Svar ved suksess |
| --- | --- | --- |
| `GET /api/v1/dd/tariffs`, `GET /api/v1/dd/calendars` (`?page&pageSize`, pageSize opptil 100) | `claims:read` | 200 liste |
| `POST /api/v1/dd/tariffs`, `PUT /api/v1/dd/tariffs/:id` (`{ "version", "data" }`) | `dd_tariffs:manage` | 201 / 200 |
| `POST /api/v1/dd/calendars`, `PUT /api/v1/dd/calendars/:id` | `dd_tariffs:manage` | 201 / 200 |
| `GET /api/v1/dd/invoices?page&pageSize&status` (pageSize opptil 50) | `claims:read` | 200 liste |
| `POST /api/v1/dd/invoices`, `PUT /api/v1/dd/invoices/:id` (`{ "version", "invoice" }`; kropp opptil 256 KiB) | `dd_invoices:manage` | 201 / 200, med forhåndsvisning |
| `GET /api/v1/dd/invoices/:id` | `claims:read` | 200, med forhåndsvisning |
| `DELETE /api/v1/dd/invoices/:id` | `dd_invoices:manage` | 204 (bare utkast) |
| `POST /api/v1/dd/invoices/:id/audit` | `claims:analyze` | 201: det nye kravet, pakken og antallene |

Alle rutene bruker ratebegrensningen `intelligence` per bruker, unntatt kontrollen, som bruker `analysis`. Ny
feil: 409 `dd_limit_reached` når en organisasjon når et tak. Andre: 400 for en tariff eller kalender som ikke er
din, 409 for duplikat navn eller fakturanummer, en utdatert versjon eller en kontrollert faktura, 413 for en
for stor kropp, 422 når beløpene er for store til å lagres. `POST /api/v1/claims/:id/analyze` på et D&D-krav gir
409: D&D-krav analyseres aldri av fraktreglene.

### Slå det av

Plattformansatte kan slå av **`intelligence.ocean_dd`** («Ocean demurrage and detention invoice audit») i fanen
Flags på utviklerdashbordet (på som standard). Av: siden og rutene forsvinner (404); eksisterende D&D-krav blir
værende og kan fortsatt godkjennes, avvises, redigeres og merkes klar til sending. Ingen nye miljøvariabler.

### Ikke dekket (akseptert foreløpig)

Ingen lesing av D&D-fakturaer fra PDF (legg inn eller importer som CSV); ingen import av sporingsdata (klokke-,
tilgjengelighets- og returdatoer skrives inn); ingen kontroll av hvem som ble fakturert (541.4 er fjernet);
NVOCC-forlengelsen i 541.7(c), per diem-, chassis- og timegebyrer og andre valutaer enn USD håndteres ikke;
malene kan være utdaterte, og CMA CGM-malen er fra en sekundærkilde. Hele listen står i
[technical/web-platform-security.md, del 12.5](technical/web-platform-security.md#125-accepted-residuals-step-8)
(engelsk).

## Herding: forbedringer av eksisterende funksjoner

Kjøringen `REQ-20261012-hardening` legger **ikke** til noen ny funksjon, rute, tillatelse eller brukerinnstilling.
Den gjør eksisterende funksjoner tydeligere og vanskeligere å misbruke, og den retter funnene fra en
sikkerhetsrevisjon av hele plattformen. Før produkt, bare syntetiske data, aldri utrullet. Trusselmodellen,
status for hver tidligere restrisiko og hva som fortsatt er åpent, står i
[technical/web-platform-security.md, del 13](technical/web-platform-security.md#13-hardening-run) (engelsk).
Arkitektur: [ARCHITECTURE.no.md, herdingskjøringen](ARCHITECTURE.no.md#nettplattform-herdingskjøringen).

### Firøyeprinsippet: hvem som ikke kan godkjenne, og hvorfor

Godkjenning og avvisning av et krav avvises av tre grunner, som kontrolleres i denne rekkefølgen. API-et svarer
403 `four_eyes_required`, ingenting endres, og forsøket registreres i revisjonssporet. `/approvals` viser teksten
for den første grunnen som gjelder, i stedet for Approve/Reject (tekstene i appen er på engelsk):

| Grunn | Tekst på `/approvals` |
| --- | --- |
| Du har laget en revisjon av kravet (redigering, analyse eller D&D-kontroll) | «You created a revision of this claim (by editing, analyzing or running the D&D audit). Another approver must approve it.» |
| Du har lagt inn eller redigert kravets D&D-faktura | «You entered or edited the D&D invoice of this claim. Another approver must approve it.» |
| **Ny:** du har satt en gebyretikett for teamet som påvirket analysen av kravet | «You set a team charge label that influenced this analysis. Another approver must approve it.» |

- **Etikettforfattere.** Du er etikettforfatter for et krav hvis du, før analysen kjørte, opprettet eller endret
  en av teametikettene som analysen registrerte som påvirkende. Å endre en etikett etter analysen teller ikke,
  og det gjør heller ikke sletting. Krav som aldri er analysert (seedede krav og D&D-krav), har ingen
  etikettforfattere.
- **Mer enn 50 påvirkende etiketter.** Analysen registrerer høyst 50 etiketter. Når flere kan ha påvirket et
  krav, noterer analysen at listen er ufullstendig. **Alle** i organisasjonen som satte en teametikett før
  analysen, utelukkes da fra å godkjenne kravet. I et lite team kan det bety at ingen i organisasjonen kan
  godkjenne det (akseptert foreløpig).
- **Sperre i databasen.** En databasetrigger håndhever nå også reglene for D&D-faktura og etiketter, slik en
  allerede gjorde for revisjonsregelen. I tillegg kan en direkte oppdatering i databasen ikke lenger merke en
  bevispakke som godkjent, avvist eller klar til sending uten en tilhørende beslutningsrad.
- **Id-er med store bokstaver.** Id-er for krav, fakturaer og annet i URL-er behandles uten hensyn til store og
  små bokstaver og lagres med små bokstaver. Før denne kjøringen kunne en id med store bokstaver i URL-en skjule
  en redigering for firøyekontrollen.

### Analyser som feiler

Når en analyse ikke kan lagres (422), sier kravarket nå hvorfor:

| Grunnkode | Tekst |
| --- | --- |
| `input_values` | «The extracted values of this claim cannot be analysed automatically. Accepted documents cannot be changed, so the claim stays awaiting analysis.» |
| `amount_out_of_range` | «The computed amounts are negative or larger than the product can store, so nothing was saved.» |
| `fuel_check` | «The fuel check produced amounts that cannot be stored. Clear the fuel inputs or choose another fuel table, then analyze again.» |

Som før skriver en avvist analyse ingenting til kravet, pakken eller dokumentene. Hver feil registreres nå i
revisjonssporet som `claim.analysis_failed`: krav-id og kravnummer, grunnkode, enkeltvis eller masseanalyse,
regelversjon og antall dokumenter, men ingen uttrukne verdier. Så lenge kravet venter på analyse, viser
kravarket en merknad til alle som kan lese kravet, for eksempel «Last analysis attempt failed on <dato> (2
failed attempts so far). <grunntekst>». Svaret fra analyse-ruten har
`details: [{ "path": "analysis", "code": "<grunnkode>" }]`. `GET /api/v1/claims/:id` har `analysisFailure`:
`lastFailedAt`, `reasonCode` og `failedAttempts`, eller null.

### Masseanalyse

- Dialogen sier «Analyzes up to 10 claims awaiting analysis, oldest first. Claims whose analysis failed before
  are tried after the others.»
- Etter en kjøring sier dialogen under sammendragslinjen hvorfor den stoppet: «Stopped after the batch limit.»,
  «Stopped early: your analysis budget is used up for now. Try again later.» eller «All candidate claims in
  this run were tried.»
- Svaret får `stoppedBy` (`limit`, `budget` eller `candidates`) og en `reasonCode` for hvert krav som feilet.
  Revisjonshendelsen `claim.bulk_analyzed` registrerer også `stoppedBy`. Ender en kjøring med en uventet feil,
  svarer API-et fortsatt 500, men registrerer først den delvise kjøringen med `stoppedBy: "error"`.

### Fanen Charges

- For et analysert krav lister en seksjon «Team labels that influenced this analysis» hver etiketts beskrivelse
  og kategori («Deleted label» for en etikett som er slettet siden). Den slutter med «A team label can only move
  findings to human review or add review items. It never adds confirmed money.» Hvis ingen etikett påvirket
  analysen, står det «No team label influenced this analysis.» Seksjonen vises ikke for krav som ikke er
  analysert. I API-et får `GET /api/v1/claims/:id/charge-lines` feltet `influence` (null, eller listen over
  etiketter).
- I det sjeldne tilfellet at en lagring av en etikett kolliderer med en samtidig endring av samme formulering, og
  det automatiske nye forsøket også kolliderer, er svaret nå 409 `conflict` med «This label was changed at the
  same time by someone else. Reload and try again.» Før var det en generell 500.

### Formuleringer på eksisterende sider

- **Funn** viser `<regel-id> - rule setting 0.90 (fixed per rule; not a measured probability)` i stedet for
  `confidence 90%`. Tallet er den samme faste verdien per regel som før. Det er ikke en sannsynlighet.
- **Maler for Ocean D&D** viser verifiseringsnivået i ord, for eksempel «Verification: Read from the carrier's
  published tariff through a search-engine extract; the document itself was not downloaded. Verify before
  use.»
- **Drivstofftabeller**: ved taket sier siden «This organization has reached the maximum of 50 fuel tables.
  Archived tables count toward this limit.»
- **Outlook**: under kildelinjen for hver serie står det hvor prisene kom fra: «Downloaded from FRED by the
  import command.», «From the files bundled with the product, checked against their pinned sha256.» eller
  «Imported from a file supplied by the operator; the product did not download it.» API-et legger til
  `provenance.sourceKind` (`fetch`, `bundled` eller `file`).
- **Tilgjengelighet**: tabellene for kravlisten, pakkekildene, koblede dokumenter, uttrukne felt og
  gjennomgangskøen har nå tilgjengelige navn, så alle datatabeller i nettappen har ett.

### Innlogging, kontoer og invitasjoner

- **Bytte passord** teller nå feil nåværende passord mot den samme sperren som innlogging (5 feil som
  standard). Etter det svarer passordbytte og innlogging for den e-postadressen 429 `account_locked` til
  sperren utløper, også med riktig passord. Et vellykket bytte fjerner sperren. Ruten bruker også den
  strengere `auth`-ratebegrensningen. Hvert feil forsøk registreres som `auth.password.change_failed`.
- **Sperret ute, men på din egen enhet.** Mens en e-postadresse er sperret, behandles en innlogging eller et
  MFA-steg likevel normalt hvis det kommer fra en nettleser som har en levende øktcookie for den samme brukeren.
  Passordet, og MFA der det kreves, kontrolleres fortsatt. Et feil passord fra den nettleseren gir 401, ikke 429.
  Uten en slik økt gjelder sperren som før. Den vellykkede innloggingen registreres med `knownDevice: true`.
- **Forfremmelse til Owner eller Admin** av en bruker uten MFA avslutter brukerens økter med en gang. Ved neste
  innlogging må brukeren registrere MFA.
- **Invitasjoner** til en e-postadresse som allerede har en konto i en annen organisasjon, får nå samme `201`
  som alle andre invitasjoner. Før fikk de 409, som avslørte at personen bruker plattformen. En slik invitasjon
  kan ikke godtas. Å invitere et medlem av din egen organisasjon gir fortsatt 409.
- **Klientadresse bak CloudFront (driftere).** Ratebegrensninger, innloggingsforsøk og `ip` i revisjonssporet
  bruker besøkendes adresse fra `CloudFront-Viewer-Address`, men bare når forespørselen også har den hemmelige
  headeren `x-origin-verify` som CloudFront legger til. Ellers brukes adressen fra `TRUST_PROXY`, som før.
  Terraform og kontrollen før utrulling står i
  [infra/README.md](infra/README.md#deploy-gate-cloudfront-origin-verification-and-client-address-fix-round-1-f-03)
  (engelsk). Dette er rettet i koden og i infrastrukturkoden, men er ikke verifisert før den kontrollen er
  registrert i AWS.

### Konfigurasjon (herding)

| Variabel | Standard | Betydning |
| --- | --- | --- |
| `CLIENT_IP_HEADER` | ikke satt | `cloudfront-viewer-address` bak CloudFront; la den være usatt lokalt. Produksjon krever den ikke, men uten den knyttes begrensningene per adresse til CloudFront-kantnodens adresse |
| `ORIGIN_VERIFY_SECRET` | ikke satt | påkrevd når `CLIENT_IP_HEADER` er satt; minst 43 tilfeldige tegn, forskjellig fra alle andre hemmeligheter. Den ligger i Secrets Manager; se [docs/secrets.no.md](docs/secrets.no.md) |

### Ikke dekket (akseptert foreløpig)

- En analyse som feiler på grunn av dokumentene, trenger fortsatt en ny import av rettede dokumenter.
- En masseanalyse belaster fortsatt én budsjettenhet for hvert krav den prøver.
- Avvisninger fra firøyetriggerne i databasen logges, men registreres ikke i revisjonssporet.
- En bruker uten levende økt på noen enhet kan fortsatt sperres ute av noen som kjenner e-postadressen.
- Mens origin-verify-verdien roteres, bruker API-et kantnodens adresse i et kort vindu.

Hele listen (HR-1..HR-13) står i
[technical/web-platform-security.md, del 13.5](technical/web-platform-security.md#135-known-gaps-and-residual-risks-hardening)
(engelsk).

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
                             # parity suites (step 3 extraction, step 5 rules); see the env block in .github/workflows/web-ci.yml
npm run test:acceptance      # black-box acceptance suites under */test-acceptance/ (when present)
npm run eval -- --set api/eval/sets/extraction-v1 --k 3 --min-pass-hat-k 1   # step 4: after npm run build
npm run eval:charges -- --min-top1 173 --min-accessorial-top1 158 --min-accessorial-recognised 145 --max-wrong-suggested 1   # step 6: after npm run build
npm run eval:outlook -- --min-coverage 0.70 --max-coverage 0.90 --require-model diesel_us:1,diesel_us:4,ppi_tl:1   # step 7: after npm run build
npm run prices:import -- --list   # step 7: owner connection (MIGRATE_DATABASE_URL); the seed imports the bundled prices
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

Firøyeprinsippet (2026-10-10, kjøringen `REQ-20261009-four-eyes`, Windows, **lokal kjøring på Node
22.23.3, ikke GitHub CI**, portabel PostgreSQL 16, portabel MinIO med SSE-KMS, i stegrekkefølgen og med
miljøet fra `web-ci.yml`): lint, typecheck, enhetstester (shared 136, api 356, web 67), migrering + seed,
`ensure-bucket`, build, integrasjon (95 bestått, 2 hoppet over fra før), akseptanse (shared 36, api 690
bestått med 9 hoppet over og 2 todo, web 150 bestått med 1 hoppet over). **Ikke kjørt:** Node 24, GitHub
CI, `npm run audit`, container-images, Playwright, enhver AWS-utrulling. Paritetstestene brukte Python
3.14 (CI bruker 3.12).

Steg 5 (2026-10-10, kjøringen `REQ-20261010-step5-analysis`, Windows, **lokale kjøringer, ikke GitHub
CI**; valideringen er **ikke fullført**): byggeren kjørte lint, typecheck, enhetstester (shared 165, api
370, web 78), paritetstestene for reglene (2 132 saker, null forskjeller på Node 22.23.3 og Node 24) og, på
Node 22.23.3, migrering + seed (også `--reset`), build og integrasjon (16 filer, 107 bestått, 3 lokale
plassholdere hoppet over), ved commit `b12ce2a`. Den første uavhengige akseptansekjøringen (Node 22.23.3,
`CI=true`, samme commit) ga shared 81/81 og api 754 bestått, 4 feilet, 10 hoppet over; de 4 feilene var
feil i testdesignet, rettet i testfilene, men ennå ikke bekreftet fordi den nye kjøringen ble stoppet av
lite ledig minne. Akseptansetestene for nettappen er ikke kjørt ennå. Rettingscommiten `5c047fb`
(budsjettet for masseanalyse) ble bare kontrollert med lint, typecheck og utvalgte enhetstester. **Ikke
kjørt:** akseptanse og integrasjon ved `5c047fb`, GitHub CI, container-images, Playwright, enhver
AWS-utrulling.

Steg 6 (2026-10-11, kjøringen `REQ-20261011-charge-intelligence`, Windows, Node 22.23.3, **lokale
kjøringer, ikke GitHub CI**; modus for lite minne, så valideringen er **ikke fullført**): byggeren kjørte
lint, typecheck og enhetstester (ved `3a8125d`: shared 190, api 392, alle nettappens filer; etter
rettingsrunde 1 ved `43d7d4c`: shared 195, api 393, nettappens filer for gebyrer, analyse og steg 4 med 33
tester) og `npm run eval:charges` med CI-grensene (avslutningskode 0). Testerens rene akseptansetester i
shared (nivå L) besto 73 av 73 ved `3a8125d`; etter rettingsrunde 1 fant de én manglende eksport fra
pakkeroten, rettet i `a1b1c2a`, der hele akseptansesettet for shared besto 153 av 153. **Skrevet, men ikke
kjørt** (venter på eierens klarsignal): integrasjonstestene for den nye tabellen (RLS, tilganger, avvisning
på tvers av tenanter), akseptansetestene for API, database, CLI og nett (nivå H) og paritetstestene.
**Ikke kjørt:** GitHub CI, container-images, Playwright, enhver AWS-utrulling.

Steg 7 (2026-10-11, kjøringen `REQ-20261011-fuel-outlook`, Windows, Node 22.23.3, **lokale kjøringer, ikke
GitHub CI**; modus for lite minne, så valideringen er **ikke fullført**): byggeren kjørte lint og typecheck
(rene i hele repoet), utvalgte enhetstester (shared fuel og outlook, evalueringsverktøyet og drivstoffenhetene
i api, nettappens filer for fuel, outlook, charges, analysis og ui med 35 tester), `prisma generate`,
`prisma migrate diff` (ingen database) og terskelen `eval:outlook` med CI-grensene (avslutningskode 0;
ugyldige data gir 2, for stramme grenser gir 1), ved `cbb340f`. Testerens rene akseptansetester (nivå L)
besto: shared 263 av 263, api 13 av 13 (første kjøring fant én produktfeil, returformen til `checkFuel`,
rettet i `d87db5e` uten å endre noen test). Sikkerhetsgjennomgangen fant ingen Critical, High eller Medium;
rettingsrunde 1 (`1a95245`: avvisning av reviderte prisverdier, en parameterhash for drivstofftabeller, en
test for API-nøkler) ble kontrollert med lint, typecheck og 52 enhetstester i api. **Skrevet, men ikke
kjørt** (venter på eierens klarsignal): `npm run build`, integrasjonstestene for de fire nye tabellene (RLS,
tilganger, avvisning på tvers av tenanter, pristabeller som bare kan utvides), akseptansetestene for API,
database, import og nett (nivå H) og paritetstestene.
**Ikke kjørt:** GitHub CI, container-images, Playwright, enhver AWS-utrulling.

Steg 8 (2026-10-11, kjøringen `REQ-20261011-ocean-dd`, Windows, Node 22.23.3, **lokale kjøringer, ikke GitHub
CI**; modus for lite minne, så valideringen er **ikke fullført**): byggeren kjørte `prisma validate`, `prisma
generate`, `prisma migrate diff` (ingen database), lint og typecheck (rene) og utvalgte enhetstester (shared
ocean-dd, api `ocean-dd-units`, `tenant-scope`, `architecture`, `four-eyes-units`, nettappens ocean-dd-side og de
berørte kravfixturene), ved `afadac3`. Testerens rene akseptansetester (nivå L, før rettingsrunde 1) besto:
shared 389 av 389 (med 3 000 tilfeldige tilfeller mot et uavhengig orakel og alle regneeksemplene med
tariffer), statiske api-tester 10 av 10 (første kjøring fant én produktfeil, rekkefølgen på kontrollene per
container, rettet uten å endre noen test). Sikkerhetsgjennomgangen fant ingen Critical eller High;
rettingsrunde 1 (`1ca8eb5`: en lettere fakturaliste med høyst 50 rader, et tak på 2 000 fakturaer,
firøyeprinsippet også for den som opprettet eller sist endret D&D-fakturaen, en grense på 256 KiB for
forespørselskroppen på bare de to skriverutene for fakturaer, en kontroll av filstørrelsen på 4 MB før
nettleseren leser en CSV) ble kontrollert med lint, typecheck og enhetstester (shared 32, api 55, nett 10);
rettingsrunde 2 (`22e4a73`: grensemeldingen nevner også fakturaer, en tekst for for stor fil, den eksporterte
konstanten for filstørrelse ved CSV) med lint, typecheck og enhetstester (shared 32, api 36, nett 10).
Gjennomgangen fant deretter at kontrollkjøringen overskrev siste redaktør (F1); rettingsrunde 3 (`10f8941`:
firøyeprinsippet avviser alle som opprettet eller endret fakturadataene, hentet fra revisjonssporet;
kontrollkjøringen endrer ikke lenger redaktørfeltet; egen tittel og henvisning til 541.6(b)/(d) for funn som bare
gjelder unøyaktigheter; ordrett ordlyd fra 545.5(c)(2)(ii) og 541.8(b)) besto lint, typecheck og enhetstester
(shared 34, api 43). **Skrevet, men ikke kjørt** (venter på eierens klarsignal): integrasjonstestene for de tre nye tabellene (RLS,
tilganger, avvisning på tvers av tenanter, triggere), akseptansetestene for API, database, kontroll og nett
(nivå H) og paritetstestene.
**Ikke kjørt:** GitHub CI, container-images, Playwright, enhver AWS-utrulling.
