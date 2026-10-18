# Keyword research: scoup.ai (B2B, US freight)

> **Status.** scoup.ai is pre-product: synthetic data only, never sold, no customers, no live product. This file builds
> on `marketing/seo-and-growth.md` section 3 and replaces its `TBD: measure` placeholders where a citable source
> now exists. It contains **no absolute monthly search volumes and no keyword-difficulty scores**, because we have
> no paid SEO tool account (Semrush, Ahrefs, Moz or similar) and no Google Ads account with spend, which is what
> unlocks exact Keyword Planner figures. Every absolute volume is therefore `UNKNOWN — needs primary research`.
> What we do have is **Google Trends relative interest**, pulled on 2026-10-17 with a reproducible script, which
> tells us how terms compare with each other but not how many searches any of them gets.
>
> **Owner decision, 2026-10-17:** scoup.ai goes to market shipper- and importer-first; carriers become a later or
> partner channel. The clusters below are ordered by that decision, not by measured search interest. Section 4
> explains where the two diverge.

## 1. Method and its limits

We pulled Google Trends data for 29 candidate terms in seven batches of five (batches F and G were added after the
owner's shipper- and importer-first decision, same day, same settings) (US, 2021-10-01 to 2026-09-30, all
categories, web search). Every batch carries the same anchor term, "freight audit", so a term's interest can be
expressed as a multiple of the anchor and compared across batches. The script and its raw output sit next to this
file: `marketing/seo/data/trends_pull.py` writes one CSV per batch plus `trends_summary.csv`, and
`marketing/seo/data/trends_related.py` writes the related-query lists to `trends_related.csv`. Re-running them
will give slightly different numbers, because Trends samples its data; the order of magnitude should hold.

Google's own description of the data sets the limits of what we can claim. Each data point is divided by total
searches for the geography and period, the result is scaled 0 to 100, and "search terms with low volume appear as
'0'". A Trends value is a share, not a count. A ratio of 2.33 means a term drew about 2.3 times the search interest
of "freight audit" over the five years; it does not mean either term gets any particular number of searches.

Source: Google, FAQ about Google Trends data, https://support.google.com/trends/answer/4365533, accessed 2026-10-17
Source: Google Trends (via the `pytrends` client), US, 2021-10-01 to 2026-09-30, pulled 2026-10-17; batch A as an
explore URL: https://trends.google.com/trends/explore?date=2021-10-01%202026-09-30&geo=US&q=freight%20audit,detention%20pay,detention%20time,freight%20claim,accessorial%20charges, accessed 2026-10-17

Difficulty is harder still. Without a tool we cannot score it, so the difficulty column below is a qualitative
judgement from sampling who appears in web-search results for the query on 2026-10-17. Those samples come from a
general web-search API, not a captured Google results page, and they should be treated as a hint about the kind of
site that competes (carrier factoring firms, TMS vendors, enterprise audit firms, law firms), not as a ranking.

## 2. What the Trends data says

The data cuts against the owner's chosen segments on the software terms and is kinder on the problem terms.
The vendor-category phrases a mid-market shipper would type when shopping ("freight audit software", "freight bill
audit", "freight invoice audit") sit at or below the Trends reporting threshold, at 0 to 2 percent of the interest
in plain "freight audit". The carrier's own vocabulary ("detention pay", "detention charges", "rate confirmation",
"TONU", "layover pay") draws between 0.7 and 3.3 times the interest of "freight audit". People search for the
problem in the words of the person who does the waiting, and almost nobody searches for the software category.

The shipper and importer picture improves once we stop looking for software phrases. Single words a shipper's AP
team uses on an invoice do draw interest: "freight bill" 3.88 times "freight audit", "freight invoice" 1.47 times,
"accessorial" 0.88 times (against 0.08 for "accessorial charges"). On the importer side, "demurrage" is the second
largest term we measured (4.88 times, broad), while the specific phrases are small: "demurrage charges" 0.22,
"container detention" 0.13, "demurrage and detention" 0.10, "fmc demurrage" 0.03, "per diem charges" 0.02. The
importer searches for the meaning of a charge and for a carrier's tariff far more than for the rule or for a tool.

