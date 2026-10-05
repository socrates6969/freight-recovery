> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse, ikke juridisk/finansiell fagoversettelse. Ved avvik gjelder den engelske originalen ([seo-and-growth.md](seo-and-growth.md)). Juridisk og skattemessig innhold er utkast og må gjennomgås av advokat/rådgiver før bruk.
>
> **Omfang for oversettelsen:** kun dette dokumentet er oversatt. Landingssideskissen i `marketing/landing/` (`README.md`, `outline.md`, `calculator-spec.md`) og API-/utviklerportalsidene i `developer-portal/` forblir med vilje på **engelsk** (standard for API-/utviklerdokumentasjon og for nettstedtekster som skal publiseres på engelsk til et amerikansk marked). De er ikke oversatt her.

# Freight Recovery - plan for SEO, innhold og digital markedsføring (B2B)

> **Status: plan før produkt. Ingenting her er kjørt eller målt.** Det finnes ingen live nettside, ingen trafikk, ingen rangeringer, ingen leads og ingen kunder. Dette dokumentet inneholder **ingen tall for trafikk, rangering, konvertering eller inntekt**, og ingen bør legges til før de kommer fra en reell eksport fra analyseverktøy eller Search Console. «Volumer» for nøkkelord er med vilje latt stå tomme (`TBD: measure`) fordi vi ikke har verktøytilgang til å verifisere dem. Konkurrentkarakteristikker stammer fra `business/market-analysis.md` og er **ubekreftet**; kontroller dem før enhver offentlig sammenligningsside.
>
> Målgruppe for denne planen: gründeren/operatøren som driver go-to-market. Kjøpere: fraktintensive mellomstore avsendere (antatt ~$5M-$50M i årlig fraktforbruk) og små/mellomstore transportører (antatt 5-100 lastebiler). Se `business/business-plan.md`.

## 0. Hva denne planen er, og hva som må skje først

1. **Dette er en plan pluss grunnlag for on-page**, ikke en revisjon. Avsnitt 9 og `marketing/landing/` gir strukturen og tekstskissen for å bygge de første sidene riktig.
2. **En reell SEO-revisjon krever et live nettsted.** En revisjon i FITq-stil (eller enhver crawl-/Core Web Vitals-/indekserings-/schema-/AI-synlighetsrevisjon) måler en utrullet, crawlbar URL. Før et nettsted er live finnes det ingenting å crawle, ingen Search Console-eiendom, ingen indeksdekning, ingen feltytelsesdata og ingen tilstedeværelse i AI-svar å teste. Etter lansering kjøres revisjonen ved: uke 0 (baseline), etter at de første 10 sidene er lansert, og deretter kvartalsvis. Ikke dikt opp en baseline.
3. **SEO er ikke den første vekstspaken.** Forretningsplanens go-to-market starter med oppsøking av designpartnere (måned 0-4), fordi produktet er uvalidert. SEO og innhold er en langsom, akkumulerende kanal som (a) støtter troverdighet når en designpartner googler oss, og (b) bygger en eiendel som virker mens gründeren selger. Gjør de billige grunnleggende tingene tidlig; ikke bruk mye på innholdsvolum før en partner har bekreftet at lekkasjen er reell.
4. **Forutsetning for enhver påstand på nettstedet:** hvert tall på en side er enten sitert til en primærkilde med en grad (A/B/C som i forretningsplanen) eller merket som antakelse/illustrasjon. Ingen attester, logoer, «kunder», sparingsprosenter eller «AI-drevet»-superlativer vi ikke kan underbygge. Markedsføringspåstander om besparelser er en juridisk risiko og tillitsrisiko (amerikanske FTC-forventninger om underbygging; norsk/EU-forbruker- og markedsføringslovgivning gjelder også for B2B-villedende fremstilling). Få juridisk gjennomgang fra jurist før lansering.

## 1. Posisjonering for søk (hva vi ærlig kan si)

Kilen (fra planen): en agentassistert arbeidsflyt som setter sammen **bevispakken for detention/tilleggsgebyrer (accessorials)** og et UTKAST til krav, der et menneske godkjenner alt, for mellomstore avsendere og små transportører som de store fraktrevisjonsfirmaene betjener for dårlig. Suksesshonorar er den tiltenkte pilotmodellen.

