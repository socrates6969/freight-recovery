> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse, ikke juridisk/finansiell fagoversettelse. Ved avvik gjelder den engelske originalen. Juridisk og skattemessig innhold er utkast og må gjennomgås av advokat/rådgiver før bruk.

# Freight Recovery - Forretningsplan

> **Status: før produkt, før inntekt, null kunder.** Ingenting nedenfor er validert på reelle kundedata. Hvert tall er enten (a) sitert med en grad, eller (b) merket ASSUMPTION (antakelse). "$1B" er en regneøvelse for et tak-scenario (se `financial/model.md`), ikke et løfte eller en prognose.
>
> Kildegrader: **A** = primær/revidert/regulatorisk; **B** = anerkjent sekundær dekning av en primærkilde; **C** = leverandør/aggregator/blogg (kun veiledende).
> Researchnotat: budsjettet for live nettsøk var brukt opp før dette dokumentet ble ferdigstilt. Siterte tall kommer fra tidligere research i dette prosjektet (2026-10-05). ATRIs primær-PDF har **ikke** vært åpnet av oss. Verifiser på nytt før noe tall legges frem for en investor.

## 1. Problem

Frakt går med tynne marginer og løs dokumentasjon. Når en lastebil venter ved rampen utover fritiden, har transportøren krav på **detention** (ventetidsgebyr); når noe ekstra skjer (lumper, layover, redelivery, reweigh, TONU, liftgate), har transportøren krav på et **tilleggsgebyr (accessorial)**. Disse gebyrene blir ofte aldri fakturert, fakturert uten bevis, bestridt per e-post, eller betalt for sent eller delvis. Bevisene er spredt: ratebekreftelse, BOL, avtaletid, tidsstempler fra port/ELD/geofence, e-poster.

### Tallene for lekkasje

| Påstand | Tall | Kilde | Grad | Forbehold |
|---|---|---|---|---|
| Årlig kostnad av sjåfør-detention for amerikansk lastebiltransport | **$15.1B/år** ($11.5B tapt produktivitet + $3.6B ekstra utgifter) | ATRI driver-detention-studie, sept. 2024, via truckinginfo.com og Land Line-dekning | **B** (A hvis ATRI-primærkilden bekrefter; vi har sett sekundær dekning) | Dette er *kostnaden ved å vente*, mest tapt produktivitet. Det er **ikke** en pott av innkrevbare dollar. Bare den fakturerbare, ubetalte delen er adresserbar. |
| Andel stopp som involverer detention | 39.3% | samme | B | |
| Flåter som tar betalt for detention | 94.5% | samme | B | |
| Detention-fakturaer som faktisk blir betalt | **under halvparten** | samme | B | Eksakt betalt-prosent er ikke verifisert fra primærkilden. |
| Feilrate på fraktfakturaer | "1-9% av fakturaverdi; 10-25% av fakturaene" | blogger fra revisjonsleverandører (Shipware, Nuvocargo, andre) | **C** | Solgt av dem som selger revisjoner. Ikke bruk som fakta i et deck. |
| Uavhentede pakkerefusjoner ">$2B" | n/d | leverandørblogger | **C** | Pakker, ikke vår kile. Ignorer. |

**Ærlig lesning.** Det eneste solide ankeret er ATRI. Den riktige påstanden er: *detention er en svært stor, godt dokumentert kostnad, og transportørene får inn under halvparten av detention de fakturerer.* Det riktige neste steget er **ikke** å gange $15.1B med en prosent og kalle det et marked. Det er å måle, på én partners avsluttede saker, hvilken andel av fakturerbar detention og tilleggsgebyrer som ble ufakturert, ubetalt eller underbetalt, og hvilken andel av dette som kan vinnes med bevis.

## 2. Hvem har problemet (målkunde)

De etablerte aktørene (Cass, Trax, CTSI-Global, Intelligent Audit og lignende firmaer for fraktrevisjon og -betaling) er bygget for store avsendere med høye årlige fraktkostnader, EDI/TMS-integrasjoner og innkjøpsstyrt kjøpsprosess. Den lange halen er underbetjent:

1. **Mellomstore avsendere** (ASSUMPTION: omtrent $5M-$50M i årlige fraktkostnader). For små for et stort FAP-program, store nok til at feil i tilleggsgebyrer og uautoriserte gebyrer er reelle penger. Smerte: de betaler transportørfakturaer med uautoriserte eller udokumenterte tilleggsgebyrer og kan ikke bestride i stor skala.
2. **Små og mellomstore transportører** (ASSUMPTION: 5-100 lastebiler; eierdrevne enkeltbiler (owner-operators) holdes utenfor i starten). Smerte: de fakturerer detention/tilleggsgebyrer manuelt, setter ikke sammen bevis og avskriver pengene.

Hvorfor begge sider: detention er en tosidig tvist. Et verktøy på avsendersiden forsvarer mot svake krav; et verktøy på transportørsiden bygger sterke. **Beslutning som skal valideres i discovery:** start på én side. Arbeidshypotesen er først sammensetning av krav på transportørsiden (pengene er åpenbart skyldt og bevispakken er produktet), deretter revisjon på avsendersiden. Dette er en hypotese, ikke et funn.

## 3. Produkt

En agentassistert pipeline som, for hver last:
- **Leser inn** dokumenter (ratebekreftelse, BOL/POD, tilleggsgebyrfaktura, e-poster) og, senere, tidsstempler fra telematikk-/synlighetsfeeder.
- **Trekker ut** strukturerte felt (avtaletid, ankomst, avgang, fritid, sats, tilleggsgebyrklausuler).
- **Anvender regler** som tolker kontrakts-/ratebekreftelsesspråket for å avgjøre rett til krav og beløp.
- **Setter sammen bevispakken** (tidslinje, kildehenvisninger, kontraktsklausul) og et sendeklart krav/faktura.
- **Sporer** frister, oppfølginger, tvister og utfall, med et **menneskelig godkjenningssteg** før noe forlater huset.

