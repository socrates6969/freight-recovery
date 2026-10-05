> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse, ikke juridisk/finansiell fagoversettelse. Ved avvik gjelder den engelske originalen ([business-plan.md](business-plan.md)). Juridisk og skattemessig innhold er utkast og må gjennomgås av advokat/rådgiver før bruk.

# Freight Recovery - forretningsplan

> **Status: før produkt, før inntekt, null kunder.** Ingenting nedenfor er validert på reelle kundedata. Hvert tall er enten (a) sitert med en grad, eller (b) merket ASSUMPTION (antakelse). «$1B» er en regneøvelse for et tak-scenario (se `financial/model.md`), ikke et løfte eller en prognose.
>
> Kildegrader: **A** = primær/revidert/regulatorisk; **B** = anerkjent sekundær dekning av en primærkilde; **C** = leverandør/aggregator/blogg (kun retningsgivende).
> Researchmerknad: budsjettet for live nettsøk var oppbrukt før dette dokumentet ble ferdigstilt. Siterte tall stammer fra tidligere research i dette prosjektet (2026-10-05). ATRI-primær-PDF-en er **ikke** åpnet av oss. Verifiser alle tall på nytt før noe legges frem for en investor.

## 1. Problem

Frakt går med tynne marginer og løs papirflyt. Når en lastebil venter ved en rampe utover fri tid, har transportøren krav på **detention** (ventetid); når noe ekstra skjer (lumper, layover, omlevering, ny veiing, TONU, liftgate), har transportøren krav på et **accessorial** (tilleggsgebyr). Disse gebyrene blir ofte aldri fakturert, fakturert uten bevis, bestridt per e-post, eller betalt for sent eller delvis. Beviset er spredt: rate confirmation, BOL, avtaletidspunkt, port-/ELD-/geofence-tidsstempler, e-poster.

### Lekkasjetallene

| Påstand | Tall | Kilde | Grad | Forbehold |
|---|---|---|---|---|
| Årlig kostnad av sjåførenes detention for amerikansk lastebiltransport | **$15.1B/år** ($11.5B tapt produktivitet + $3.6B ekstra utgifter) | ATRI-studie om sjåførdetention, sept. 2024, via truckinginfo.com og Land Line-dekning | **B** (A hvis ATRI-primærkilden bekrefter; vi så sekundær dekning) | Dette er *kostnaden av å vente*, for det meste tapt produktivitet. Det er **ikke** en pott med innkrevbare dollar. Kun den fakturerbare, ubetalte delen er adresserbar. |
| Andel stopp som involverer detention | 39,3 % | samme | B | |
| Flåter som fakturerer detention | 94,5 % | samme | B | |
| Detention-fakturaer som faktisk betales | **under halvparten** | samme | B | Eksakt betalt-prosent er ikke verifisert mot primærkilden. |
| Feilrate på fraktfakturaer | «1-9 % av fakturaverdi; 10-25 % av regningene» | revisjonsleverandørers blogger (Shipware, Nuvocargo, andre) | **C** | Solgt av dem som selger revisjoner. Ikke bruk i et deck som fakta. |
| Uhevede pakkerefusjoner «>$2B» | n/d | leverandørblogger | **C** | Pakker, ikke vår kile. Ignorer. |

**Ærlig lesning.** Det ene solide ankeret er ATRI. Riktig utsagn er: *detention er en veldig stor, godt dokumentert kostnad, og transportører får inn under halvparten av detention de fakturerer.* Riktig neste steg er **ikke** å gange $15.1B med en prosent og kalle det et marked. Det er å måle, på én partners avsluttede saker, hvilken andel av fakturerbar detention og tilleggsgebyrer som ble ufakturert, ubetalt eller underbetalt, og hvilken andel av det som er vinnbar med bevis.

## 2. Hvem har problemet (målkunde)

De etablerte aktørene (Cass, Trax, CTSI-Global, Intelligent Audit og lignende firmaer for fraktrevisjon og betaling) er bygget for enterprise-avsendere med stort årlig fraktforbruk, EDI-/TMS-integrasjoner og innkjøpsledet kjøpsprosess. Den lange halen er underbetjent:

