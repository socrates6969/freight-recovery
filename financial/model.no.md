> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse, ikke juridisk/finansiell fagoversettelse. Ved avvik gjelder den engelske originalen. Juridisk og skattemessig innhold er utkast og må gjennomgås av advokat/rådgiver før bruk.

# Freight Recovery - Finansiell modell

> **Status: før produkt. Dette er et planleggingsskjelett, ikke en prognose.** Det finnes ingen inntekt, ingen kunde og ingen målt innkrevingsrate. **Hver inndata nedenfor er en ASSUMPTION (antakelse)** med mindre kilde og grad er oppgitt. Utdataene er aritmetiske konsekvenser av disse antakelsene. "$1B" vises bare som en regning av hva som måtte være sant, og er **ikke** lovet eller forventet. Ingen verdsettelser av sammenlignbare selskaper er hevdet her.
>
> Grader: A primær/revidert; B anerkjent sekundær; C blogg/leverandør/aggregator.

## 1. Enhetsøkonomi (per kunde, per år)

| Linje | Basis | Grunnlag |
|---|---|---|
| Kundens fraktkostnad (eksempel på avsendersiden) | $20M | ASSUMPTION (mellomstort segment) |
| Innkrevbare feil/uautoriserte tilleggsgebyrer | 1.0% av kostnad = $200K | ASSUMPTION; revisjonsleverandørers påstand er 1-3% (grad C), lav ende brukt |
| Suksesshonorar (contingency) | 20% | ASSUMPTION; 15-30% typisk ifølge leverandører (grad C) |
| **Inntekt per kunde (ACV)** | **$40K** | = 200K x 20% |
| Bruttomargin | 60% år 1-2, stigende til 70% år 5 | ASSUMPTION. AI-produkter rapportert med ~45-53% bruttomargin i 2025-26 (ICONIQ via SaaStr, grad A/B); menneskelig gjennomgang i løkken er den svingende faktoren. Umålt for oss. |
| Bruttofortjeneste per kunde (ved 65%) | ~$26K | |
| Blandet CAC per kunde (år 3+) | $25K | ASSUMPTION; grunderdrevet salg tidlig er billigere, men kan ikke skaleres |
| CAC-tilbakebetaling | ~12 måneder på bruttofortjeneste, pluss ~3-4 måneders forsinkelse i innkrevingssyklusen, altså ~15-16 måneder | Utledet; offentlig median for private SaaS er ~18-20 måneder (KeyBanc/Benchmarkit, grad B/C) |
| Frafall av kunder (logo churn) | 20%/år basis (35% i bear) | ASSUMPTION; suksesshonorar kan slås av lett, eller være klebrig; ukjent |
| LTV (GP / frafall) | $26K / 0.20 = **$130K** (bear: $26K/0.35 = $74K) | Utledet |
| LTV:CAC | **5.2x** basis; 3.0x ved 35% frafall | Utledet. Tommelfingerregel for mål er 3x+ (grad C). Behandle 5.2x som optimistisk: det hviler på at antakelsen om 1% innkreving er reell. |

**Følsomheten som betyr mest:** innkrevbar % av kostnad. Ved 0.5% i stedet for 1.0% halveres ACV til $20K og hele modellen trenger dobbelt så mange kunder. Virksomhetens første oppgave er å måle dette tallet på en partners avsluttede saker.

**Forbehold om inntektskvalitet:** inntekter fra suksesshonorar er variable og forsinkede. Investorer betaler vanligvis mindre for dem enn for kontraktsfestet abonnements-ARR. Avsnitt 4 viser verdsettelsen begge veier. Planen er å gå over til hybrid plattformavgift pluss suksesshonorar så snart kundene aksepterer det.

**Kunder på transportørsiden** (ikke modellert separat) vil ha lavere ACV (mindre detention-volum) og lavere CAC hvis de selges gjennom kanaler. Ikke nok informasjon til å modellere; vent til etter discovery.

## 2. Femårs inntektsbygg (tre scenarier)

Metode: inntekt = gjennomsnittlig antall kunder i året x ACV (år 1 x0.5 for pilotoppstart). "Run-rate" = kunder ved årsslutt x ACV, ARR-ekvivalenten som brukes i verdsettelsesregningen.

### Basisscenario (ACV $40K)

| | År 1 | År 2 | År 3 | År 4 | År 5 |
|---|---|---|---|---|---|
| Betalende kunder ved årsslutt (ASSUMPTION) | 5 | 25 | 80 | 180 | 330 |
| Inntekt | $0.05M | $0.60M | $2.10M | $5.20M | $10.20M |
| Run-rate ved årsslutt | $0.20M | $1.00M | $3.20M | $7.20M | $13.20M |

