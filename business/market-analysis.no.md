> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse, ikke juridisk/finansiell fagoversettelse. Ved avvik gjelder den engelske originalen ([market-analysis.md](market-analysis.md)). Juridisk og skattemessig innhold er utkast og må gjennomgås av advokat/rådgiver før bruk.

# Freight Recovery - markedsanalyse

> **Status: før produkt.** Størrelsesestimater er retningsgivende. Konkurrentbeskrivelsene er karakteristikker fra generell kunnskap og tidligere research på leverandørsider, **ikke** verifisert i denne økten (budsjettet for live søk var oppbrukt). Verifiser før ekstern bruk. Grader: A primær/revidert, B anerkjent sekundær, C leverandør/aggregator.

## 1. Markedsstørrelse (ærlig versjon)

### Topp-ned-tall og hvorfor de villeder

| Tall | Verdi | Kilde | Grad | Bruk det til |
|---|---|---|---|---|
| Detention-kostnad for amerikansk lastebiltransport | $15.1B/år | ATRI sept. 2024 via fagpresse | B | Viser problemets omfang. **Ikke** et inntekts-TAM. |
| Marked for fraktrevisjon og betaling (FAP) | ~$3.1B, ~6,8 % vekst | markedsrapporter / leverandørblogger | **C** | Grov størrelsesorden for markedet for *etablerte tjenester*. Metode ukjent. Ikke sitér som fakta. |
| Feilrate på fraktfakturaer | 1-9 % av forbruk | revisjonsleverandører | **C** | Markedsføringstall fra dem som selger revisjoner. |

**Forbeholdet om leverandørtall.** De mest siterte tallene i denne kategorien (feilprosent på fakturaer, FAP-markedsstørrelse, «milliarder uhevet») kommer fra selskaper som selger revisjonstjenester eller markedsrapporter. De er oppblåst av insentiver og viser sjelden metode. Kun ATRI-studien om detention er et troverdig tredjepartsanker, og selv den måler kostnad, ikke innkrevbar inntekt.

### Bunn-opp (den eneste versjonen verdt å forsvare)

Inntekt = kunder x (fraktforbruk eller detention-fakturering per kunde) x innkrevbar % x honorar %.

Regneeksempel, **alle inndata er ASSUMPTIONS, ingen målt**:
- Mellomstor avsender, $20M i årlig fraktforbruk.
- Innkrevbare uautoriserte/udokumenterte tilleggsgebyrer og feil: 1,0 % av forbruket = $200K/år (revisjonsbransjens påstand om 1-3 % er grad C; vi tar den lave enden).
- Honorar 20 % gir **$40K inntekt per kunde per år**.

Ved $40K/kunde: 250 kunder = $10M; 2 500 kunder = $100M. Det relevante spørsmålet er ikke «hvor stort er $15.1B» men «hvor mange kunder får plass, kan vi nå dem, og er 1 % ekte». **Antallet amerikanske mellomstore avsendere og små transportører i målbåndet er ikke kildebelagt ennå; skal anslås fra FMCSAs transportørregister og avsenderdatabaser (TODO).**

**Ærlig lesning:** et reelt, men beskjedent marked for et frittstående selskap. Titalls millioner i ARR er plausibelt i et godt scenario; hundrevis av millioner krever tusenvis av kunder. Mer sannsynlig en sterk nisjevirksomhet eller et oppkjøpsmål enn en frittstående $1B.

## 2. Konkurrentgjennomgang

