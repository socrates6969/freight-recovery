> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse, ikke juridisk/finansiell fagoversettelse. Ved avvik gjelder den engelske originalen ([README.md](README.md)). Juridisk og skattemessig innhold er utkast og må gjennomgås av advokat/rådgiver før bruk.

# Freight Recovery

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
