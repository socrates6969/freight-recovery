> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse, ikke juridisk/finansiell fagoversettelse. Ved avvik gjelder den engelske originalen ([overview.md](overview.md)). Juridisk og skattemessig innhold er utkast og må gjennomgås av advokat/rådgiver før bruk.

# Freight Recovery - teknisk oversikt

> **Status: MVP-skjelett før produkt.** `src/freight_recovery/` inneholder et offline, deterministisk skjelett av pipelinen (omtrent 1 100 linjer, 29 tester, FastAPI + CLI). Det har aldri kjørt på reelle kundedokumenter. Avsnitt 0 sier nøyaktig hva som finnes; resten av denne filen beskriver målarkitekturen og markerer hva som **ikke er bygget ennå**. Ingenting her er målt.

## 0. Hva koden gjør i dag (verifisert ved å lese kildekoden)

| Steg | Modul | Implementert | Ikke implementert (TODO i kode eller dette dokumentet) |
|---|---|---|---|
| Ingest | `ingest/loader.py` | Klassifiserer og normaliserer tekst, CSV og PDF-tekst til `RawDocument` | OCR for skann/bilder, e-postparsing, EDI 210/214 |
| Extract | `extraction/` (`provider.py`, `stub.py`, `service.py`) | Utskiftbart `ExtractionProvider`-grensesnitt; standard er en **regelbasert, offline stub** som parser `Key: Value`-linjer til Invoice / RateConfirmation / BillOfLading-modeller | `LLMExtractionProvider` er en plassholder som kaster `NotImplementedError`; ingen layoutbevisst parsing; ingen kildepekere per felt ennå |
| Rules | `rules/` (`detention.py`, `invoice_checks.py`, `engine.py`) | Deterministisk Decimal-aritmetikk: detention (klokken starter ved det seneste av avtale/ankomst, fri tid, 15-minutters nedrunding, valgfritt tak) og fakturasjekker (sats, drivstoff, uautoriserte tilleggsgebyrer via nøkkelordmatch, duplikater, totaler), avsender- og transportørperspektiv | Transportørspesifikke gebyrkoder, tariff-/kontraktsoppslag, flere stopp, helge-/høytidsvilkår, tidssonebevisste tidsstempler |
| Evidence | `evidence/` (`packet.py`, `letter.py`) | Markdown-bevispakke og utkast til kravbrev; tvistevindu satt til 90 dager (konfigurerbar konstant) | Uavhengig verifikator, henvisningsspenn kontrollert mot kilder, transportør-/kontraktsspesifikke frister |
| Output | `api/main.py`, `cli.py`, `pipeline.py` | `POST /v1/analyze`, `POST /v1/analyze/text`, `/health`; CLI skriver ut pakken | Saksoppfølging, påminnelser, tvistestatus, arbeidsflyt for menneskelig godkjenning, uforanderlig revisjonsspor |

Fraværende i Python-tjenesten er også pass^k-eval-rammeverket og fasitsettet (beskrevet i avsnitt 2 som planen). TypeScript-nettplattformen (byggesteg 4) har nå et første pass^k-verktøy bare for **uttrekkssteget**, kjørt på 30 syntetiske testfiler (`npm run eval`, se README); det er en regresjonskontroll, ikke et mål på treffsikkerhet, og det finnes ikke noe fasitsett med ekte dokumenter. De eksisterende testene bruker små syntetiske fixtures (`tests/fixtures/ld5001`, `ld5002`) og beviser aritmetikken og rørleggerarbeidet, ikke treffsikkerhet i virkeligheten.

## 1. Pipelinen i klartekst

Et krav beveger seg gjennom fem steg. Hvert steg har én jobb, definert input og output, og egne tester.

```
 ingest  ->  extract  ->  rules  ->  evidence  ->  output
 (files)    (facts)     (entitlement) (proof pack)  (demand + tracking)
                                 \________ human approval gate ________/
```

1. **Ingest.** Ta imot rate confirmations, BOL/POD, tilleggsfakturaer og dokumenter sendt på e-post (PDF, bilde, e-post, senere EDI 210/214 og API-feeder). Normaliser til tekst/strukturerte sider; behold originalfilen og en innholdshash slik at hver senere henvisning peker på en reell side.
2. **Extract.** Gjør dokumenter om til strukturerte fakta: parter, last-ID, avtalevindu, ankomst- og avgangstider, fri tid, sats, linjer for tilleggsgebyrer og kontraktsklausulens tekst. Bruker OCR pluss en LLM for rotete dokumenter. Hver uthentede verdi bærer en **kildepeker** (dokument, side, spenn). Utheninger med lav konfidens flagges for menneskelig gjennomgang i stedet for å gjettes.
3. **Rules.** En deterministisk regelmotor avgjør rett til krav og beløp: fri tid utløpt, sats per time, tak, varslingskrav, kravfrister. LLM-en regner **ikke** ut penger. Regler er versjonerte, lesbare og testbare; uthenting av kontraktsspråk foreslår regler som et menneske gjennomgår.
4. **Evidence.** Sett sammen bevispakken: en tidslinje av tidsstempler med henvisninger, den gjeldende klausulen, beregningen og vedlegg. Et separat **verifikator**-steg kontrollerer hver setning i pakken mot den siterte kilden og avviser usiterte eller motsagte påstander.
5. **Output.** Produser et klart-til-sending krav/en faktura og en saksjournal med frister, oppfølgingspåminnelser, tvistestatus og utfall. **Et menneske godkjenner før noe sendes** og et uforanderlig revisjonsspor registrerer input, versjoner og beslutninger.

