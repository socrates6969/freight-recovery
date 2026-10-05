> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse, ikke juridisk/finansiell fagoversettelse. Ved avvik gjelder den engelske originalen. Juridisk og skattemessig innhold er utkast og må gjennomgås av advokat/rådgiver før bruk.

# Freight Recovery - Markedsanalyse

> **Status: før produkt.** Størrelsesanslag er veiledende. Beskrivelsene av konkurrentene er karakteristikker fra generell kunnskap og tidligere research på leverandørsider, **ikke** verifisert i denne økten (budsjettet for live søk var brukt opp). Verifiser før ekstern bruk. Grader: A primær/revidert, B anerkjent sekundær, C leverandør/aggregator.

## 1. Markedsstørrelse (den ærlige versjonen)

### Top-down-tall og hvorfor de villeder

| Tall | Verdi | Kilde | Grad | Bruk det til |
|---|---|---|---|---|
| Kostnad av detention for amerikansk lastebiltransport | $15.1B/år | ATRI sept. 2024 via fagpresse | B | Viser problemets omfang. **Ikke** en inntekts-TAM. |
| Marked for fraktrevisjon og -betaling (FAP) | ~$3.1B, ~6.8% vekst | markedsrapport / leverandørblogger | **C** | Grov størrelsesorden for markedet for *etablerte tjenester*. Metode ukjent. Ikke siter som fakta. |
| Feilrate på fraktfakturaer | 1-9% av kostnad | revisjonsleverandører | **C** | Markedsføringstall fra dem som selger revisjoner. |

**Forbeholdet om leverandørtall.** De mest siterte tallene i denne kategorien (feilprosent på fakturaer, FAP-markedsstørrelse, "milliarder uavhentet") kommer fra selskaper som selger revisjonstjenester eller markedsrapporter. De er oppblåst av insentiver og viser sjelden metode. Bare ATRI-studien om detention er et troverdig tredjepartsanker, og selv den måler kostnad, ikke innkrevbar inntekt.

### Bottom-up (den eneste versjonen verdt å forsvare)

Inntekt = kunder x (fraktkostnad eller detention-fakturering per kunde) x innkrevbar % x honorar %.

Gjennomregnet eksempel, **alle inndata er ASSUMPTIONS, ingen er målt**:
- Mellomstor avsender, $20M i årlige fraktkostnader.
- Innkrevbare uautoriserte/udokumenterte tilleggsgebyrer og feil: 1.0% av kostnad = $200K/år (revisjonsbransjens påstand på 1-3% er grad C; vi tar den lave enden).
- Honorar på 20% gir **$40K i inntekt per kunde per år**.

Ved $40K/kunde: 250 kunder = $10M; 2,500 kunder = $100M. Det relevante spørsmålet er ikke "hvor stort er $15.1B", men "hvor mange kunder finnes, kan vi nå dem, og er 1% reelt". **Antallet amerikanske mellomstore avsendere og små transportører i målsegmentet er ikke kildebelagt ennå; skal størrelsesberegnes fra FMCSAs transportørregister og avsenderdatabaser (TODO).**

**Ærlig lesning:** et reelt, men beskjedent marked for et frittstående selskap. Titalls millioner i ARR er plausibelt i et godt scenario; hundrevis av millioner krever tusenvis av kunder. Mer sannsynlig en sterk nisjevirksomhet eller et oppkjøpsmål enn et frittstående $1B-selskap.

## 2. Konkurrentgjennomgang