| Term | Batch | Mean interest in batch | Ratio to "freight audit" | Reading |
|---|---|---|---|---|
| freight audit (anchor) | all | 4.4 to 8.5 | 1.00 | Anchor; its batch value moves because Trends rescales each request |
| detention time | A | 21.9 | 4.97 | **Polluted**: includes school and legal "detention"; do not read as freight demand |
| demurrage | D | 34.2 | 4.88 | Broad ocean-shipping term; related queries are definitional ("demurrage meaning") |
| freight payment | B | 39.2 | 4.63 | Likely includes payment-portal navigation; vendor/brand intent mixed |
| rate confirmation | E | 15.2 | 3.34 | Carrier and broker document term; strong fit for evidence content |
| tonu | C | 23.5 | 2.77 | Ambiguous abbreviation; freight share unknown |
| detention pay | A | 10.2 | 2.33 | Carrier intent; top related query "detention pay trucking" |
| freight claim | A | 6.6 | 1.51 | **Wrong intent**: related queries are FedEx/UPS loss-and-damage claims |
| detention charges | C | 10.5 | 1.24 | Mixed carrier/shipper; closest to our product language |
| layover pay | C | 6.0 | 0.71 | Driver-pay intent; adjacent |
| detention fee | E | 1.6 | 0.36 | Small but on-topic |
| lumper fee | C | 2.1 | 0.25 | Small; maps to the product's "flag for human review" rule |
| demurrage and detention | D | 0.7 | 0.10 | Small; ocean/intermodal; FMC-rule audience |
| freight dispute | E | 0.5 | 0.10 | Small |
| accessorial charges | A | 0.4 | 0.08 | Near threshold |
| detention trucking | D | 0.5 | 0.07 | Near threshold (people say "detention pay trucking" instead) |
| freight audit software | B | 0.2 | 0.02 | Near threshold |
| freight bill audit | B | 0.1 | 0.01 | Near threshold |
| freight invoice audit | B | 0.0 | 0.00 | Below Trends threshold |
| freight bill | G | 32.8 | 3.88 | Shipper AP term; likely includes carrier bill-pay navigation |
| lumper | G | 32.9 | 3.89 | Ambiguous single word; freight share unknown |
| freight invoice | G | 12.4 | 1.47 | Shipper AP term |
| accessorial | G | 7.4 | 0.88 | People search the bare word, not "accessorial charges" |
| demurrage charges | F | 1.8 | 0.22 | Importer intent |
| container detention | F | 1.1 | 0.13 | Importer intent |
| fmc demurrage | F | 0.3 | 0.03 | Rule-aware importers; small |
| per diem charges | F | 0.2 | 0.02 | Near threshold |
| accessorial fees | D | 0.0 | 0.00 | Below Trends threshold |
| freight overcharge | E | 0.0 | 0.00 | Below Trends threshold |

Source: Google Trends, seven batches as above, `marketing/seo/data/trends_summary.csv` (A-E) and
`marketing/seo/data/trends_summary_F_importer_G_shipper.csv` (F-G), pulled 2026-10-17. Ratios
are our arithmetic: term mean divided by the "freight audit" mean in the same batch (example, batch A:
10.2 / 4.4 = 2.33 for "detention pay"). Ratios built on small means are coarse; a 0.0 means "too little data for
Trends to report", not "zero searches".

The related-query lists sharpen the picture. For "freight audit" the top related queries are "freight audit and
payment" (100), "freight audit services" (91) and "freight audit software" (76), which tells us the buyer who does
search this space is looking at outsourced audit-and-pay firms, the incumbents' home ground. For "detention pay"
the top related query is "detention pay trucking" (100) followed by "detention pay for truck drivers" (33), a
driver and small-carrier audience. "Demurrage" produced a long tail of definitional and carrier-specific queries
("demurrage meaning", "demurrage vs detention", "msc detention and demurrage tariff" rising +650 percent), a sign
that ocean D&D searchers want explanations and tariff lookups. "Freight claim" is dominated by "fedex freight
claim" (100) and "ups freight claim" (32), which is cargo loss-and-damage, a different job from ours.

Source: Google Trends related queries, US, 2021-10-01 to 2026-09-30, `marketing/seo/data/trends_related.csv`, pulled
2026-10-17. Values are Trends' relative scores (top: 0-100; rising: percent growth), not volumes.