Kan sies i dag: «Vi bygger et verktøy som gjør rate confirmation + BOL + faktura om til et dokumentert, etterprøvbart innkrevingskrav; vi søker designpartnere.» Kan ikke sies i dag: noen innkrevingsrate, noen sparte dollar, noe treffsikkerhetstall, «betrodd av», «SOC 2», «integrerer med <TMS/ELD>» (ingen integrasjon finnes).

## 2. Målgruppe og søkehensikt

| Persona | Rolle | Jobb som skal gjøres | Hvor de søker |
|---|---|---|---|
| Avsender, økonomi/AP- eller logistikksjef (mellomstor) | Betaler transportørfakturaer; vil slutte å betale uautoriserte tilleggsgebyrer | Verifisere detention-/tilleggsgebyrer mot rate confirmation og porttider | Google («detention charge dispute», «freight invoice audit»), LinkedIn, logistikkfellesskap |
| Transportøreier/disponent/fakturering (5-100 lastebiler) | Fakturerer detention/lumper/TONU for hånd, avskriver det ofte | Få betalt for detention med bevis | Google («detention invoice», «how to bill detention»), Facebook-grupper/forum, innhold fra lastebørser og faktoringselskaper |
| Leder for fraktrevisjon / 3PL / megler-drift | Kjøper eller bygger revisjonsverktøy; potensiell partner | Vurdere alternativer | Google («freight audit software alternatives»), LinkedIn, fagmedier |

Hensiktsstigen som skal dekkes: **problembevisst** (hva er detention, hvordan beregnes det) -> **løsningsbevisst** (hvordan bestride, hvordan revidere) -> **leverandørbevisst** (programvare, alternativer, prising) -> **beslutning** (suksesshonorarmodell, eksempel på bevispakke, sikkerhet).

## 3. Nøkkelordstrategi

Metode (reproduserbar): ta utgangspunkt i listene nedenfor; utvid med Google Search Console-spørringer (etter lansering), Google Keyword Planner (gratis med en Ads-konto), og en prøveperiode på et betalt verktøy for vanskelighetsgrad ved ønske; fang SERP-funksjoner og hvem som rangerer ved å lese toppresultatene manuelt. Registrer i et ark med kolonnene: `keyword | cluster | intent | monthly volume (source/date) | difficulty (source/date) | SERP owner types | target URL | status`. **Volumer og vanskelighetsgrad er TBD: measure.** Prioriter etter (kjøpshensikt x vår evne til å lage en genuint bedre side), ikke etter volum alene: B2B-nisjer har små volumer og de rette 50 spørringene betyr mer enn 5 000 generiske.

### Klynge A - Kjøpshensikt (pengesider; få, høy kvalitet)
| Startnøkkelord | Hensikt | Målside | Volum |
|---|---|---|---|
| freight detention recovery software / detention billing automation | Leverandørbevisst, transaksjonell | Produktside: Detention-innkreving | TBD: measure |
| freight accessorial audit software / accessorial charge audit | Leverandørbevisst | Produktside: Revisjon av tilleggsgebyrer (avsender) | TBD: measure |
| freight invoice audit for mid-market shippers / small shippers | Leverandørbevisst | Løsningsside: Mellomstore avsendere | TBD: measure |
| carrier detention billing software / detention invoice software for carriers | Leverandørbevisst | Løsningsside: Transportører | TBD: measure |
| contingency freight audit / freight audit pricing / freight audit cost | Beslutning | Side om pris/suksesshonorarmodell | TBD: measure |
| detention evidence packet / detention claim documentation | Beslutning | Eksempelside for bevispakke (eksempel på syntetiske data) | TBD: measure |