| Selskap | Hva det er (karakteristikk, verifiser) | Kundefokus | Modell | Gap relativt til oss |
|---|---|---|---|---|
| **Cass Information Systems** | Børsnotert selskap; fraktfaktura-revisjon og betalingsbehandling, bankaffilert | Store avsendere | Behandlingsgebyrer / betalingsøkonomi | Enterprise- og betalingssentrert; den lange halen og automatisering av tilleggsgebyrtvister er ikke fokus |
| **Trax Technologies** | Global styring av transportutgifter og fraktrevisjon (leverandøren oppgir ~$24B behandlet transportforbruk, grad C) | Store foretak, multinasjonale | Programvare + forvaltet tjeneste | Tung enterprise-integrasjon; økonomien for mellomstore er uklar |
| **CTSI-Global** | Fraktrevisjon/-betaling og forvaltede logistikktjenester | Mellomstore til store avsendere | Tjenestedrevet | Tjenestemodell; kostnaden ved å betjene små kunder er høy |
| **Intelligent Audit** | Fraktrevisjon og betaling, pris-/kravtjenester | Avsendere inkl. mellomstore | Revisjonshonorarer / programvare pluss tjeneste | Fokus på matching mot kontraktssatser; rotete bevis for tilleggsgebyrer er fortsatt manuelt |
| **Loop** | AI-nativ automatisering av fraktfaktura/revisjon | Avsendere/3PL-er (avsendersiden) | SaaS | Nærmeste AI-native konkurrent; størst trussel hvis den går til transportørsiden eller inn i tvistearbeidsflyten. Finansiering og traction ikke verifisert. |
| *Tilgrensende:* **project44, FourKites** | Sanntids synlighet i transport | Avsendere, transportører, meglere | Plattformabonnement | De sitter på **tidsstemplene** som beviser detention; de selger synlighet, ikke innkreving. Potensiell partner, datakilde, oppkjøper og, hvis de legger til en detention-kravmodul, konkurrent. |
| *Tilgrensende:* TMS-innebygd revisjon (Oracle, Blue Yonder, MercuryGate) | Revisjon som TMS-funksjon | TMS-kunder | Bundlet | Godt nok for TMS-brukere; svakt for transportører og avsendere uten TMS |

Mønster: tradisjonelle FAP-firmaer matcher fakturaer mot kontraktssatser godt. De **avgjør ikke** den rotete tilleggsgebyrtvisten (bevissammenstilling, frem og tilbake, frister) og betjener ikke små transportører. AI-native aktører som Loop er på avsendersiden og rettet mot mellomstore til store kunder.

## 3. Hvor den forsvarbare kilen er (og hvor den ikke er)

**Plausibel kile:**
1. **Bevispakke og tvistearbeidsflyt for detention/tilleggsgebyrer**, som betjener transportører og mellomstore avsendere som de etablerte aktørenes kostnad ved å betjene utelukker.
2. **Uthenting av kontraktsspråk** til maskinlesbare regler for tilleggsgebyrer (de etablertes regelbaser er stort sett håndkodet). Forbedres for hver kontrakt som innhentes.
3. **Proprietære data om tvisteutfall:** hvilke krav, med hvilket bevis, mot hvilke motparter, som faktisk blir betalt. Dette bygger seg opp og er vanskelig å kopiere raskt, men finnes først etter reelt volum.
4. **Suksesshonorar** samordner insentivene og senker salgsfriksjonen i det underbetjente segmentet.

**Ikke forsvarbart i seg selv:** LLM-dokumentuthenting (vare), et brukergrensesnitt eller en regelmotor. En finansiert konkurrent kan bygge disse på måneder.

**Ærlige trusler:** (a) de etablerte aktørene eller Loop går ned i markedet eller legger til tvistemoduler; (b) synlighetsplattformer (project44, FourKites) produktifiserer detention-krav med egne tidsstempler; (c) datatilgangsfriksjon gjør den lange halen dyr å onboarde; (d) kunder tar arbeidet internt når de har sett bevispakkeformatet.

**Mottrekk:** vær det nøytrale bevislaget som integrerer med synlighets- og TMS-leverandører i stedet for å kjempe mot dem; bygg på data om tvisteutfall; hold deg rask og smal.

## 4. Sannsynlige oppkjøpere (spekulativt; ingen kunngjort intensjon)

Cass, Trax, Descartes, project44, FourKites, Trimble, TMS-leverandører, store meglere og betalingsplattformer. Dette følger kun tilgrensningslogikk. Behandle det som en hypotese om exit-veier, ikke en plan.