## 3. Keyword clusters

Each cluster below names its intent, the evidence we have, a qualitative difficulty call with its reasoning, and the
page it should map to (page plan in `content-plan.md`). Absolute volume and tool difficulty are blank for every
row for the reason given at the top. Clusters are numbered in the owner's priority order (shipper, then importer,
then the shared invoice and category clusters, then carriers). Each also fits something the prototype does today:
compute detention from rate confirmation, gate times and invoice, flag unauthorized accessorials for human review,
check ocean D&D invoices against 46 CFR 541 (build branch, synthetic data), and produce an evidence packet with a
DRAFT demand. The cluster order is not a forecast of traffic.

The numbering changed on 2026-10-17: old Cluster 2 (accessorials) is now Cluster 1, old Cluster 5 (D&D) is now
Cluster 2, and old Cluster 1 (carrier detention) is now Cluster 5.

### Cluster 1: Accessorial and freight-invoice disputes (shipper side), priority 1

The shipper-side vocabulary is thin in Trends ("accessorial charges" 0.08x, "accessorial fees" below threshold), but
the bare words an AP team uses are not ("accessorial" 0.88x, "freight invoice" 1.47x, "freight bill" 3.88x). This
cluster leads because the owner chose shippers first, and it is about conversion quality more than reach: the few people who search "how to dispute accessorial
charges" are exactly the mid-market AP or logistics manager we want as a design partner. Difficulty looks
medium-low. The sampled results are guides from a 3PL and broker (Worldwide Express), a cross-border carrier
(Nuvocargo), a managed-transportation firm (Translogistics) and a warehouse encyclopedia (Racklify). They give
generic advice (dispute in writing, attach the BOL and POD); none walks through one invoice line against one
rate-confirmation clause with the arithmetic shown.

| Keyword | Intent | Trends ratio | Monthly volume | Difficulty (qualitative) | Target page |
|---|---|---|---|---|---|
| how to dispute accessorial charges / dispute accessorial fees | Informational, shipper | not pulled (parent 0.08) | UNKNOWN — needs primary research | Medium-low | `/guides/dispute-accessorial-charges/` |
| unauthorized accessorial charges / lumper fee dispute | Informational | lumper fee 0.25 | UNKNOWN — needs primary research | Low | `/guides/lumper-fees/` |
| accessorial audit / accessorial charge audit | Vendor-aware | not pulled | UNKNOWN — needs primary research | Low-medium | `/accessorial-audit/` |
| how to dispute a detention charge (shipper) | Informational | not pulled | UNKNOWN — needs primary research | Low-medium | `/guides/dispute-a-detention-charge/` |
| accessorial / accessorial meaning | Informational | 0.88 | UNKNOWN — needs primary research | Medium: carriers' own accessorial schedules likely rank | `/guides/accessorials/` (hub) |
| freight invoice / freight bill (how to read and check one) | Informational, shipper AP | 1.47 / 3.88 | UNKNOWN — needs primary research | Medium; bill-pay navigation dilutes intent | `/guides/how-to-check-a-freight-invoice/` |

Source: Worldwide Express, How to dispute accessorial fees, https://www.wwex.com/shipping-resources/how-to-dispute-accessorial-fees, accessed 2026-10-17
Source: Nuvocargo, Accessorial charges in freight (2026 guide), https://nuvocargo.com/blog-posts/accessorial-charges-freight-cost, accessed 2026-10-17
Source: Translogistics, Common carrier disputes and how to solve them, https://www.translogisticsinc.com/blog/carrier-disputes, accessed 2026-10-17
Source: Racklify, How to audit and dispute a carrier invoice, https://racklify.com/encyclopedia/how-to-audit-and-dispute-a-carrier-invoice-practical-steps-for-warehouses/, accessed 2026-10-17

### Cluster 2: Demurrage and detention for importers, priority 1