### Klynge B - Sammenligning og alternativer (kun når faktabasert og verifiserbart)
| Startnøkkelord | Hensikt | Målside | Merknader |
|---|---|---|---|
| Cass Information Systems alternatives / Trax alternatives / CTSI-Global alternatives / Intelligent Audit alternatives | Leverandørbevisst | «Freight audit alternatives for mid-market shippers» (ett nøytralt knutepunkt, ikke én side per rival til å begynne med) | Sammenlign kategorier og passform, ikke baktal. Konkurrentfakta må verifiseres fra deres egne offentlige sider i uken du publiserer, med datostempel. Ikke bruk konkurrenters varemerker misvisende eller antyd tilknytning. |
| freight audit software comparison / best freight audit software | Leverandørbevisst | Nøytral sammenligningsguide med sjekkliste over kriterier | Ta med rivaler ærlig, også der de er bedre (enterprise-skala, betalingsbehandling). Troverdighet er eiendelen. |
| freight audit vs. in-house audit / TMS audit module vs. dedicated | Løsningsbevisst | Beslutningsguide | |
| project44 / FourKites detention data alternatives | Løsningsbevisst | Guide om bevis­kilder (synlighetstidsstempler mot portlogger mot ELD) | Posisjoner som et utfyllende bevislag; de er potensielle partnere. |

### Klynge C - Problem og how-to (topp-/midtfunnel; opptjen lenker og tillit)
| Startnøkkelord | Hensikt | Målside |
|---|---|---|
| what is detention in trucking / detention vs. layover vs. TONU | Informasjonell | Ordlistehub + forklaringer |
| how to calculate detention pay / detention charge calculator | Informasjonell + verktøy | **Kalkulator (lead magnet, avsnitt 4)** |
| how to dispute accessorial charges (shipper) / how to dispute a detention charge | Informasjonell | Spillbok med sjekkliste |
| how to bill detention / detention invoice template / what proof do you need for detention | Informasjonell | Transportørguide + nedlastbar bevissjekkliste |
| lumper fee dispute / unauthorized accessorial charges freight | Informasjonell | Forklaring (kobler direkte til produktets regel om menneskelig gjennomgang) |
| detention free time, 2 hours / appointment time vs. arrival time detention clock | Informasjonell | Forklaring med gjennomregnet eksempel (bruker våre egne dokumenterte regelkonvensjoner) |
| freight invoice errors / common freight billing errors | Informasjonell | Forklaring; siter grad C-tall **som leverandørpåstander**, aldri som fakta |
| ATRI detention study findings | Informasjonell/nyhet | Sammendrag av primærkilden (åpne ATRI-PDF-en først; planen noterer at vi kun har sett sekundær dekning) |

### Klynge D - Dekning av entiteter/AI-svar
Sørg for at en presis, siterbar definisjon og et gjennomregnet eksempel finnes på nettstedet for: detention, accessorial, TONU, lumper, rate confirmation, evidence packet. Korte faktablokker med én primærkildehenvisning hver er det AI-svarmotorer og utvalgte utdrag (featured snippets) gjerne siterer. Mål AI-synlighet først etter lansering (manuelt promptpanel; ikke påstå resultater på forhånd).

## 4. Lead magnet: en reproduserbar besparelses-/innkrevingskalkulator

**Mål:** et gratis verktøy en kjøper kan bruke på to minutter som gir et *åpent estimat og regnestykket*, og deretter tilbyr en kostnadsfri lekkasjegjennomgang på deres egne avsluttede saker (designpartner-bevegelsen). Det må være ærlig ved konstruksjon.

