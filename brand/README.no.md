> **Uoffisiell oversettelse (bokmål).** Bekvemmelighetsoversettelse. Ved avvik gjelder den engelske originalen ([README.md](README.md)).

# Retningslinjer for scoup.ai-merkevaren

scoup.ai er både selskapet og produktet: én merkevare. Logoen er "Reconciled s": en s bygget av to
like halvdeler som møtes nøyaktig i midten (fakturaen og kontrakten, avstemt). Den øvre halvdelen er
nøytral og den nedre turkis, slik at øyeblikket der de stemmer overens er merkevaren. s-en står på en
avrundet flis, som også fungerer som app-ikon, avatar og favicon.

Kodebasen beholder sitt tekniske navn (`freight-recovery`, `@fr/*`, `freight_recovery`). Bare navnet
folk ser, endres.

## Navneregler

- Skriv alltid navnet med små bokstaver: **scoup.ai**. Aldri "Scoup.ai", "SCOUP.AI", "Scoup AI" eller "Scoup".
- Unngå å starte en setning med navnet; omformuler ("Dette nettstedet tilhører scoup.ai, ..."). Hvis
  det ikke lar seg unngå, behold små bokstaver.
- Genitiv: **scoup.ai sin** / **scoup.ai-s** (engelsk: "scoup.ai's").
- Sett aldri navnet i en sammenheng med bare store bokstaver (for eksempel CSS `text-transform: uppercase`).
- I toppfelt erstatter logobildet tekstnavnet. Tekstnavnet brukes fortsatt i sidetitler, alt-tekst,
  bunntekst og juridisk tekst.
- Beskrivende uttrykk som "freight invoice recovery" eller "frakt-revisjon" er vanlige ord med små
  bokstaver i brødtekst; de er ikke navnet.

## Filer

| Fil | Bruk |
| --- | --- |
| `lockup-horizontal.svg` | Standardlogo på lys bakgrunn: topptekst på nettsted og app, dokumenter. |
| `lockup-horizontal-on-dark.svg` | Samme, på mørk bakgrunn (lys flis, lys skrift). |
| `lockup-stacked.svg` | Kvadratiske flater: innloggingsskjermer, lysbilder, profilbilder med plass. |
| `lockup-stacked-on-dark.svg` | Stablet, på mørk bakgrunn. |
| `wordmark.svg` / `wordmark-on-dark.svg` | Bare navnet, der flisen allerede vises i nærheten. |
| `mark.svg` / `mark-on-dark.svg` | Flisen alene, fra 24 px og opp: app-ikoner, avatarer. |
| `favicon.svg` | Fane-ikon i nettleseren, 16-24 px (kraftigere streker for små størrelser). |
| `lockup-horizontal-mono-black.svg`, `lockup-stacked-mono-black.svg` | Énfarget trykk, stempel, preging på lyst materiale. |
| `lockup-horizontal-mono-white.svg`, `lockup-stacked-mono-white.svg` | Énfarget, utsparet på mørk eller fotografisk bakgrunn. |

Alle SVG-filene har `role="img"` og en `<title>`. Når en fil bygges inn med `<img>`, gi den
`alt="scoup.ai"`; står tekstnavnet rett ved siden av, merk bildet som dekorativt (`alt=""` eller
`aria-hidden="true"`) slik at skjermlesere ikke leser navnet to ganger. Mono-filene bruker en SVG-maske
med id `ma`; ikke legg to av dem inline i samme HTML-dokument (bruk `<img>`).

## Frirom

- x = x-høyden i ordmerket (omtrent 61 % av høyden på den horisontale logoen).
- Hold **1x** fritt på alle sider av en logo eller et ordmerke.
- Hold **0,25 x flisbredden** fritt rundt flisen når den brukes alene.

## Minstestørrelser

| Fil | Skjerm | Trykk |
| --- | --- | --- |
| Horisontal logo | 20 px høy (ca. 105 px bred) | 6 mm høy |
| Stablet logo | 48 px høy | ikke fastsatt ennå (avklar med designer) |
| `favicon.svg` | 16-24 px | ikke for trykk |
| `mark.svg` | 24 px og opp | ikke fastsatt ennå |

Under disse størrelsene: bruk den neste mindre filen (logo, så merke, så favicon) i stedet for å skalere ned.

## Fargepalett

Dette er eksisterende produkt-tokens; ingen ny aksentfarge er innført.

| Rolle | Lys bakgrunn | Kontrast | Mørk bakgrunn | Kontrast |
| --- | --- | --- | --- | --- |
| Blekk: bokstaver og flis | `#0f172a` | 17,85:1 på hvitt | `#e2e8f0` | 15,19:1 på `#0b1220` |
| Turkis: nedre halvdel av s-en | `#0f766e` (på lys flis) / `#2dd4bf` (på mørk flis) | 5,47:1 på hvitt; 9,59:1 på flisen `#0f172a` | `#2dd4bf` | 10,06:1 på `#0b1220` |
| Dempet: ".ai" | `#64748b` | 4,76:1 på hvitt | `#8b9ab0` | 6,55:1 på `#0b1220` |

Merker trenger minst 3:1 mot bakgrunnen; ".ai" og all skrift trenger minst 4,5:1. Alle parene over
består. `#0f766e` på mørk skifer gir bare 3,42:1, så mørke bakgrunner bytter alltid til `#2dd4bf`.

Bruk **mørk flis på lys bakgrunn** (de vanlige filene) og **lys flis på mørk bakgrunn** (`-on-dark`-filene).

## Gjør og ikke gjør

Gjør:

- Bruk filene slik de leveres, skalert proporsjonalt.
- Behold hjørneradiusen på 22 % av flisbredden.
- Bruk mørk flis på lys bakgrunn og lys flis på mørk bakgrunn.

Ikke:

- Forskyv de to halvdelene av s-en; de skal møtes nøyaktig.
- Legg mørk flis på mørk skifer: den forsvinner (1,05:1).
- Bytt fargene på de to halvdelene.
- Bruk s-en uten flisen i fargeversjoner.
- Endre farger, strekk, forvreng, legg til kontur, skygger, gradienter eller andre effekter, eller animer logoen.
- Sett navnet med store bokstaver eller en annen skrift som erstatning for logoen.

## Produksjons-TODO

Skriften er tegnet med SVG-streker (`stroke-width`), ikke fylte konturer. Nettlesere viser den riktig,
men før endelig trykk (og før filer sendes til trykkeri eller skiltmaker) må strekene konverteres til
konturer i et vektorprogram (for eksempel Illustrator "Outline Stroke" eller Inkscape "Stroke to
Path"). Behold originalene med streker her som kilde.