1. **Mellomstore avsendere** (ASSUMPTION: omtrent $5M-$50M i årlig fraktforbruk). For små for et stort FAP-program, store nok til at feil i tilleggsgebyrer og uautoriserte gebyrer er reelle penger. Smerte: de betaler transportørfakturaer med uautoriserte eller udokumenterte tilleggsgebyrer og kan ikke bestride i stor skala.
2. **Små og mellomstore transportører** (ASSUMPTION: 5-100 lastebiler; eierdrevne enkeltbiler utelatt til å begynne med). Smerte: de fakturerer detention/tilleggsgebyrer for hånd, setter ikke sammen bevis og avskriver pengene.

Hvorfor begge sider: detention er en tosidig tvist. Et verktøy på avsendersiden forsvarer mot svake krav; et verktøy på transportørsiden bygger sterke. **Beslutning som skal valideres i discovery:** start på én side. Arbeidshypotesen er å starte med kravsammenstilling på transportørsiden (pengene er åpenbart skyldt og bevispakken er produktet), og revisjon på avsendersiden som nummer to. Dette er en hypotese, ikke et funn.

## 3. Produkt

En agentassistert pipeline som, for hver last:
- **Ingester** dokumenter (rate confirmation, BOL/POD, tilleggsfaktura, e-poster) og senere tidsstempler fra telematikk-/synlighetsfeeder.
- **Ekstraherer** strukturerte felt (avtaletidspunkt, ankomst, avgang, fri tid, sats, tilleggsgebyrklausuler).
- **Anvender regler** som tolker kontrakts-/rate-con-språket for å avgjøre rett til krav og beløp.
- **Setter sammen bevispakken** (tidslinje, kildehenvisninger, kontraktsklausul) og et klart-til-sending krav/en faktura.
- **Følger opp** frister, oppfølginger, tvister og utfall, med et **menneskelig godkjenningssteg** før noe forlater huset.

Se `technical/overview.md`. Eksplisitte ikke-mål for v1: flytte penger (unngår pengeoverføringsregulering og bankpartnerproblemer), megle frakt, maskinvare.

## 4. Prising: suksesshonorar, med vei mot SaaS

- **Fase 1 (designpartnere / piloter): rent suksesshonorar.** En prosentandel av dollar som faktisk innkreves, ingenting hvis ingenting innkreves. Fjerner kjøperrisiko, som betyr noe for en uprøvd leverandør. ASSUMPTION: 15-30 % er det revisjonsfirmaer vanligvis tar (oppgitt av leverandører, grad C); vi modellerer **20 %**.
- **Fase 2: hybrid.** Lite plattformgebyr pluss lavere suksesshonorar (ASSUMPTION: $1-2K/måned plattform + ~10-12 %). Gir den inntektsforutsigbarheten investorer verdsetter.
- **Fase 3: SaaS-nivå** for kunder som vil ha selvbetjent verktøy for eget team, priset på behandlede laster.

**Ærlig forbehold.** Inntekt fra suksesshonorar er variabel og forsinket (innkrevingssykluser tar uker til måneder), og investorer verdsetter den med avslag mot kontraktfestet ARR. Det er en mekanisme for kundeanskaffelse, ikke et sluttmål. Bruttomarginen avhenger av hvor mye menneskelig gjennomgang hvert krav trenger; det er ikke målt i dag.

## 5. Go-to-market