Designregler:
- **Brukeren oppgir inndata; vi oppgir ingen skjulte statistikker.** Inndata (avsender): årlig fraktforbruk, andel av forbruket som er tilleggsgebyrer (brukerens eget tall eller «vet ikke» -> oppfordring om å bruke siste 3 måneders fakturaer), antall laster/år. Inndata (transportør): laster/år, andel stopp med venting utover fri tid, gjennomsnittlige timer over fri tid, detention-sats per time (fra deres rate cons), % av detention som i dag faktureres og % av fakturert som blir betalt.
- **Formelen vises og kan redigeres.** Transportøreksempel: `unbilled_or_unpaid = loads x stop_share x avg_hours_over_free x rate x (1 - paid_through_share)`; avsendereksempel: `exposure = spend x accessorial_share x unsupported_share`. Hver linje i regnestykket skrives tilbake, i ånden av produktets egne beregningsspor.
- **Standardverdier er merkede antakelser med intervaller, ikke funn.** Ikke forhåndsutfyll noe som ser ut som en statistikk. Hvis en standardverdi tilbys for å hjelpe brukeren i gang (f.eks. 2 timers fri tid, som er et vanlig kontraktsvilkår men varierer), merk den «typisk kontraktsvilkår; sjekk din rate confirmation». Bransjeomfattende «uinnkrevd %»-tall er grad C og må ikke forhåndsutfylles.
- **Utdata er et intervall og et forbehold, aldri et løfte.** «Hvis inndataene dine stemmer, er dette størrelsesordenen på detention du kanskje ikke krever inn før honorarer. Det er ikke et tilbud eller en garanti. Honorarer og vinnbar andel avhenger av dine kontrakter og ditt bevis.»
- **Reproduserbarhet:** publiser formelen og et fast gjennomregnet eksempel (hypotetiske tall, merket «illustrasjon») slik at hvem som helst kan regne det om for hånd; lever kalkulatoren som en liten statisk side med logikken i ren JavaScript og en enhetstest av det gjennomregnede eksempelet. Samme inndata gir alltid samme utdata; ingen skjult skåring, ingen «AI-estimat».
- **Personvern:** beregn på klientsiden; ikke send inndata med mindre brukeren sender inn lead-skjemaet. Oppgi hva som lagres, av hvem og hvor lenge. GDPR-/ePrivacy-samtykke for enhver e-postinnsamling (operatøren er i Norge); ingen forhåndsavkryssede bokser; en fungerende avmelding.
- **Oppfølgingstilbud:** «Send oss 20-50 avsluttede laster (skrivebeskyttet, under NDA) så kjører vi det samme regnestykket på dine reelle dokumenter.» Det er designpartner-pitchen og den første ærlige datakilden.
- Spesifikasjon og tekst: `marketing/landing/calculator-spec.md`.

Andre lead magnets (de samme ærlighetsreglene): en **bevissjekkliste for detention** (hvilket bevis som vinner et detention-krav: vilkår i rate con, avtale, ankomst-/avgangsstempler, kontaktlogg), en **sjekkliste med røde flagg i rate confirmation** (tilleggsgebyrklausuler å forhandle), og en **eksempelbevispakke og UTKAST til kravbrev bygget på syntetiske data** (vi genererer allerede disse i repoets fixtures; merk som syntetiske).

## 5. Innholdsplan

Prinsipper: bevisbasert; hver forklaring har et gjennomregnet eksempel med aritmetikk; siter primærkilder; skrevet av en navngitt person med domenegjennomgang (planen noterer at ingen ekspert på fraktrevisjon er på teamet ennå, så **få en domeneekspert til å gjennomgå før publisering** og nevn hvem det er kun med deres samtykke); ingen AI-slurvete utfyllingstekst; datostempel og vedlikehold.

Pilarer:
1. **Grunnleggende om detention og tilleggsgebyrer** (ordliste + forklaringer; klynge C). Bygges først; billigst, mest gjenbrukbart.
2. **Hvordan vinne et krav** (bevis, tidslinjer, kontraktsspråk; bevispakke-konseptet).
3. **Revisjon på avsendersiden** (uautoriserte og udokumenterte tilleggsgebyrer; forhandling av rate con).
4. **Bygg åpent, ærlig**: fremdrift før produkt, hva vi tok feil av, evalueringsmetoden. Troverdig for en gründerledet B2B-start; ingen oppdiktede målinger.
5. **Data og referanseverdier** (avsnitt 7) når reelle, samtykkede data finnes.

Frekvens er en kapasitetsbeslutning, ikke et mål: start med ~6-8 grunnsider (ordlistehub, forklaring av detention-beregning, tvistespillbok for hver side, bevissjekkliste, kalkulator, én nøytral sammenligningsguide) før noen blogg-frekvens. Revurder fra Search Console etter lansering.

## 6. Kanalplan (B2B; ingen forbruker-spam, ingen kjøpte lister)