Se `technical/overview.md`. Eksplisitte ikke-mål for v1: flytting av penger (unngår problemer med pengeoverføring og bankpartnere), megling av frakt, maskinvare.

## 4. Prising: suksesshonorar, med vei mot SaaS

- **Fase 1 (designpartnere / piloter): rent suksesshonorar.** En prosentandel av dollar som faktisk er innkrevd, null hvis ingenting er innkrevd. Fjerner kjøperens risiko, noe som er viktig for en uprøvd leverandør. ASSUMPTION: 15-30% er det revisjonsfirmaer vanligvis tar (oppgitt av leverandører, grad C); vi modellerer **20%**.
- **Fase 2: hybrid.** Liten plattformavgift pluss lavere suksesshonorar (ASSUMPTION: $1-2K/måned + ~10-12%). Gir den inntektsforutsigbarheten investorer verdsetter.
- **Fase 3: SaaS-nivå** for kunder som vil ha selvbetjent verktøy for eget team, priset etter antall behandlede laster.

**Ærlig forbehold.** Inntekter fra suksesshonorar er variable og forsinkede (innkrevingssykluser tar uker til måneder), og investorer verdsetter dem med rabatt i forhold til kontraktsfestet ARR. Det er en mekanisme for kundeanskaffelse, ikke et mål. Bruttomarginen avhenger av hvor mye menneskelig gjennomgang hvert krav trenger; det er umålt i dag.

## 5. Go-to-market

1. **Designpartnere (måned 0-4).** Rekruttere 3-5 transportører eller mellomstore avsendere som vil gi oss **avsluttede historiske saker** (skrivebeskyttet, under NDA). Leveranse: en lekkasjerevisjon på deres egne data: "her er det som ble liggende igjen, og det vi kunne ha krevd inn". Intet programvaresalg; dette er valideringen.
2. **Piloter med suksesshonorar (måned 4-10).** Kjøre live på nye krav med menneskelig godkjenning. Målte utdata: innkrevingsrate, innkrevde dollar, tid per krav, kostnad per krav. Gjøre pilotdataene om til den første referansesaken.
3. **Land and expand (måned 10+).** Lande på ett kjørefelt/én terminal/ett kundesett, utvide til alle laster, legge til den andre siden (revisjon på avsendersiden for de samme relasjonene), og deretter legge til integrasjoner (TMS/ELD) som reduserer friksjon ved onboarding. Kanaler å teste: fraktforeningsmiljøer, TMS-/ELD-markedsplasser, faktoringpartnere for transportører. Alt er hypoteser.

**Ærlighet om salgsarbeidet:** transportører har lave programvarebudsjetter og lite tid; suksesshonorar er riktig kile for dem. Avsendere kjøper saktere og vil ha integrasjoner. Grunderdrevet salg er nødvendig gjennom omtrent de første 20 kundene.

## 6. Milepæler (styrt av bevis, ikke kalender)

| Port | Påkrevd bevis | Trigger for stopp/pivot |
|---|---|---|
| G0: Eval-sett | 100+ reelle eller realistiske detention-/tilleggsgebyrsaker med fasit for rett til krav | Kan ikke sette sammen et gullsett |
| G1: Lekkasje påvist | Én designpartners avsluttede saker viser vesentlige, bevisunderbygde ikke-innkrevde dollar | Den innkrevbare delen er triviell (ASSUMPTION-terskel: under ~0.25% av fraktkostnader på avsendersiden, eller svært få vinnbare detention-hendelser per 100 laster på transportørsiden) |
| G2: Pipelinekvalitet | Målt pass^k på eval-settet over en terskel satt på forhånd (se teknisk dokument); null hallusinerte henvisninger | Verifikatoren kan ikke gjøres pålitelig |
| G3: Betalte piloter | 3+ kunder på suksesshonorar, menneskelig godkjent, innkrevingsrate målt | Kunder vil ikke dele data eller vil ikke betale honoraret |
| G4: Repeterbarhet | 10+ kunder, målt CAC og tilbakebetalingstid, observert frafall | CAC-tilbakebetaling langt over 24 måneder |
| G5: Kapitalinnhenting | Først nå presenteres traksjon; seed-deck som kun bygger på målte resultater | - |

## 7. Hovedrisikoer (se også README)

- **Innkrevbar pott mindre enn overskriften.** Tiltak: mål først.
- **Etablerte aktører går ned i markedet** eller legger til moduler for tvisthåndtering av tilleggsgebyrer. Tiltak: hastighet, fokus på den lange halen, data om tvistutfall.
- **Datatilgang** (TMS/ELD-integrasjon) er det virkelig vanskelige problemet, ikke AI-en.
- **Kunderelasjonsrisiko:** transportører som purrer avsendere de er avhengige av, kan nøle. Menneskelig godkjenning og kundekontrollerte sendeinnstillinger er påkrevd.
- **Betaling/regulatorisk:** hold deg unna pengeflytting og megling til juridisk rådgiver bekrefter.
- **Grunder-/markedstilpasning:** ingen på teamet er identifisert med domeneerfaring fra fraktrevisjon; se `hiring/README.md`.

## 8. Bruk av midler

Seed-midlene fordeles på uavhengig sikkerhetsrevisjon, ekstern juridisk rådgivning, validering av designpartnerdata og produkthardening, i denne prioriterte rekkefølgen. Se avsnittet "Use of Funds (seed raise)" i `financial/model.md`.