### Designprinsipper
- **LLM for å lese, kode for å avgjøre.** Språkmodeller henter ut og utformer utkast; aritmetikk og rett til krav er deterministisk.
- **Ingen henvisning, ingen påstand.** Verifikatoren blokkerer enhver påstand som ikke kan spores til et kildespenn.
- **Menneske i løkken** for sending/eskalering, med konfigurerbare terskler.
- **Ingen pengeflytting** i v1.
- **Dataminimering.** Sjåførposisjon og personopplysninger håndteres under CCPA-/GDPR-antakelser; bekreft med jurist (åpent punkt).

## 2. Verifiserings- og eval-tilnærming (pass^k)

Eval først: fasitsettet bygges **før** pipelinen.

- **Fasitsett.** 100+ saker (start fra en designpartners avsluttede saker, sladdet; suppler med syntetiske saker for grensetilfeller) med fasit for felt, rett til krav og beløp. Del i dev/holdout; aldri tun på holdout.
- **Stegmålinger.** Feltnøyaktighet i uthenting; regelkorrekthet (eksakt beløpstreff); henvisningsgyldighet (hvert sitert spenn støtter setningen sin); pakkens fullstendighet; rate for falske påstander.
- **pass^k.** For hver sak kjøres hele pipelinen k ganger (k = 5 som startverdi, ASSUMPTION). En sak «består pass^k» bare hvis **alle k kjøringer** gir et korrekt, fullt sitert resultat. Rapporter andelen saker som består pass^k, ikke bare nøyaktighet for én kjøring. Dette straffer ustabilitet: hvis suksess per kjøring er p og kjøringene er uavhengige, er pass^k omtrent p^k, så 95 % per kjøring blir ~77 % ved k=5. Det er tallet som betyr noe når kunder stoler på det.
- **Uavhengig verifikator.** Verifikatoren er atskilt fra utkastskriveren (ulik prompt og, der det er praktisk, ulik modell) slik at én feilmodus ikke passerer begge.
- **Terskler satt på forhånd.** Eksempel (ASSUMPTION, skal fastsettes før måling): null hallusinerte henvisninger på holdout, pass^5 over en avtalt prosent på pengebærende felt, og en definert rate for menneskelig gjennomgang. Hvis terskelen ikke nås, vises ikke produktet til kunder.
- **Regresjon + red team.** Prompt-injeksjon i innkommende dokumenter (e-poster/PDF-er er upålitelig input), adversarielle og tvetydige kontrakter, og manipulerte tidsstempler.
- **Produksjonsovervåking.** Følg innkrevingsrate, rate for menneskelig overstyring og tvisteutfall som løpende evals; mat utfall tilbake til reglene og fasitsettet.

## 3. Integrasjonsveikart

| Fase | Integrasjon | Hvorfor | Merknader |
|---|---|---|---|
| 0 | Manuell opplasting (PDF/bilde/videresendt e-post), CSV | Raskeste vei til designpartnerdata | Ingen integrasjonsavhengighet |
| 1 | EDI 210 (faktura) / 214 (status) og AP-/e-postinnboks-parsing | Revisjon på avsendersiden, transportørenes fakturastrømmer | Vanlige formater; særegenheter per leverandør |
| 2 | ELD-/telematikk-API-er (f.eks. Motive, Samsara) | Tidsstempelbevis for detention på transportørsiden | Kundeautorisert tilgang; personvernvurdering påkrevd |
| 3 | TMS-integrasjoner (f.eks. MercuryGate, andre) | Last-, sats- og avtaledata uten opplastinger | Største reduksjon av onboarding-friksjon |
| 4 | Synlighetsplattformer (f.eks. project44, FourKites) | Ankomst-/avgangstidsstempler i stor skala | Partnerskap først; de er også potensielle konkurrenter |
| 5 | Ramp-/dokkplanlegging og regnskapssystemer | Avtalebevis; lukke løkken på betaling | Etter at kjernen er bevist |

Navngitte leverandører er mål under vurdering, ikke avtaler. Gjennomførbarhet og vilkår for integrasjon er ikke verifisert.

## 3b. Prognoser (veikart)

Valgfritt, av som standard, ikke i kjerneflyten for innkreving. `freight_recovery.forecast` definerer et `Forecaster`-grensesnitt (`fit` / `predict`, én eller flere serier) med en kun-stdlib `SeasonalBaselineForecaster` (sesongnaiv / glidende gjennomsnitt; deterministisk; kjører i CI). `NeuralForecastForecaster` (NHITS via neuralforecast) er skjelett bak pip-tillegget `forecast` (`neuralforecast`, `torch`), importert lat: uten tillegget kan modulen fortsatt importeres og bare det å konstruere den gir en feil om å «installere [forecast]-tillegget». Tillegget er ikke hash-låst og ikke i Docker-imaget. Det er ikke validert; det trenger reell historikk med flere tidsserier og blir ofte bare likt med baselinen, så all bruk må først benchmarkes mot baselinen. Bruk: kun prioritering av innkreving.

## 4. Sikkerhet og personvern (grunnlinje)
Kryptert lagring og transport, dataisolasjon per kunde, rollebasert tilgang, revisjonslogging, oppbevaringsgrenser, sladding av personopplysninger i eval-sett, og behandling av alle innkommende dokumenter som upålitelige. SOC 2 er en senere milepæl drevet av kundeetterspørsel.

## 5. Åpne tekniske spørsmål
1. Hvilken andel av dokumentene kommer som rene PDF-er mot skann og bilder?
2. Hvilke tidsstempler er juridisk og kommersielt akseptert som bevis (portlogger, ELD, geofence, synlighet), og for hvilke motparter?
3. Hvor mye menneskelig gjennomgang per krav trengs for å nå kvalitetsterskelen (styrer bruttomarginen)?
4. Bygge eller kjøpe for OCR og EDI-parsing.