D&D is a real and regulated pain, and the TypeScript build (branch `feat/hardening`, read-only) already contains an
ocean D&D invoice-audit module behind the feature flag `intelligence.ocean_dd`, run on synthetic data only. Its rules
quote 46 CFR 541.5 to 541.8 verbatim and check invoice contents and deadlines field by field
(`packages/shared/src/ocean-dd/regulation.ts`). An earlier draft of this file said the prototype did not compute D&D;
that was wrong. The Federal Maritime Commission's billing rule (46 CFR part 541, published 26 February 2024,
effective 28 May 2024) sets minimum invoice contents, a 30-day invoicing deadline and at least 30 days for the billed
party to dispute. In September 2025 the D.C. Circuit vacated only 46 CFR 541.4 (who may be billed); the content and
dispute provisions stay in force. The owner chose importers as a first segment, and research gives the reasons to care: 234,023 small and medium US
importing companies in 2024 (all modes; the ocean-container share is unknown), and an FMC statement that the nine
largest ocean carriers collected about $15.4 billion in D&D charges from April 2020 to March 2025. Searchers want definitions ("demurrage meaning", "demurrage vs detention") and
carrier tariffs, so the cluster earns an explainer and a checklist that mirror what the module checks. Difficulty is
medium: law firms (HFW, Squire Patton Boggs, Thompson Hine), trade associations and ocean-visibility vendors
(BlueCargo, Portcast) publish here. Pages may describe the module only as pre-product software tested on synthetic
invoices, with no accuracy or recovery claim.

| Keyword | Intent | Trends ratio | Monthly volume | Difficulty (qualitative) | Target page |
|---|---|---|---|---|---|
| demurrage vs detention / demurrage meaning | Informational | demurrage 4.88 (broad) | UNKNOWN — needs primary research | Medium | `/guides/demurrage-vs-detention/` |
| demurrage and detention / D&D charges | Informational | 0.10 | UNKNOWN — needs primary research | Medium | same page |
| demurrage charges / demurrage fees | Informational to commercial | 0.22 | UNKNOWN — needs primary research | Medium | `/guides/demurrage-charges/` |
| container detention / per diem charges | Informational | 0.13 / 0.02 | UNKNOWN — needs primary research | Medium | `/guides/demurrage-vs-detention/` |
| [carrier] detention and demurrage tariff (e.g. "msc detention and demurrage tariff", rising) | Navigational, tariff lookup | related query only | UNKNOWN — needs primary research | Low for a neutral index; carriers rank for their own | `/guides/dd-free-time-tracker/` |
| how to dispute demurrage charges / D&D refund request | Commercial, importer | not pulled | UNKNOWN — needs primary research | Medium | `/guides/dispute-demurrage-charges/` |
| FMC demurrage detention rule / D&D invoice requirements | Informational, compliance | not pulled | UNKNOWN — needs primary research | Medium: law firms | `/guides/fmc-dd-invoice-checklist/` |

Source: HFW, FMC's new demurrage and detention regulations become effective May 2024, https://www.hfw.com/insights/fmcs-new-demurrage-and-detention-regulations-become-effective-may-2024, accessed 2026-10-17
Source: Squire Patton Boggs, Federal Maritime Commission issues final demurrage and detention rule, https://www.squirepattonboggs.com/en/insights/publications/2024/03/federal-maritime-commission-issues-final-demurrage-and-detention-rule, accessed 2026-10-17

Source: Thompson Hine, Court sets aside part of FMC's demurrage and detention billing rule (26 September 2025), https://www.thompsonhine.com/insights/court-sets-aside-part-of-fmcs-demurrage-and-detention-billing-rule/, accessed 2026-10-17 (via `research/02-industries.md` and `research/04-gaps.md`)

The eCFR page redirected us to a bot check on 2026-10-17. The build module's source comment says 541.4 was removed
from the CFR effective 29 December 2025 by Federal Register document 2025-23920; we have not read that document
ourselves, so it must be checked before a D&D page cites the removal date.

Source: U.S. Census Bureau, A profile of U.S. importing and exporting companies, 2023-2024 (CB26-73, 5 May 2026), https://www.census.gov/foreign-trade/Press-Release/edb/edbrel2024.pdf, accessed 2026-10-17 (via `research/02-industries.md`)
Source: Federal Maritime Commission, Detention and demurrage, https://www.fmc.gov/detention-and-demurrage/, accessed 2026-10-17 (via `research/02-industries.md`)

### Cluster 3: Carrier invoice disputes and rate confirmations, priority 2 (shipper lens)