| Kanal | Rolle | Ærlige taktikker | Rekkverk |
|---|---|---|---|
| **Oppsøking av designpartnere** (primær, jf. forretningsplanens G0-G1) | Validere lekkasje; få avsluttede saker under NDA | Individuelt undersøkt oppsøking av transportører/mellomstore avsendere via varme introduksjoner, fellesskap i fraktforeninger og kontaktens publiserte forretningskanal; tilby en gratis lekkasjerevisjon på deres egne avsluttede saker; be om 20 minutter for å lære hvordan de fakturerer detention i dag. | Små volumer, menneskeskrevet, relevant for mottakeren. Ingen utsendelser til skrapede lister. Følg CAN-SPAM (USA), ePrivacy/GDPR (EU/EØS-mottakere: B2B-henvendelser på grunnlag av berettiget interesse har vilkår og en reservasjonsmulighet) og hver plattforms vilkår. Registrer reservasjoner. |
| **LinkedIn (gründer + selskapsside)** | Troverdighet og innkommende henvendelser fra B2B-kjøpere | Gründeren poster om detention-mekanikk, gjennomregnede eksempler, hva datalaget trenger, lærdom fra partnersamtaler; kommenterer med substans i logistikkgrupper; deler kalkulatoren og sjekklistene. | Ingen falsk engasjement, pods eller kjøpte følgere; ingen automatisert tilkoblingsspam; ingen ubelagt «vi krevde inn $X». Opplys om status før produkt. |
| **SEO** | Akkumulerende oppdagelse for løsnings-/leverandørbevisste søk | Avsnitt 3, 5, 9. | Kvalitet fremfor volum; ingen programmatiske tynne sider; ingen lenkeopplegg. |
| **Partnerskap** | Distribusjon via tilgrensende aktører | Faktoringpartnere for transportører, TMS-/ELD-markedsplasser, fraktforeninger og 3PL-fellesskap (planen lister disse som hypoteser å teste). Medforfattede guider; integrasjonsledede sider først etter at en integrasjon finnes. | Ikke antyd partnerskap/støtte før det finnes. |
| **Fagmedier og podkaster** | Rekkevidde og tilbakelenker | Pitch praktikernære saker (hvordan detention faktisk bevises), data fra referanseverdien når den er reell. | Journalister får fakta og en navngitt, tilgjengelig kilde, ikke hype. |
| **Betalt** | Senere, kun for å teste et validert budskap | Søkeannonser på en håndfull klynge A-fraser for å teste budskap når siden finnes og en konverteringshendelse er definert; LinkedIn Ads mot en definert kontoliste hvis budsjett finnes. | Ikke start før en konverteringsvei og en målplan finnes; ingen budsjettsum er forpliktet her. |
| **E-post** | Pleie kun av samtykkede leads | Kort månedlig notat: ny guide, gjennomregnet eksempel. | Kun samtykke (opt-in); enkel avmelding; ingen kjøp av leads. |

Det vi **ikke** gjør: forbrukerlignende spam, kald e-postutsendelse til kjøpte lister, oppdiktede anmeldelser eller logoer, falsk hastverk, skrapede personopplysninger eller betalte tilbakelenker.

## 7. Offentlig referanseverdi (den opptjente medieeiendelen, utsatt til dataene er reelle)

Konsept: en tilbakevendende, metodikk-først **«Detention and accessorial recovery benchmark»** for mellomstore avsendere og små transportører: hvor ofte detention faktureres, hvor ofte den betales, hvor lang tid innkreving tar, hvilket bevis som korrelerte med betaling.

Regler slik at det er troverdig i stedet for markedsføring:
1. **Det finnes ikke før reelle, samtykkede, anonymiserte data finnes** (etter pilot, G3+). Å publisere før det ville være oppdiktede data. Inntil da kan siden beskrive *metodikken* og invitere til deltakelse, uten tall.
2. **Metodikk publisert på forhånd:** definisjoner, utvalgsstørrelse og -utvelgelse, tidsvindu, ekskluderinger, hvordan anonymisering og avidentifisering av motparter fungerer, kjente skjevheter (designpartnere selvselekterer) og konfidensgrenser. Utgi de aggregerte tabellene og koden som beregner dem.
3. **Samtykke og kontrakter:** skriftlig tillatelse fra hver databidragsyter; ingen motpart (transportør/avsender) identifiserbar; juridisk gjennomgang av vilkår for datadeling og konkurranserettslig sensitivitet før prisrelaterte aggregater utgis.
4. **Skill mellom målte og leverandørgrad-tall** (repoets A/B/C-gradering). Foretrekk ATRI som tredjepartsanker og si tydelig hva den måler og ikke måler (kostnad av å vente, ikke innkrevbare dollar).
5. Kjør på nytt med fast frekvens bare hvis utvalget støtter det; hvis ikke, si det.