1. **Designpartnere (måned 0-4).** Rekruttér 3-5 transportører eller mellomstore avsendere som gir oss **avsluttede historiske saker** (skrivebeskyttet, under NDA). Leveranse: en lekkasjerevisjon på deres egne data: «dette er hva som ble liggende igjen og hva vi kunne ha krevd inn». Ikke et programvaresalg; dette er valideringen.
2. **Pilot med suksesshonorar (måned 4-10).** Kjør live på nye krav med menneskelig godkjenning. Målte utdata: innkrevingsrate, innkrevde dollar, tid per krav, kostnad per krav. Gjør pilotdataene om til den første casestudien.
3. **Land and expand (måned 10+).** Land på én lane/terminal/kundegruppe, utvid til alle laster, legg til den andre siden (revisjon på avsendersiden for de samme relasjonene), og legg deretter til integrasjoner (TMS/ELD) som reduserer onboarding-friksjon. Kanaler å teste: fellesskap i fraktforeninger, TMS-/ELD-markedsplasser, faktoringpartnere for transportører. Alt er hypoteser.

**Ærlighet om salgsbevegelsen:** transportører har lave programvarebudsjetter og lite tid; suksesshonorar er riktig kile for dem. Avsendere kjøper tregere og vil ha integrasjoner. Gründerledet salg kreves gjennom omtrent de første 20 kundene.

## 6. Milepæler (styrt av bevis, ikke kalender)

| Port | Påkrevd bevis | Kill-/pivot-trigger |
|---|---|---|
| G0: Eval-sett | 100+ reelle eller realistiske detention-/tilleggsgebyrsaker med fasit for rett til krav | Kan ikke sette sammen et fasitsett |
| G1: Lekkasje bevist | Én designpartners avsluttede saker viser vesentlige, bevisstøttede uinnkrevde dollar | Den innkrevbare delen er triviell (ASSUMPTION-terskel: under ~0,25 % av fraktforbruk på avsendersiden, eller svært få vinnbare detention-hendelser per 100 laster på transportørsiden) |
| G2: Pipelinekvalitet | Målt pass^k på eval-settet ovenfor over en terskel satt på forhånd (se teknisk dokument); null hallusinerte henvisninger | Verifikatoren kan ikke gjøres pålitelig |
| G3: Betalte piloter | 3+ kunder på suksesshonorar, menneskelig godkjent, innkrevingsrate målt | Kunder vil ikke dele data eller vil ikke betale honoraret |
| G4: Repeterbarhet | 10+ kunder, målt CAC og tilbakebetalingstid, observert churn | CAC-tilbakebetaling langt over 24 måneder |
| G5: Kapitalinnhenting | Først nå legges traction frem; seed-deck kun basert på målte resultater | - |

## 6b. Prognoser (veikart)

Fremtidig funksjon, ikke en del av dagens tilbud: prognoser for etterspørsel/lane-volum for å hjelpe til med å prioritere innkrevingsarbeid (hvilke lanes og transportører som skal revideres først). En enkel sesongbasert baseline er implementert; et nevralt alternativ (neuralforecast) er valgfritt og ennå ikke validert. Det krever reelle historiske data med flere tidsserier fra designpartnere og blir ofte bare likt med enkle baselines, så vi gjør ingen påstand om treffsikkerhet og selger det ikke. Revurderes etter G2.

## 7. Nøkkelrisikoer (se også README)

- **Innkrevbar pott mindre enn overskriften.** Tiltak: mål først.
- **De etablerte aktørene går ned i markedet** eller legger til moduler for tilleggsgebyrtvister. Tiltak: fart, fokus på den lange halen, data om tvisteutfall.
- **Datatilgang** (TMS-/ELD-integrasjon) er det egentlige vanskelige problemet, ikke AI-en.
- **Kunderelasjonsrisiko:** transportører som purrer avsendere de er avhengige av kan nøle. Menneskelig godkjenning og kundestyrte sendeinnstillinger er påkrevd.
- **Betaling/regulatorisk:** hold deg unna pengeflytting og megling til jurist har bekreftet.
- **Gründer-/markedspasning:** ingen på teamet er identifisert med domeneerfaring innen fraktrevisjon; se `hiring/README.md`.

## 8. Bruk av midler

Seed-midler fordeles til uavhengig sikkerhetsrevisjon, ekstern juridisk rådgivning, validering av designpartnerdata og produkther­ding, i den prioriterte rekkefølgen. Se avsnittet «Use of Funds (seed raise)» i `financial/model.md`.