### Bull-scenario (ACV $55K: større avsendere pluss nettverkseffekter hos transportører)

| | År 1 | År 2 | År 3 | År 4 | År 5 |
|---|---|---|---|---|---|
| Kunder ved årsslutt | 8 | 45 | 160 | 400 | 800 |
| Inntekt | $0.11M | $1.46M | $5.64M | $15.40M | $33.00M |
| Run-rate ved årsslutt | $0.44M | $2.48M | $8.80M | $22.00M | $44.00M |

### Bear-scenario (ACV $30K; tregere salg; lavere innkrevbar %)

| | År 1 | År 2 | År 3 | År 4 | År 5 |
|---|---|---|---|---|---|
| Kunder ved årsslutt | 2 | 8 | 20 | 40 | 65 |
| Inntekt | $0.02M | $0.15M | $0.42M | $0.90M | $1.58M |
| Run-rate ved årsslutt | $0.06M | $0.24M | $0.60M | $1.20M | $1.95M |

Bear er et utfall i livsstilsbedriftens størrelse og ville ikke støtte venturefinansiering utover seed; det er også scenariet der virksomheten bør stoppe eller pivotere (se triggere for stopp i `business/business-plan.md`).

## 3. Kapitalbehov

To metoder, vist side om side:

**(a) Bottom-up for seed (ASSUMPTIONS):** 4-5 personer (operatør/daglig leder, 2 ingeniører, frakt-/kundeansvarlig, deltids drift), fullt lastet ~$150K i snitt = ~$0.6-0.75M/år, pluss infrastruktur, modellbruk, juridisk, reise ~$0.15-0.25M/år. Omtrent $0.8-1.0M/år, altså ~$2.0-2.5M for 24-30 måneder. **Seed-mål: $2.0-3.0M**, dimensjonert for å nå ~$3M run-rate (omtrent 80 kunder, basis år 3), som er der en Serie A-samtale blir realistisk. Merk at den typiske Serie A-terskelen på $2-4M ARR (grad C) nås i basis år 3, ikke år 2; planlegg seed for 30 måneder eller regn med en brolån/bridge.

**(b) Top-down kontroll via burn multiple:** brent kapital er omtrent burn multiple x netto ny ARR. Burn multiple 1.5 er et "bra-til-OK"-nivå (benchmarks i grad C).

| Scenario | År 5 run-rate | Kapital ved 1.5x | Kommentar |
|---|---|---|---|
| Basis | $13.2M | ~$20M | Omtrent seed ~$2.5M + Serie A ~$10-14M (median Serie A for programvare $14.4M ved $80M post-money, Carta via sekundærkilde, grad B) + en liten B. Utvanning ~18% ved Serie A ifølge Carta (grad B). |
| Bull | $44M | ~$66M | Trenger Serie B og trolig C. |
| Bear | $1.95M | ~$4M ved 2.0x | Kun seed; stopper der. |

**Ingen arbeidskapital** er forutsatt fordi produktet ikke berører kundens penger (vi flytter ikke midler). Hvis et betalingslag legges til senere, endrer det bildet vesentlig.

Ikke-utvannende alternativer å undersøke (operatør basert i Norge): programmer hos Innovasjon Norge (Innovation Norway) og Forskningsrådet (Research Council of Norway). Ikke undersøkt i detalj; se `fundraising/README.md`.

## 4. Regnestykket fra ARR til verdsettelse

Verdsettelse = ARR x multippel. Brukerens planleggingsintervall er **8-15x ARR**. Referansepunkter (fra tidligere research, `scratchpad`-notater, grad A/B/C som oppgitt der): offentlig median for skyprogramvare ~4.1x EV/NTM-inntekt i jan. 2026 (Clouded Judgement, grad A); offentlige selskaper med >22% vekst ~12.4x (A); en "planleggings"-regel for sterke AI-apper på 8-15x og anstendige på 5-8x var vår egen syntese; overskriftsmultiplene "10-50x" kommer fra heite selskaper og SEO-blogger (grad C) og er **ikke** brukt.

### Verdsettelse av run-rate i år 5 per scenario

| Scenario | År 5 run-rate | ved 8x | ved 15x | Rabattert syn: 4-6x (suksesshonorar behandlet som variabel inntekt) |
|---|---|---|---|---|
| Basis | $13.2M | $106M | $198M | $53M-$79M |
| Bull | $44.0M | $352M | $660M | $176M-$264M |
| Bear | $1.95M | $16M | $29M | ikke meningsfullt; 8x+ er urealistisk i denne størrelsen eller veksten |

