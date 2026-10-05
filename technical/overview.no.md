> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse, ikke juridisk/finansiell fagoversettelse. Ved avvik gjelder den engelske originalen. Juridisk og skattemessig innhold er utkast og må gjennomgås av advokat/rådgiver før bruk.

# Freight Recovery - Teknisk oversikt

> **Status: MVP-skjelett før produkt.** `src/freight_recovery/` inneholder et offline, deterministisk skjelett av pipelinen (omtrent 1,100 linjer, 29 tester, FastAPI + CLI). Det har aldri kjørt på reelle kundedokumenter. Avsnitt 0 sier nøyaktig hva som finnes; resten av denne filen beskriver målarkitekturen og markerer hva som **ikke er bygget ennå**. Ingenting her er målt.

## 0. Hva koden gjør i dag (verifisert ved lesing av kildekoden)

| Steg | Modul | Implementert | Ikke implementert (TODO i kode eller dette dokumentet) |
|---|---|---|---|
| Innlesing | `ingest/loader.py` | Klassifiserer og normaliserer tekst, CSV og PDF-tekst til `RawDocument` | OCR for skanninger/bilder, e-postparsing, EDI 210/214 |
| Uttrekk | `extraction/` (`provider.py`, `stub.py`, `service.py`) | Utskiftbart `ExtractionProvider`-grensesnitt; standard er en **regelbasert, offline stub** som parser `Key: Value`-linjer til modellene Invoice / RateConfirmation / BillOfLading | `LLMExtractionProvider` er en plassholder som kaster `NotImplementedError`; ingen layoutbevisst parsing; ingen kildepekere per felt ennå |
| Regler | `rules/` (`detention.py`, `invoice_checks.py`, `engine.py`) | Deterministisk Decimal-aritmetikk: detention (klokken starter ved den seneste av avtaletid/ankomst, fritid, nedrunding til 15 min, valgfritt tak) og fakturakontroller (sats, drivstoff, uautoriserte tilleggsgebyrer via nøkkelordtreff, duplikater, totaler), perspektivene avsender og transportør | Transportørspesifikke gebyrkoder, oppslag i tariff/kontrakt, flere stopp, helge-/høytidsvilkår, tidssone-bevisste tidsstempler |
| Bevis | `evidence/` (`packet.py`, `letter.py`) | Markdown-bevispakke og utkast til kravbrev; tvistevindu satt til 90 dager (konfigurerbar konstant) | Uavhengig verifikator, henvisningsutdrag kontrollert mot kilder, transportør-/kontraktsspesifikke frister |
| Utdata | `api/main.py`, `cli.py`, `pipeline.py` | `POST /v1/analyze`, `POST /v1/analyze/text`, `/health`; CLI skriver ut pakken | Saksoppfølging, påminnelser, tvistestatus, menneskelig godkjenningsflyt, uforanderlig revisjonsspor |

Også fraværende: eval-rammeverket pass^k og gullsettet (beskrevet i avsnitt 2 som planen). De eksisterende testene bruker små syntetiske fixtures (`tests/fixtures/ld5001`, `ld5002`) og beviser aritmetikken og rørleggerarbeidet, ikke nøyaktighet i den virkelige verden.

## 1. Pipelinen i klartekst

Et krav går gjennom fem steg. Hvert steg har én oppgave, en definert inndata og utdata, og egne tester.

```
 ingest  ->  extract  ->  rules  ->  evidence  ->  output
 (files)    (facts)     (entitlement) (proof pack)  (demand + tracking)
                                 \________ human approval gate ________/
```

1. **Innlesing (ingest).** Ta imot ratebekreftelser, BOL/POD, tilleggsgebyrfakturaer og e-postede dokumenter (PDF, bilde, e-post, senere EDI 210/214 og API-feeder). Normaliser til tekst/strukturerte sider; behold originalfilen og en innholds-hash slik at hver senere henvisning peker på en reell side.
2. **Uttrekk (extract).** Gjør dokumenter om til strukturerte fakta: parter, last-ID, avtalevindu, ankomst- og avgangstider, fritid, sats, linjer for tilleggsgebyrer og kontraktsklausulens tekst. Bruker OCR pluss en LLM for rotete dokumenter. Hver uttrukket verdi har en **kildepeker** (dokument, side, utdrag). Uttrekk med lav konfidens flagges for menneskelig gjennomgang i stedet for å gjettes.
3. **Regler (rules).** En deterministisk regelmotor avgjør rett til krav og beløp: utløpt fritid, sats per time, tak, varslingskrav, kravfrister. LLM-en regner **ikke** penger. Regler er versjonerte, lesbare og testbare; uttrekk av kontraktsspråk foreslår regler som en person gjennomgår.
4. **Bevis (evidence).** Sett sammen bevispakken: en tidslinje av tidsstempler med henvisninger, den gjeldende klausulen, beregningen og vedlegg. Et separat **verifikator**-steg kontrollerer hver setning i pakken mot den siterte kilden og avviser uciterte eller motsagte påstander.
5. **Utdata (output).** Lag et sendeklart krav/faktura og en saksjournal med frister, påminnelser om oppfølging, tvistestatus og utfall. **Et menneske godkjenner før noe sendes**, og et uforanderlig revisjonsspor registrerer inndata, versjoner og beslutninger.