"Rate confirmation" (3.34x anchor) is the surprise of the pull. It is the first document our rules engine reads,
and people search for it as a document in its own right (templates, required contents, whether it binds). Content
that explains which rate-confirmation clauses decide a detention or accessorial dispute serves both sides of the
market and links to the evidence-packet example. "Freight dispute" (0.10x) and "freight overcharge" (below
threshold) are small. "Freight claim" (1.51x) looks large, but its related queries show it is about cargo loss and
damage with FedEx and UPS, so we should not target it, and we should keep "claim" out of page titles where a
searcher could mistake us for a cargo-claims service.

| Keyword | Intent | Trends ratio | Monthly volume | Difficulty (qualitative) | Target page |
|---|---|---|---|---|---|
| rate confirmation / what is a rate confirmation | Informational | 3.34 | UNKNOWN — needs primary research | Medium: broker and load-board content likely | `/guides/rate-confirmation-detention-clauses/` |
| carrier invoice dispute / freight invoice dispute | Informational, shipper | freight dispute 0.10 | UNKNOWN — needs primary research | Low-medium | `/guides/dispute-a-carrier-invoice/` |
| freight claim (cargo loss and damage) | Wrong intent: do not target | 1.51 | UNKNOWN — needs primary research | n/a | none |

### Cluster 4: Freight audit (vendor category), priority 2