Viktig: 8-15x er bare forsvarlig for vekstselskaper med høy vekst, 70%+ bruttomargin og sterk netto inntektsbevaring. Et basisselskap som vokser ~80% i år 5 med en suksesshonorarmodell fortjener den lave enden eller lavere. Ta kolonnen med rabatt som minst like sannsynlig som kolonnen med 8-15x.

### Hva ville $1B kreve? (hva som måtte være sant, ikke en prognose)

| Multippel | ARR som trengs | Kunder ved $40K | Kunder ved $55K |
|---|---|---|---|
| 8x | $125M | 3,125 | 2,273 |
| 15x | $66.7M | 1,667 | 1,212 |

Selv bull-scenariet ($44M run-rate i år 5) når ikke $1B ved 15x ($660M). **Basisscenariet kommer ikke i nærheten av $1B.** Et $1B-utfall ville kreve at suksesshonorarkilen utvides til en bredere plattform for fraktkostnader (betalinger, TMS-nært eller nettverkseffekter) med tusenvis av kunder. Den ærlige planleggingsholdningen: bygg en varig, lønnsom nisjevirksomhet som også er et attraktivt oppkjøpsmål; behandle alt større som oppside.

### Realitetssjekk av grunderes eierandel (ESTIMAT, grad B/C)

Mediantall rapportert av Carta antyder grunderes eierandel på ~56% etter seed, ~36% etter A, ~27% etter B (grad C via aggregatorer). Et utfall på $200M med ~35% grunderandel er ~$70M brutto, før preferanser og skatt, og fordelt mellom grunderne. Betydelig, men ikke et $1B-utfall.

## 5. Oppsummering basis / bull / bear

| | Basis | Bull | Bear |
|---|---|---|---|
| Nøkkelantakelse | 1.0% innkreving, 20% honorar, ACV $40K | større kunder, ACV $55K, nettverkseffekter | 0.75% eller mindre innkreving, ACV $30K, tregt salg |
| År 5 run-rate ved årsslutt | $13.2M | $44.0M | $1.95M |
| Kapital for å komme dit | ~$20M | ~$66M | ~$4M |
| Verdi ved 8-15x (før rabatt) | $106M-$198M | $352M-$660M | $16M-$29M (urealistisk) |
| Hva det betyr | Sterk nisjevirksomhet eller oppkjøpskandidat | Kategorileder; $1B fortsatt ikke nådd | Stopp eller pivoter etter seed |

## 6. Hva denne modellen ikke vet (og de første målingene)

1. Reell innkrevbar % av kostnad / fakturert detention (mål på designpartneres avsluttede saker).
2. Reell vinnerate og syklustid for tvister.
3. Reell kostnad per krav (inferens pluss menneskelig gjennomgang) og dermed bruttomargin.
4. Antall kunder som kan nås i målsegmentet.
5. Om kunder aksepterer suksesshonorar, hybrid eller ingen av delene.

Inntil 1-3 er målt, bør dette dokumentet bare vises som et rammeverk, merket "antakelser, ikke prognose".

## Use of Funds (seed raise) – Bruk av midler (seed-runde)

Seed-midlene brukes i denne prioriterte rekkefølgen. Virksomheten er før produkt, så de første dollarne kjøper verifisering og bevis, ikke vekst.

**1. Uavhengig tredjeparts sikkerhetsrevisjon + penetrasjonstest** (SOC 2-beredskap). Begrunnet av vår egen interne førrevisjon, som fant en ReDoS-tjenestenektsårbarhet, manglende autentisering/tenant-isolasjon og hull i inndatavalidering (nå delvis utbedret); uavhengig verifisering pluss herding av autentisering/persistens er påkrevd før noen reelle kundedata.

**2. Ekstern juridisk og compliance-rådgivning** — en autorisert norsk advokat for selskapsstruktur og kontrakter, pluss rådgiver for kommersielle kontrakter (frakt har lavere regulatorisk belastning, men kundekontrakter og konfidensielle satsdata må gjennomgås).

**3. Designpartnerdata og validering** — milepæl nr. 1: skaffe en designpartners reelle avsluttede saker for å MÅLE nøyaktighet i innkreving før vi skalerer (gjør våre illustrative/umålte tall om til en etterprøvbar innkrevingsrate).

**4. Produkthardening** (autentisering, multitenancy, persistens, reelle TMS-/EDI-integrasjoner) og innledende go-to-market.