### Designprinsipper
- **LLM for å lese, kode for å avgjøre.** Språkmodeller trekker ut og lager utkast; aritmetikk og rett til krav er deterministisk.
- **Ingen henvisning, ingen påstand.** Verifikatoren blokkerer enhver påstand som ikke kan spores til et kildeutdrag.
- **Menneske i løkken** for sending/eskalering, med konfigurerbare terskler.
- **Ingen pengeflytting** i v1.
- **Dataminimering.** Sjåførposisjon og personopplysninger håndteres under CCPA/GDPR-antakelser; bekreft med juridisk rådgiver (åpent punkt).

## 2. Verifikasjon og eval-tilnærming (pass^k)

Eval først: gullsettet bygges **før** pipelinen.

- **Gullsett.** 100+ saker (start med en designpartners avsluttede saker, redigert; suppler med syntetiske saker for grensetilfeller) med fasit for felt, rett til krav og beløp. Del i dev/holdout; aldri tun på holdout.
- **Metrikker per steg.** Nøyaktighet på uttrukne felt; riktighet av regler (eksakt beløpstreff); gyldighet av henvisninger (hvert siterte utdrag støtter setningen sin); fullstendighet av pakken; rate av falske påstander.
- **pass^k.** For hver sak kjøres hele pipelinen k ganger (k = 5 som startverdi, ASSUMPTION). En sak "passerer^k" bare hvis **alle k kjøringer** gir et korrekt, fullt sitert resultat. Rapporter andelen saker som passerer^k, ikke bare nøyaktighet for enkeltkjøring. Dette straffer ustabilitet: hvis suksess per kjøring er p og kjøringene er uavhengige, er pass^k omtrent p^k, så 95% per kjøring blir ~77% ved k=5. Det er tallet som betyr noe når kunder stoler på det.
- **Uavhengig verifikator.** Verifikatoren er separat fra utkastskriveren (annen prompt og, der det er praktisk, annen modell) slik at én feilmodus ikke slipper gjennom begge.
- **Terskler satt på forhånd.** Eksempel (ASSUMPTION, skal fastsettes før måling): null hallusinerte henvisninger på holdout, pass^5 over en avtalt prosent på pengebærende felt, og en definert rate for menneskelig gjennomgang. Hvis terskelen ikke nås, vises ikke produktet til kunder.
- **Regresjon + red team.** Prompt-injeksjon i innkommende dokumenter (e-poster/PDF-er er upålitelig inndata), adversarielle og tvetydige kontrakter, og manipulerte tidsstempler.
- **Overvåking i produksjon.** Spor innkrevingsrate, rate for menneskelig overstyring og tvistutfall som løpende evals; mat utfall tilbake til reglene og gullsettet.

## 3. Veikart for integrasjoner

| Fase | Integrasjon | Hvorfor | Merknader |
|---|---|---|---|
| 0 | Manuell opplasting (PDF/bilde/videresendt e-post), CSV | Raskeste vei til data fra designpartnere | Ingen integrasjonsavhengighet |
| 1 | EDI 210 (faktura) / 214 (status) og parsing av AP-/e-postinnboks | Revisjon på avsendersiden, transportørers fakturastrømmer | Vanlige formater; særegenheter leverandør for leverandør |
| 2 | ELD-/telematikk-API-er (f.eks. Motive, Samsara) | Tidsstempelbevis for detention på transportørsiden | Kundeautorisert tilgang; personvernvurdering påkrevd |
| 3 | TMS-integrasjoner (f.eks. MercuryGate, andre) | Last-, sats- og avtaledata uten opplastinger | Største reduksjon av onboarding-friksjon |
| 4 | Synlighetsplattformer (f.eks. project44, FourKites) | Ankomst-/avgangstidsstempler i stor skala | Partnerskap først; de er også potensielle konkurrenter |
| 5 | Ramp-timeplanlegging og regnskapssystemer | Avtalebevis; lukke løkken på betaling | Etter at kjernen er bevist |

Navngitte leverandører er mål under vurdering, ikke avtaler. Gjennomførbarhet og vilkår for integrasjon er uverifisert.

## 4. Sikkerhet og personvern (grunnnivå)
Kryptert lagring og overføring, dataisolasjon per kunde, rollebasert tilgang, revisjonslogging, oppbevaringsgrenser, redigering av personopplysninger i eval-sett, og behandling av alle innkommende dokumenter som upålitelige. SOC 2 er en senere milepæl drevet av kundeetterspørsel.

## 5. Åpne tekniske spørsmål
1. Hvor stor andel av dokumentene kommer som rene PDF-er versus skanninger og bilder?
2. Hvilke tidsstempler godtas juridisk og kommersielt som bevis (portlogger, ELD, geofence, synlighet), og for hvilke motparter?
3. Hvor mye menneskelig gjennomgang per krav trengs for å nå kvalitetsterskelen (styrer bruttomarginen)?
4. Bygge versus kjøpe for OCR og EDI-parsing.