## 8. Måling (settes opp sammen med nettstedet; mål er hypoteser, ikke prognoser)

| Spørsmål | Mål | Kilde | Merknader |
|---|---|---|---|
| Er vi indeksert og funnet? | Indekserte sider, visninger, klikk, spørringer | Search Console | Verifiser eiendommen ved lansering; dette er den reelle baselinen for enhver revisjon |
| Engasjerer besøkende seg? | Økter, scroll-/CTA-hendelser, fullførte kalkulatorbruk | Personvernvennlig analyse (selvhostet eller lite cookiebruk; EU-samtykkeregler gjelder) | Definer hendelser før lansering |
| Genererer vi kvalifiserte samtaler? | Leads som blir et designpartner-møte; møter som blir en avtale om datadeling | CRM/regneark | **Dette er målingen som betyr noe nå**, ikke trafikk |
| Hva konverterer de første designpartnerne? | Kilden til hver partnersamtale | Merkede lenker + «hvordan hørte du om oss» | Trolig stort sett utgående/varm introduksjon tidlig; dataene vil vise det |
| Er AI-svarsynlighet reell? | Tilstedeværelse i et fast promptpanel på tvers av motorer | Manuelt panel, logget månedlig | Kun etter lansering |

Sett tallmål først etter å ha observert 1-2 måneder med reelle data; å forhåndsregistrere et mål (for eksempel «N designpartner-samtaler innen uke U») er greit hvis det skrives ned som et mål, aldri som et resultat.

## 9. On-page SEO-sjekkliste (gjelder hver side; verifiseres etter lansering av en revisjon)

**Hensikt og innhold**
- [ ] Én primær spørring/hensikt per side; siden svarer på den bedre enn toppresultatene (gjennomregnet eksempel, original tabell, sjekkliste).
- [ ] H1 angir temaet tydelig; H2/H3 følger spørsmålene en kjøper stiller. Én H1.
- [ ] Definisjon eller direkte svar i de første ~100 ordene (vennlig for utdrag/AI-svar).
- [ ] Hvert tall er sitert (primærkilde + grad) eller merket antakelse/illustrasjon; datoer på tidssensitive påstander.
- [ ] Opplysning om status før produkt synlig der påstander om kapabilitet fremkommer; ingen ubelagte superlativer.
- [ ] Navngitt forfatter, gjennomgangskvalifikasjon (med samtykke), publiserings- og oppdateringsdatoer.
- [ ] Tydelig neste steg (CTA): kalkulator, sjekkliste eller «book en designpartner-samtale».

**Metadata og struktur**
- [ ] Unik `<title>` (~50-60 tegn, primærfrase tidlig) og meta description (~120-155 tegn, nytte + CTA, ingen nøkkelordstapping).
- [ ] Ren, kort URL med små bokstaver og bindestreker; canonical-tagg; ingen dupliserte parameter-URL-er.
- [ ] Open Graph- og Twitter card-tagger; beskrivende sosialt bilde med alt-tekst.
- [ ] Beskrivende alt-tekst på informative bilder; dekorative bilder med tom alt; ingen tekst bakt inn i bilder.
- [ ] Interne lenker: hver side nåbar på <=3 klikk; beskrivende ankertekster; hub-and-spoke mellom ordliste, guider, kalkulator og løsningssider.
- [ ] Brødsmuler (breadcrumbs) på dype sider.

**Strukturerte data (kun for det som er sant og synlig på siden)**
- [ ] `Organization` (navn, URL, logo, kontakt; sameAs kun for reelle profiler), `WebSite`, `BreadcrumbList`.
- [ ] `Article`/`BlogPosting` for guider (forfatter, datoer), `FAQPage` kun der en FAQ finnes på siden, `SoftwareApplication` først når en produktside beskriver reell, tilgjengelig programvare. **Ingen oppdiktet `Review`/`AggregateRating`.**
- [ ] Valider med Googles Rich Results Test / Schema validator etter lansering.

