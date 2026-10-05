> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse, ikke juridisk/finansiell fagoversettelse. Ved avvik gjelder den engelske originalen. Juridisk og skattemessig innhold er utkast og må gjennomgås av advokat/rådgiver før bruk.

# Arkitektur (MVP, før produkt)

```
files (PDF/CSV/TXT)
   |  ingest/        bytes -> RawDocument (text, doc_type, sha256)
   v
 extraction/        RawDocument -> Invoice | RateConfirmation | BillOfLading   (swappable provider)
   |  extract_bundle -> ExtractedBundle (+ warnings)
   v
 rules/             ExtractedBundle -> Findings -> RecoveryResult (per perspective)
   v
 evidence/          documents + findings + calculations + DRAFT letter -> EvidencePacket (+ markdown)
   v
 api/ (FastAPI) and cli.py     thin adapters over pipeline.run_pipeline
```

## Moduler (`src/freight_recovery/`)
| Modul | Ansvar |
|---|---|
| `models.py` | pydantic v2-domenetyper; penger er `Decimal`; `Finding`, `RecoveryResult`, `EvidencePacket` |
| `config.py` | miljødrevne `Settings` (`FR_EXTRACTION_PROVIDER`, `FR_DETENTION_INCREMENT_MINUTES`) |
| `ingest/` | dekoder PDF (pdfplumber, lat import) / CSV (flatet ut til `Key: Value`) / TXT; klassifiserer dokumenttype; sha256 |
| `extraction/` | `ExtractionProvider`-Protocol; `DeterministicStubProvider` (standard, offline); plassholderen `LLMExtractionProvider`; `extract_bundle` |
| `rules/` | `detention.py` (reviderbar beregning), `invoice_checks.py` (rate/drivstoff/tilleggsgebyr/duplikat/total), `engine.py` (totaler per perspektiv) |
| `evidence/` | `letter.py` deterministisk kravbrevutkast; `packet.py` setter sammen pakken og markdown |
| `pipeline.py` | `run_pipeline(files, perspective)` - det eneste orkestreringsinngangspunktet |
| `api/main.py` | FastAPI-app, dokumentert med OpenAPI; `cli.py` for lokal bruk |

## Sentrale beslutninger
- **Leverandørgrensesnitt, deterministisk standard.** Pipelinen avhenger bare av `ExtractionProvider`. Stubben gjør testene reproduserbare og offline; en leverandør med hostet modell kan legges til uten å røre regler eller bevis. Modellutdata må valideres av pydantic og skal aldri stoles på for aritmetikk: **all pengematematikk ligger i `rules/`, i Decimal.**
- **Reglene gir forklarbare funn.** Hvert funn har regel-id, beløp, konfidens og en trinnvis beregning; usikre funn setter `needs_human_review`. Duplikater fjernes før satssammenligninger for å unngå dobbelttelling.
- **To perspektiver, én motor.** Funn er retningsbestemte (`overcharge` vs. `underbilled`); det valgte perspektivet summerer sin retning og rapporterer resten som ignorert.
- **Menneske i løkken.** Utdata er en utkastspakke; ingenting sendes. Hver pakke har en ansvarsfraskrivelse.
- **Tilstandsløs MVP.** Ingen DB, ingen kø, ingen autentisering. Persistens (Postgres/RDS), S3-dokumentlagring og asynkrone jobber er de neste arkitektursteg (se `deploy/aws.md`).
- **Bevisintegritet.** sha256 av originalbytes registreres per dokument.

## Kjente hull
OCR av skannede PDF-er; laster med flere dokumenter/stopp; tidssone-bevisste tidsstempler; kontrakt-/tariffspesifikke regler; transportørspesifikke gebyrkoder; tvistefrister og statussporing; integrasjoner (TMS/EDI/transportørportaler); betalinger/avstemming av kreditter; sikkerhetsherding. Prosjektets researchplan (eval-sett først, uavhengig verifikator, målt pass^k) ligger i `technical/` og er ennå ikke implementert her.