| Selskap | Hva det er (karakteristikk, verifiser) | Kundefokus | Modell | Gap i forhold til oss |
|---|---|---|---|---|
| **Cass Information Systems** | Børsnotert selskap; revisjon og betalingsbehandling av fraktfakturaer, bankaffiliert | Store avsendere | Behandlingsgebyrer / betalingsøkonomi | Fokus på store virksomheter og betaling; den lange halen og automatisering av tvister om tilleggsgebyrer er ikke i fokus |
| **Trax Technologies** | Global styring av transportkostnader og fraktrevisjon (leverandøren oppgir ~$24B behandlet transportkostnad, grad C) | Store virksomheter, multinasjonale | Programvare + forvaltet tjeneste | Tung integrasjon for store virksomheter; økonomien for mellomstore er uklar |
| **CTSI-Global** | Fraktrevisjon/-betaling og forvaltede logistikktjenester | Mellomstore til store avsendere | Tjenestedrevet | Tjenestemodell; kostnad ved å betjene små kunder er høy |
| **Intelligent Audit** | Fraktrevisjon og -betaling, pris-/kravtjenester | Avsendere inkl. mellomstore | Revisjonshonorarer / programvare pluss tjeneste | Fokus på matching mot kontraktssatser; rotete bevis for tilleggsgebyrer er fortsatt manuelt |
| **Loop** | AI-nativ automatisering av fraktfaktura/revisjon | Avsendere/3PL-er (avsendersiden) | SaaS | Nærmeste AI-native konkurrent; største trussel hvis den går til transportørsiden eller inn i tvistearbeidsflyten. Finansiering og traksjon er ikke verifisert. |
| *Tilstøtende:* **project44, FourKites** | Sanntidssynlighet i transport | Avsendere, transportører, meglere | Plattformabonnement | De sitter på **tidsstemplene** som beviser detention; de selger synlighet, ikke innkreving. Potensiell partner, datakilde, oppkjøper og, hvis de legger til en modul for detention-krav, konkurrent. |
| *Tilstøtende:* TMS-innebygd revisjon (Oracle, Blue Yonder, MercuryGate) | Revisjon som TMS-funksjon | TMS-kunder | Bundlet | Godt nok for TMS-brukere; svakt for transportører og avsendere uten TMS |

Mønster: de eldre FAP-firmaene er gode til å matche fakturaer mot kontraktssatser. De **avgjør ikke** den rotete tvisten om tilleggsgebyrer (innsamling av bevis, frem og tilbake, frister) og betjener ikke små transportører. AI-native aktører som Loop er på avsendersiden og rettet mot mellomstore til store kunder.

## 3. Hvor den forsvarbare kilen er (og hvor den ikke er)

**Plausibel kile:**
1. **Bevispakke og tvisteflyt for detention/tilleggsgebyrer**, som betjener transportører og mellomstore avsendere som de etablerte aktørenes kostnad ved å betjene utelukker.
2. **Uttrekk av kontraktsspråk** til maskinlesbare regler for tilleggsgebyrer (de etablertes regelbaser er stort sett håndkodet). Blir bedre for hver kontrakt som leses inn.
3. **Proprietære data om tvistutfall:** hvilke krav, med hvilke bevis, mot hvilke motparter, som faktisk blir betalt. Dette bygger seg opp og er vanskelig å kopiere raskt, men finnes først etter reelt volum.
4. **Prising med suksesshonorar** samordner insentiver og reduserer salgsfriksjon i det underbetjente segmentet.

**Ikke forsvarbart alene:** LLM-uttrekk fra dokumenter (vare), et brukergrensesnitt eller en regelmotor. En finansiert konkurrent kan bygge disse på måneder.

**Ærlige trusler:** (a) etablerte aktører eller Loop går ned i markedet eller legger til tvistemoduler; (b) synlighetsplattformer (project44, FourKites) produktifiserer detention-krav med egne tidsstempler; (c) friksjon i datatilgang gjør den lange halen dyr å ta inn; (d) kunder tar arbeidet internt når de har sett formatet på bevispakken.

**Mottrekk:** være det nøytrale bevislaget som integrerer med synlighets- og TMS-leverandører i stedet for å bekjempe dem; bygge på data om tvistutfall; holde seg rask og smal.

## 4. Sannsynlige oppkjøpere (spekulativt; ingen kunngjort intensjon)

Cass, Trax, Descartes, project44, FourKites, Trimble, TMS-leverandører, store meglere og betalingsplattformer. Dette følger kun tilstøtningslogikk. Behandle det som en hypotese om exit-veier, ikke en plan.