**Teknisk**
- [ ] HTTPS, HSTS, én kanonisk vert (www/ikke-www), kun 301-viderekoblinger, ingen viderekoblingskjeder.
- [ ] `robots.txt` og XML-sitemap med korrekt lastmod; sitemap sendt inn i Search Console. Blokker staging-miljøer og produktets autentiserte app/API fra indeksering (`noindex`/auth); indekser aldri kundedata eller API-docs bak nøkler.
- [ ] Core Web Vitals innenfor Googles «good»-terskler målt på **felt**data etter lansering (LCP, INP, CLS); lette sider, optimaliserte bilder, ingen layoutforskyvning fra kalkulatoren.
- [ ] Mobil-først-layout, lesbare fonter, trykkflater; tilgjengelig (WCAG 2.2 AA): overskrifter, kontrast, tastaturnavigasjon, skjemaetiketter (også et SEO- og juridisk risikopunkt).
- [ ] Server-rendret/statisk HTML for innhold (kalkulatoren kan være på klientsiden, men forklaringsteksten må ligge i HTML-en).
- [ ] Egendefinert 404 med søk/lenker; ingen myke 404-er (soft 404).
- [ ] Hreflang hvis/når en norsk versjon publiseres (repoet har allerede `*.no.md`-docs); ikke autooversett uten gjennomgang.

**Tillit og samsvar**
- [ ] Personvernerklæring, cookie-/samtykkebanner tilpasset EU/EØS-besøkende, fungerende avmelding, impressum/selskapsopplysninger.
- [ ] Sikkerhetsside som kun oppgir det som er sant i dag (se repoets README «Før reelle kundedata»): ingen «SOC 2», «enterprise-grade» eller sertifiseringer vi ikke har.
- [ ] Sammenligningssider: fakta verifisert og datostemplet; ingen villedende bruk av konkurrenters merker; rettferdig der rivaler er sterkere.

**Lanserings- og revisjonsporter**
- [ ] Search Console og analyse verifisert; sitemap sendt inn; staging blokkert.
- [ ] **Deretter** kjøres en reell SEO-revisjon (FITq-stil eller tilsvarende: crawl, indeksering, Core Web Vitals, schema, interne lenker, AI-synlighet) på den live URL-en og baselinen registreres. Revisjon på nytt etter de første 10 sidene og kvartalsvis.

## 10. Rekkefølge

1. **Nå (ingen nettside):** bestem domenet; skisser landingssiden (`marketing/landing/`), kalkulatorspesifikasjonen og grunnsidene; ordne en domeneekspert som gjennomgår; hold oppsøkingen av designpartnere i gang (det er det reelle go-to-market). Få juridisk gjennomgang av påstandsspråket.
2. **Lansering:** publiser det lille grunnsettet, verifiser Search Console/analyse, send inn sitemapet, kjør den første live revisjonen (baseline).
3. **Etter de første partnersamtalene:** juster teksten til språket kjøperne faktisk bruker; legg til den nøytrale sammenligningsguiden; start LinkedIn-frekvens fra reell lærdom.
4. **Etter piloter (G3+):** med samtykke og juridisk gjennomgang, publiser den første referanseverdien og casestudien; vurder test-dimensjonert betalt søk.

## 11. Risikoer og ærlige begrensninger

- **Troverdighetsgap før produkt:** et uvalidert produkt med polert markedsføring eroderer tillit. Dempes med eksplisitt status, gjennomregnede eksempler og et designpartnertilbud i stedet for påstander.
- **Små nøkkelordvolumer i nisjen:** markedet er noen tusen kunder; relevans slår rekkevidde. Volumer er ikke målt her.
- **Innholdsvollgraven er tynn:** guider kan kopieres; den varige eiendelen er proprietære data om tvisteutfall og referanseverdien, som først finnes etter reelt volum.
- **Juridisk/regulatorisk:** underbygging av reklame, personvern, regler for henvendelser og konkurranserettslig sensitivitet på prisreferanser trenger jurist.
- **Avhengighet av én operatør:** gründerens tid er flaskehalsen; foretrekk færre, bedre eiendeler.