This is the category investors recognise and searchers barely use in its long form. "Freight audit" carries modest
interest, and its related queries ("freight audit and payment", "freight audit services") point at the outsourced
audit-and-pay incumbents. Difficulty is high for the head term: software directories (Capterra, GetApp), listicles
(Gitnux, Guideflow) and vendor blogs (FarEye, Hyperbots) fill the sampled results, and enterprise firms have years
of domain authority. We should aim at the long tail where company size and job are specific ("freight audit for
mid-market shippers", "contingency freight audit") with one neutral comparison page, published only after
`research/01-competitors.md` has verified every competitor fact we would print.

| Keyword | Intent | Trends ratio | Monthly volume | Difficulty (qualitative) | Target page |
|---|---|---|---|---|---|
| freight audit | Mixed, vendor-aware | 1.00 | UNKNOWN — needs primary research | High: directories, incumbents | home (secondary), `/freight-audit-alternatives/` |
| freight audit and payment / freight audit services | Vendor-aware (outsourced) | related query only | UNKNOWN — needs primary research | High | `/freight-audit-alternatives/` |
| freight audit software | Vendor-aware | 0.02 | UNKNOWN — needs primary research | High | `/freight-audit-alternatives/` |
| contingency freight audit / freight audit pricing | Decision | not pulled | UNKNOWN — needs primary research | Medium | `/pricing/` |
| freight invoice audit / freight bill audit | Vendor-aware | 0.00 / 0.01 | UNKNOWN — needs primary research | Medium | `/accessorial-audit/` |

Source: Capterra, Freightview vs ShipScience comparison, https://www.capterra.com/compare/136895-176318/Freightview-vs-UPS-FedEx-Parcel-Audit, accessed 2026-10-17
Source: Gitnux, Top 10 best freight auditing software of 2026, https://gitnux.org/best/freight-auditing-software/, accessed 2026-10-17
Source: FarEye, Freight audit software (blog), https://fareye.com/resources/blogs/freight-audit-software, accessed 2026-10-17
Source: Guideflow, Best freight audit software tools, https://www.guideflow.com/blog/freight-audit-software, accessed 2026-10-17

### Cluster 5: Detention billing (carrier side), priority 3: later and partner channel

Under the owner's decision this cluster waits: carriers become a later or partner channel. It keeps its pages in
the plan because it has the most measurable demand, and because shippers receive carriers' detention invoices, so a
shipper-side explainer of how detention is calculated serves both. "Detention pay" (2.33x anchor) and "detention charges" (1.24x) are the
largest unpolluted freight terms we measured, and the evidence-packet idea answers the carrier's real question:
how do I get paid for time I can prove? The difficulty is moderate rather than low because the people already
writing for this query are well-funded adjacent businesses with their own motive to own it: carrier factoring
companies (OTR Solutions), TMS vendors (Truckbase, Toro TMS) and driver-job boards (DriveMyWay). Their pages are
explainers that end in a factoring or TMS pitch; none we sampled shows a worked calculation from a rate
confirmation with the evidence attached, which is the gap a better page can fill.

| Keyword | Intent | Trends ratio | Monthly volume | Difficulty (qualitative) | Target page |
|---|---|---|---|---|---|
| detention pay / detention pay trucking | Informational, carrier | 2.33 | UNKNOWN — needs primary research | Medium: factoring/TMS explainers rank | `/guides/detention-pay/` |
| detention charges / detention fee | Informational to commercial | 1.24 / 0.36 | UNKNOWN — needs primary research | Medium | `/guides/how-detention-is-calculated/` |
| how to bill detention / detention invoice | Commercial, carrier | not pulled | UNKNOWN — needs primary research | Medium | `/guides/bill-detention-with-proof/` |
| detention billing software / detention tracking software | Vendor-aware | not pulled | UNKNOWN — needs primary research | Medium-high: TMS vendors and telematics marketplaces | `/detention-recovery/` |
| layover pay, TONU | Informational, glossary | 0.71 / 2.77 (ambiguous) | UNKNOWN — needs primary research | Low-medium | glossary entries |

Who publishes for this cluster today (web-search sample, 2026-10-17, not a Google results capture):

Source: OTR Solutions, Detention pay in trucking, https://otrsolutions.com/detention-pay-in-trucking/, accessed 2026-10-17
Source: Truckbase, Detention pay: what is it, https://www.truckbase.com/blog/dention-pay-what-is-it-how-to-get-your-truckers-money-worth, accessed 2026-10-17
Source: DriveMyWay, What is detention pay, https://www.drivemyway.com/blog/what-is-detention-pay-and-why-does-it-matter, accessed 2026-10-17
Source: Toro TMS, Driver detention management software: 7 top tools, https://www.torotms.com/blog/driver-detention-management-software, accessed 2026-10-17
Source: Geotab Marketplace, FleetOptos listing, https://marketplace.geotab.com/solutions/fleetoptos/, accessed 2026-10-17
Source: Platform Science Marketplace, DockClock, https://www.platformscience.com/marketplace/dockclock, accessed 2026-10-17

The software results matter for positioning. Trade-press coverage reports that McLeod and TMW (now Trimble) have
offered detention modules inside their TMS products for years, and telematics-marketplace apps (FleetOptos on
Geotab, DockClock on Platform Science, Detention Source on the App Store) automate the detention clock from
geofences. A carrier searching "detention billing software" will meet those first. Our page has to say plainly
that scoup.ai is neither a TMS nor a telematics app, and that its angle is the evidence packet built from the
documents the carrier already holds.

`market-researcher` independently confirmed FleetOptos and Detention Source in `research/01-competitors.md` and added
two more geofence-based tools that compete for this cluster: Hey Bubba (detention claims from ELD geofences inside
an AI dispatcher; its `/pricing` page returned 404) and GeoStamp by WiseTech Global (geofence timestamps, listed on
the Motive marketplace). The other publishers named above (DockClock, the McLeod and TMW modules, OTR Solutions,
Truckbase, Toro TMS, DriveMyWay) come only from our search sample and are not yet in the competitor research.
Neither of us has ranking or traffic data for any competitor.

Source: Hey Bubba, Detention management, https://bubba.ai/solutions/detention-management, accessed 2026-10-17 (via `research/01-competitors.md`)

Source: Bulk Transporter, McLeod module bills for downtime, https://www.bulktransporter.com/archive/article/21644416/wwwmcleodsoftwarecommodule-bills-for-downtime, accessed 2026-10-17
Source: Trucking Info, TMW adds detention tracking feature, https://www.truckinginfo.com/94877/tmw-adds-detention-tracking-feature, accessed 2026-10-17

### Cluster 6: Entity and AI-answer terms (glossary)

Short definitional queries ("what is TONU", "what is a lumper fee", "what is detention in trucking") are the blocks
AI answer engines and featured snippets tend to quote. Volumes are unknown and several terms are ambiguous in
Trends, so we cover them as a glossary with one definition, one worked example and one primary source each,
rather than as standalone pages. This carries over `seo-and-growth.md` Cluster D in substance.

## 4. What this means for the plan

The owner has chosen shippers and importers first, with carriers as a later or partner channel, and we order the
plan that way. The search data does not argue for that choice and does not need to: segment choice rests on who
pays, how many accounts exist and what the product already does (the accessorial check and the ocean D&D module),
which the research and finance files cover. Search has a narrower job, and the decision changes how we do it.

Four decisions follow, each reversible once real volume data arrives. First, shipper content leads, but it targets
the plain words an AP team uses ("accessorial", "freight invoice", "freight bill") and the "how to dispute" question,
not software phrases that barely register. Second, importer content leads alongside it and starts where importers
actually search, with what a demurrage or detention charge means and how to check one, then moves to the FMC rule
and the 30-day dispute window, where the ocean D&D module's checks give us something nobody else shows. Third,
"freight audit" stays as a long-tail target for one neutral comparison page; the public category label is
"detention, accessorial and D&D recovery for the shipper side". Fourth, carrier detention pages move to the back of the queue. They are the
largest measured demand we found, so we keep them in the plan for the partner channel and for shippers who receive
detention invoices, but no carrier page displaces a shipper or importer page.

We should be honest about the cost. Leading with the smaller-search segments means organic discovery will be slower
than a carrier-first plan would have been, if search were the channel that mattered. It is not, at this stage:
design partners come from outreach, and the shipper and importer pages exist to convert those conversations.

Two traps are worth writing down so nobody walks into them later. "Freight claim" looks like a large opportunity and
is the wrong job (cargo loss and damage). "Detention time" and "TONU" look large and are polluted by other meanings,
so any future volume figure for them must be filtered to freight intent before it informs a decision.

The investor-facing reading is equally plain. Search will not be a primary acquisition channel at this stage; the
chosen buyers rarely search for software at all. SEO earns its place by making the
company credible when a design partner looks us up, and by owning a handful of worked-example pages that nobody
else has built.

## 5. How to replace UNKNOWN with real numbers

We would close the volume gap in this order, cheapest first. Google Search Console gives real impressions and
queries for our own pages from the day a verified property exists; it measures our visibility, not market volume,
but it is free and exact. Google Keyword Planner gives market volume, but trade press reports that low-spend accounts see banded
ranges instead of exact figures; a small, time-boxed search campaign on the Cluster 1 and 2 phrases would unlock exact
figures and test messaging at the same time. A one-month paid SEO tool subscription (Semrush, Ahrefs or Moz) would add difficulty scores and competitor-ranking exports; we have not priced it and record no figure here. The
qualitative difficulty calls above should be replaced the moment any of these exist.

Source: Search Engine Land, Google officially throttling Keyword Planner data for low spending AdWords accounts, https://searchengineland.com/google-officially-throttling-keyword-planner-data-low-spending-adwords-accounts-255795, accessed 2026-10-17 (reports banded ranges such as 100-1K for low-spend accounts; Google never defined the spend threshold)

## 6. Open questions

These items are `UNKNOWN — needs primary research` and block a quantitative keyword plan:

- Absolute US monthly search volume for every keyword in section 3 (no tool account; no Keyword Planner spend).
- Keyword difficulty scores from any tool; current calls are qualitative.
- Freight-intent share of "detention time", "TONU" and "demurrage" (Trends cannot separate meanings).
- Who actually ranks on a captured Google results page (our competitor sample comes from a web-search API).
- Competitors' own organic traffic and ranking keywords. `market-researcher` named the domains to export once a tool
  exists: loop.com, cassinfo.com, traxtech.com, ctsi-global.com, corporate.nvisionglobal.com, intelligentaudit.com,
  bluecargo.io, bubba.ai (Hey Bubba, carrier detention capture; competes directly for Cluster 1), the FleetOptos Geotab listing, and portcast.io (adjacent).
- Federal Register document 2025-23920 (removal of 46 CFR 541.4) read first-hand, not via the build's source comment (bot-check and unreadable PDF on
  2026-10-17).
- Search interest in the category label marketing uses publicly, "detention and accessorial recovery" (and "detention recovery"): not in the 2026-10-17 pull; add it to `data/trends_pull.py` on the next run. We expect it to sit below the Trends threshold, which is fine for a label used on our own pages.
- Norwegian or EU keyword demand: out of scope for this step; the buyers in the business plan are US.
