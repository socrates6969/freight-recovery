> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse, ikke juridisk/finansiell fagoversettelse. Ved avvik gjelder den engelske originalen. Juridisk og skattemessig innhold er utkast og må gjennomgås av advokat/rådgiver før bruk.

# Freight Recovery

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
- hiring/ — rollebeskrivelser + hvordan finne en operatør/daglig leder i Norge (rekrutterere og offisielle kanaler).

## Byggeplan
Følger spillboken med 12 prompter: eval-sett først → verifisert verktøylag → utkast + uavhengig verifikator (målt pass^k) → henting/minne → ruting/kostnadskontroll → red-team → revisjonsspor + menneskelig godkjenning → målt innkrevingsrate → pilot-enpager → seed-deck som kun bygger på målte resultater.

---

# MVP-kodebase (før produkt, IKKE produksjonsklar)

Et fungerende vertikalt snitt av kjerneflyten: **innlesing -> uttrekk -> regler -> innkrevingsbeløp -> bevispakke + UTKAST til kravbrev**. Den kjører helt offline med en deterministisk uttrekks-stub (ingen API-nøkkel). Den er **ikke** validert på reelle kundedata, har **ingen autentisering eller database**, og er et utgangspunkt, ikke et system for store virksomheter. Se [ARCHITECTURE.md](ARCHITECTURE.md) og [deploy/aws.md](deploy/aws.md).

## Stack
Python 3.11+ (utviklet på 3.14), FastAPI, pydantic v2, uvicorn, pdfplumber (PDF-tekstlag), pytest. Versjoner er låst i `requirements.txt` / `requirements-dev.txt`. CSV håndteres med standardbiblioteket (pandas ble bevisst droppet: for tungt for behovet).

## Oppsett, kjøring, test
```bash
python -m venv .venv
.venv/Scripts/activate            # Windows (Git Bash: source .venv/Scripts/activate); Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt

pytest                                            # run the test suite (offline)
uvicorn freight_recovery.api.main:app --app-dir src --reload   # API; docs at http://localhost:8000/docs
python -m freight_recovery.cli --perspective carrier tests/fixtures/ld5002/*   # CLI (set PYTHONPATH=src)
docker compose up --build                         # local container (not yet exercised, see below)
```

## API (OpenAPI på `/docs`, `/openapi.json`)
- `GET /health`
- `POST /v1/analyze` - multipart-opplasting av faktura / ratebekreftelse / BOL (PDF, CSV, TXT) for én last, pluss `perspective` (`shipper` | `carrier`).
- `POST /v1/analyze/text` - det samme, med dokumenter som innebygd tekst (JSON).

Perspektiv: **shipper** (avsender) krever tilbake overbetaling; **carrier** (transportør) krever inn detention/tilleggsgebyrer som er opptjent, men ikke fakturert eller underfakturert.

## Hva reglene gjør i dag
Detention (klokken starter ved den seneste av avtaletid/ankomst, fritid og sats hentes fra ratebekreftelsen, rundes ned til konfigurert intervall med eksakt heltallsaritmetikk i minutter, og begrenses til kontraktens maksimum), linehaul over ratebekreftelsen, drivstofftillegg over ratebekreftelsen, tilleggsgebyrer som ikke er godkjent i ratebekreftelsen (flagges for menneskelig gjennomgang), gjentatte identiske linjer (flagges også for menneskelig gjennomgang: kan være legitime), fakturatotal over summen av linjene. **Kun bekreftede funn teller mot `recoverable_total` og kravbrevet; poster med `needs_human_review` listes og summeres separat som `pending_review_total`.** Nøkkelordtabeller og terskler i reglene er illustrative og umålte. Konvensjonene er eksplisitte i `src/freight_recovery/rules/`; reelle kontrakter/tariffer varierer og vil trenge konfigurasjon per kunde.

## Hva som faktisk er kjørt vs. overlatt til CI
- **Kjørt lokalt (Windows, Python 3.14.7, fersk venv): `pytest` -> 261 bestått**, inkludert den håndbygde PDF-innlesingstesten og FastAPI TestClient-testene; pluss en CLI-røyktest.
- **Ikke kjørt:** `docker build` / `docker compose up` (Docker ble ikke prøvd på denne travle maskinen) - Dockerfile og compose-filen er uverifiserte; `.github/workflows/ci.yml` bygger imaget og kjører pytest på Python 3.12, så den kjøringen er overlatt til CI. Terraform er aldri validert eller anvendt.

## Stubbet / TODO (reelt arbeid gjenstår)
- Uttrekket er en deterministisk `Key: Value`-parser; reelle transportør-PDF-er trenger layoutbevisst parsing/OCR og en hostet modellleverandør bak `ExtractionProvider` (plassholderen `LLMExtractionProvider` kaster NotImplementedError).
- Ingen integrasjoner mot TMS/transportørportal/EDI (204/210/214), ingen betalinger eller avstemming av kreditnotaer, ingen innsending av tvister via e-post/portal, ingen fristsporing.
- Ingen autentisering, multitenancy, persistens (RDS), jobbkø eller revisjonslogg. Naive tidsstempler behandles som lokal tid ved anlegget (blanding av naive og tidssone-bevisste verdier avvises; sommertidsoverganger på naive tider er ikke modellert).
- Reglene er énveis per perspektiv (linehaul/drivstoff/total flagger bare overbetaling), så en kjøring med transportørperspektiv finner ikke underfakturert linehaul.
- Reglene er ikke validert mot reelle avsluttede saker; nøyaktighetstall finnes ikke ennå. Kravbrev er utkast og sendes aldri automatisk.

## Inndataherding på plass (siden gjennomgangen før produkt)
Tak på forespørselens størrelse og tak per fil / antall filer (kontrollert før og under lesing), avgrensede JSON-felt på `/v1/analyze/text`, lineær-tids `Key: Value`-parsing (ingen ReDoS), streng pengeparsing (NaN/Infinity/eksponenter avvises), kontroll av PDF magic bytes med side- og tidsgrenser, parse-/domenefeil mappet til 4xx med faste meldinger (ingen inndata ekkoes tilbake), upålitelige verdier escapes i Markdown-pakken og kravbrevutkastet, compose bundet til 127.0.0.1, basisimage låst med digest, CI med minstemulig token-tilgang og SHA-låste actions. Regresjons- og invarianttester ligger i `tests/test_regressions_*.py`.

## Før reelle kundedata (IKKE gjort; ikke hopp over)
1. Autentisering (OIDC/JWT), autorisasjon og tenant-isolasjon på hver rute; steng eller deaktiver `/docs` og `/openapi.json`.
2. Persistens med kryptering i hvile, retningslinjer for oppbevaring/sletting, revisjonslogg (hvem/hvilken sha256/når, aldri dokumentinnhold).
3. Grensesperrer (WAF/ALB-tak på body, rate limiting) og PDF-parsing i en sandboxet worker med CPU-/RAM-/tidsgrenser og uten utgående trafikk (vernene i prosessen er best-effort).
4. Hash-låste avhengigheter, pip-audit/Dependabot/SBOM og image-skanning i CI; fullfør og skann Terraform før noen apply.
5. Gjennomgang av databehandling/leverandører før en hostet LLM kobles inn; deretter en uavhengig penetrasjonstest.
