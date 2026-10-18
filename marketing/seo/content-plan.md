# Content plan: pillars, clusters and a 12-month calendar

> **Status.** scoup.ai is pre-product: synthetic data only, no customers, no live product, never sold. Nothing in this
> plan has been published or measured. The calendar is a capacity plan for one founder plus a freight-domain
> reviewer we have not yet recruited; it is not a traffic forecast and carries no traffic, ranking or lead targets.
> Keyword evidence and its limits are in `keyword-research.md`. This plan builds on `marketing/seo-and-growth.md`
> sections 3 to 5 and on the site map in `marketing/landing/outline.md`. Re-ordered on 2026-10-17 for the owner's
> shipper- and importer-first decision; carriers are a later or partner channel.

## 1. What content has to do for us right now

The owner decided on 2026-10-17 that scoup.ai goes to market shipper- and importer-first, with carriers as a later
or partner channel. This plan is ordered by that decision. Our go-to-market still starts with design-partner
outreach, not search, because nobody has yet confirmed on real closed files that the leakage we model is real.
Content therefore has three jobs, in this order. It must make the company credible when a shipper's AP lead or an
importer's logistics manager looks us up after an outreach email. It must give the founder specific things to send
in that outreach: an annotated sample, a checklist, a line-by-line dispute walkthrough. And it must own a few pages
nobody else has built, such as an invoice line checked against its contract clause with the arithmetic shown, or an
ocean D&D invoice checked element by element against the FMC rule. Volume of posts is not a job.

The keyword pull tells us how to write for these buyers rather than whether to. Software phrases a shipper might
type ("freight audit software", "freight invoice audit") sit at or below the Google Trends threshold, but the plain
words an AP team uses do register: "freight bill" at 3.88 times the interest of "freight audit", "freight invoice"
at 1.47 times, "accessorial" at 0.88 times. Importers search for what a charge means ("demurrage" 4.88 times, broad;
"demurrage charges" 0.22) and for carriers' tariffs far more than for the rule. Carrier detention terms remain the
largest clean demand we measured ("detention pay" 2.33 times), which is why carrier pages stay in the plan at the
back, ready for the partner channel.

Source: Google Trends, US, 2021-10-01 to 2026-09-30, `marketing/seo/data/trends_summary.csv` and `marketing/seo/data/trends_summary_F_importer_G_shipper.csv`, pulled 2026-10-17 (ratios are our arithmetic; see `keyword-research.md` section 2)

## 2. Pillars and clusters

Each pillar is a hub page with spokes, numbered in the owner's priority order. The content pillars map onto the
three messaging pillars `marketing` settled in `marketing/brand/README.md` section 4: (1) proof attached, (2) a
person decides, (3) built for the loads big audit programs skip. The public category label is "detention, accessorial
and D&D recovery for the shipper side", not "freight audit"; "freight audit" stays only where a searcher uses it (Cluster 4). The
shipper hero is marketing's workload line, "Take accessorial review off AP's desk. Every line checked against the
rate confirmation, with the source attached" (`marketing/marketing-plan.md` section 2.3). Shipper page titles and
descriptions lead with that workload framing where it fits the query (solution page, "how to check a freight invoice",
the AP walkthrough). Dispute-intent pages ("how to dispute accessorial charges") keep titles that answer the dispute
question directly, because that is what the searcher typed. "Stop paying accessorials that were never authorized"
stays as the A/B alternate and as an H1 option for `/accessorial-audit/`. The reason for the switch is a broker's
survey: RXO, a freight broker with no audit product but not neutral, reports that "61% of shippers agree that
managing accessorial requests is one of the biggest time-wasters for their accounting team" (750 shippers and
carriers, published 25 November 2024). Any page quoting it says it is a broker survey and carries this source line.

Source: RXO, What shippers and carriers really think about trucking accessorials (original research, 25 November 2024), https://rxo.com/resources/research/freight-accessorials/, accessed 2026-10-17 (via `research/04-gaps.md` gap 5)

The
importer hero line is "Check every D&D invoice before the 30-day window closes", supported by "We check each
container detention and demurrage invoice against the FMC billing rule's content and timing requirements, and list
what to dispute and by when" (`marketing/marketing-plan.md` section 2.3). Every page that describes the rule carries
the Thompson Hine source and the note "confirm with counsel or your customs broker". Shipper pages speak to the transportation or logistics manager (champion), the
AP manager or controller (user) and the CFO or VP finance (buyer); importer pages to the import or logistics manager
and AP. Carriers are a later channel reached through factoring and broker partners, so carrier pages (P5) are
written to be forwarded by those partners. The keyword clusters are the ones in
`keyword-research.md` section 3, renumbered there on the same date (Cluster 1 shipper, Cluster 2 importer, Cluster 5
carrier).

"Proof attached" leads every page. "A person decides" is the answer to the trust objection ("will you dispute lines on
our behalf?"), placed in the body and FAQ, not in titles or H1s, because `research/04-gaps.md` found no outside demand
for approval controls. Wherever the ATRI figures appear, the page says they measure the cost of waiting, not
recoverable dollars. Importer pages may describe the ocean D&D module only as pre-product software tested on
synthetic invoices, with no accuracy or recovery claim.

| Pillar (hub URL) | Promise to the reader | Keyword clusters | Messaging pillar | Primary audience | Role |
|---|---|---|---|---|---|
| P1 Accessorial review, off AP's desk (`/guides/accessorials/`) | How to check each freight invoice line against the rate confirmation, and dispute the ones that do not match | Cluster 1, Cluster 6 | Proof attached (trust answer: a person decides) | Mid-market shipper AP and logistics | Lead segment; design-partner conversion |
| P2 Demurrage and detention, checked (`/guides/demurrage-detention/`) | What a D&D charge means, what the FMC rule requires on the invoice, and how to dispute inside 30 days | Cluster 2 | Proof attached | Small and medium importers, their forwarders | Lead segment; authority and conversion |
| P3 The contract is the evidence (`/guides/rate-confirmation/`) | Which rate-confirmation and tariff clauses decide an accessorial or D&D dispute | Cluster 3 | Proof attached | Shippers and importers | Bridge between P1 and P2 |
| P4 Choosing a recovery approach (`/freight-audit-alternatives/`, `/pricing/`) | Honest comparison of in-house, TMS module, outsourced audit (Loop and Intelligent Audit's Catalyst contest small shippers), ocean D&D tools (BlueCargo is strong; we concede it) and us, conceding incumbents' strengths first; our angle is the per-line evidence packet, contingency pricing and one workflow for truck detention and container D&D on the same shipments (dated sources in `marketing/marketing-plan.md` section 2.2) | Cluster 4 | Built for the loads big audit programs skip | Shippers and importers evaluating vendors | Decision support |
| P5 Detention you can prove (`/guides/detention/`) | How truck detention is calculated, billed and paid, with the arithmetic | Cluster 5, Cluster 6 | Proof attached | Carriers (later and partner channel); shippers receiving detention invoices | Deferred; partner channel |

Every spoke follows the explainer template in `marketing/landing/outline.md`: the question as H1, a direct answer in
the first 100 words, a worked example with arithmetic, "what varies by contract", primary sources with dates, a
named author and reviewer (reviewer named only with consent), and one next step. Worked examples use synthetic loads
and synthetic ocean invoices from the repository's fixtures and say so.

Internal linking is planned, not left to chance. Every spoke links up to its hub and across to the matching solution
page: `/accessorial-audit/` for P1 and `/demurrage-detention-audit/` for P2 (a new URL; the landing outline had no
importer page). P3 links to both. The sample evidence packet is linked from every P1 and P2 page, because it is what a
design-partner conversation is built around. Carrier pages (P5) link back into P1, since a shipper is the party who
receives a carrier's detention invoice.

## 3. Twelve-month calendar (November 2026 to October 2027)

The calendar assumes about two substantial pieces a month, which is what one founder can write and get reviewed while
running outreach. Nothing publishes until the domain is secured and the site fixes in `technical-checklist.md` are
done; that hold stands. Quarter one builds the shipper and importer foundations, quarter two the dispute playbooks
and checklists outreach needs, quarter three the decision pages and original-data pieces, and carrier pages wait
until the partner channel opens. A "DP" mark means the piece is built to be sent in design-partner outreach or to
convert a visitor into a design-partner conversation. Any month can slip; the order matters more than the dates.

| Month | Piece | URL | Pillar / cluster | Format | DP | Gate before publishing |
|---|---|---|---|---|---|---|
| Nov 2026 | Site fixes, domain decision, Search Console property | n/a | n/a | Technical | | `technical-checklist.md` P0 items done; domain secured |
| Nov 2026 | Sample evidence packets: one shipper accessorial invoice, one ocean D&D invoice (synthetic) | `/evidence-packet-example/` | P1/P2 | Annotated samples | DP | Every figure traced to a fixture; "synthetic" label on every page |
| Dec 2026 | Shipper solution page | `/accessorial-audit/` | P1 / C1 | Solution page | DP | No capability claim beyond the prototype |
| Dec 2026 | How to dispute accessorial charges, line by line | `/guides/dispute-accessorial-charges/` | P1 / C1 | Playbook + checklist | DP | Domain-reviewer pass |
| Jan 2027 | Importer solution page | `/demurrage-detention-audit/` | P2 / C2 | Solution page | DP | Module described as pre-product, synthetic data only |
| Jan 2027 | Demurrage vs detention: what each charge means and who bills it | `/guides/demurrage-vs-detention/` | P2 / C2 | Explainer | | Reviewer pass |
| Feb 2027 | FMC D&D invoice checklist (printable) | `/guides/fmc-dd-invoice-checklist/` | P2 / C2 | Checklist (section 5, item 3) | DP | Current 46 CFR 541 text and FR doc 2025-23920 read first-hand; counsel review |
| Feb 2027 | How to check a freight invoice before you pay it | `/guides/how-to-check-a-freight-invoice/` | P1 / C1 | AP walkthrough | DP | Reviewer pass |
| Mar 2027 | How to dispute demurrage charges inside the 30-day window | `/guides/dispute-demurrage-charges/` | P2 / C2 | Playbook | DP | Same rule check as February |
| Mar 2027 | Glossary hub (accessorial, lumper, demurrage, detention, per diem, free time, TONU) | `/guides/glossary/` | C6 | Glossary | | One primary source per entry |
| Apr 2027 | Rate-confirmation and tariff clauses that decide accessorial and D&D disputes | `/guides/rate-confirmation-detention-clauses/` | P3 / C3 | Annotated clause guide | DP | Reviewer pass; no third-party templates copied |
| Apr 2027 | Fuel surcharge check: EIA diesel index and your FSC table | `/guides/fuel-surcharge-check/` | P1 | Original-data tool (section 5, item 2) | DP | EIA reuse policy read; weekly update job tested |
| May 2027 | Lumper fees: when they are legitimate, when to flag them | `/guides/lumper-fees/` | P1 / C1 | Explainer | | Reviewer pass |
| May 2027 | How to dispute a detention charge (shipper side) | `/guides/dispute-a-detention-charge/` | P1 / C1 | Playbook | DP | Reviewer pass |
| Jun 2027 | Ocean D&D free-time tracker (public carrier tariffs) | `/guides/dd-free-time-tracker/` | P2 / C2 | Original-data tracker (section 5, item 6) | | Feasibility and terms check per carrier site |
| Jun 2027 | Recovery calculator, shipper and importer variants (spec: `marketing/landing/calculator-spec.md` plus marketing's draft variants in `marketing/brand/calculator-variants.md`, pending merge) | `/calculator/` | P1/P2 | Tool | DP | Unit test of the worked example; CSP change reviewed (it needs script) |
| Jul 2027 | Freight audit and D&D audit alternatives for mid-market shippers and importers | `/freight-audit-alternatives/` | P4 / C4 | Neutral comparison | DP | Every competitor fact verified from their own pages that week, date-stamped |
| Jul 2027 | Pricing: the contingency model explained | `/pricing/` | P4 / C4 | Decision page | DP | Only after a real offer exists; no fee number before that |
| Aug 2027 | What detention and D&D cost, and why cost is not recoverable dollars | `/guides/detention-cost-data/` | P1/P2 | Original-data explainer (section 5, item 1) | | ATRI, DOT OIG and FMC figures re-checked against live sources |
| Aug 2027 | How truck detention is calculated: clock start, free time, rounding, cap (shipper lens) | `/guides/how-detention-is-calculated/` | P5 / C5 | Worked example | | Reviewer pass |
| Sep 2027 | Building in public: what design partners taught us (no metrics unless consented) | `/notes/…` | P1/P2 | Founder note | DP | Partner consent for any detail |
| Sep 2027 | Refresh pass on every page older than six months | n/a | all | Maintenance | | Search Console data, if any |
| Oct 2027 | Carrier solution page, only if the partner channel has opened | `/detention-recovery/` | P5 / C5 | Solution page | | Owner go-ahead on the carrier channel |
| Oct 2027 | Re-plan from twelve months of real Search Console and outreach data | n/a | n/a | Review | | Keyword volumes replaced where measured |

Moved out of the twelve months by the owner's decision, and kept ready for the carrier partner channel: detention
pay for carriers (`/guides/detention-pay/`), detention and the 14-hour clock (section 5, item 4), and detention rule
variants computed side by side (section 5, item 5). Nothing in the calendar depends on customer data. If a design
partner later consents to an anonymised case study, it slots in as an extra piece; it never replaces a gate.

## 4. Which pieces win design partners, and how they are used

Design partners will come mostly from outreach and warm introductions, so the DP pieces are built to be attached to a
message rather than found. Each answers one objection a shipper or importer raises before agreeing to share closed
invoices. The sequence below is how we expect the founder to use them; it is a hypothesis to test in the first ten
conversations, and the order will change with what partners actually ask.

| Objection a prospect raises | Piece that answers it | How it is used |
|---|---|---|
| "What would I actually get?" | Sample evidence packets (accessorial and ocean D&D, synthetic) | Linked in the first outreach email; the most concrete thing we have |
| "Which invoice lines would you even question?" | How to check a freight invoice; dispute accessorial charges; contract clauses guide | For shipper AP leads; shows the line-against-clause check |
| "Our D&D invoices come from big carriers; what is there to check?" | FMC D&D invoice checklist; dispute demurrage charges | For importers; the checklist mirrors the module's field-by-field checks |
| "Is there money in this for us?" | Recovery calculator (shipper and importer variants) | Prospect enters their own numbers; output is a range with the arithmetic, never a promise |
| "We already have an audit firm / a D&D tool" | Alternatives page; shipper and importer solution pages | Honest about where incumbents are stronger; positions the evidence packet as the gap |
| "What happens to our documents?" | Existing `/security/` page plus the draft handling terms | Before any file changes hands; nothing real is accepted until the controls on that page exist |

The pieces without a DP mark (glossary, D&D explainer, free-time tracker, cost explainer, carrier pages) exist for
search authority, links and the later carrier channel. They should not displace a DP piece when time runs short.

## 5. Original-data content from public sources (no customer data)

These ideas produce something nobody else publishes in this exact form, using only public data and our own rules
engine run on synthetic inputs. Each lists its source, what we would compute, and the honesty limit it must carry.
None requires a design partner's data, which is why they can start before the first pilot. Under the shipper- and
importer-first decision the order of use is items 3, 6, 2 and 1 in the twelve months; items 4 and 5 are carrier
pieces held for the partner channel; item 7 can go any time.

**1. What detention costs, separated from what is recoverable.** ATRI's September 2024 research reports that "the
trucking industry lost $3.6 billion in direct expenses and $11.5 billion in lost productivity from driver detention in
2023", that drivers were detained at 39.3 percent of stops, and that while 94.5 percent of fleets charge detention
they are paid on fewer than 50 percent of invoices. The two dollar figures sum to $15.1 billion (our arithmetic:
3.6 + 11.5). The US DOT Office of Inspector General's January 2018 report estimated a $1.1 to $1.3 billion annual
earnings loss for for-hire truckload drivers and said accurate industry-wide detention data do not exist. The piece
explains, with arithmetic, why lost productivity is not a pool of recoverable invoices, which is the distinction
`seo-and-growth.md` already insists on.

Source: American Transportation Research Institute, New research documents substantial financial and safety impacts from truck driver detention (10 September 2024), https://truckingresearch.org/2024/09/new-research-documents-substantial-financial-and-safety-impacts-from-truck-driver-detention/, accessed 2026-10-17
Source: US DOT Office of Inspector General, Estimates show commercial driver detention increases crash risks and costs, but current data limit further analysis (ST2018019, 31 January 2018), https://www.oversight.gov/reports/audit/estimates-show-commercial-driver-detention-increases-crash-risks-and-costs-current, accessed 2026-10-17

**2. Fuel surcharge check against the EIA diesel index.** Where a contract's fuel surcharge table references the EIA
weekly US on-highway diesel price (how common that is: `UNKNOWN — needs primary research`), the index is public and
EIA releases it on Tuesdays (latest shown on 2026-10-17: $6.179 per gallon for the week
of 12 October 2026, released 14 October). A page that recomputes the surcharge a table implies for any week, from
the published index, lets a shipper check an FSC invoice line in a minute. EIA data are free through its open-data
API with a free key and are subject to EIA's copyright and reuse policy, which we must read before shipping. The TS
build (branch `feat/hardening`) already has a fuel-surcharge check (`api/src/intelligence/fuel.ts`) that compares an
invoice's FSC line with a tenant's surcharge table and an imported diesel price series; it runs on synthetic data only,
so the page may present it as a pre-product feature with no accuracy claim. (An earlier draft said no such rule
existed; that was wrong.)

Source: US Energy Information Administration, Gasoline and diesel fuel update, https://www.eia.gov/petroleum/gasdiesel/, accessed 2026-10-17
Source: US Energy Information Administration, Open data (API), https://www.eia.gov/opendata/, accessed 2026-10-17

**3. FMC demurrage and detention invoice checklist.** The FMC's 2024 rule (46 CFR part 541) sets minimum information
for D&D invoices, a 30-day invoicing deadline for ocean carriers and terminal operators, and at least 30 days for the
billed party to request mitigation, refund or waiver. A printable checklist mapping each required element to "present
or missing" on an invoice is useful and checkable. It mirrors the field-by-field checks in the build's ocean D&D module (`packages/shared/src/ocean-dd/`), so it doubles
as an honest preview of that feature, labelled pre-product and synthetic. Since a September 2025 D.C. Circuit ruling
vacated only 46 CFR 541.4, the content and dispute provisions the checklist uses remain in force; Federal Register
document 2025-23920 must still be read first-hand.

Source: HFW, FMC's new demurrage and detention regulations become effective May 2024, https://www.hfw.com/insights/fmcs-new-demurrage-and-detention-regulations-become-effective-may-2024, accessed 2026-10-17

**4. Detention and the 14-hour clock.** The federal hours-of-service rule for property carriers (49 CFR part 395)
limits driving to a 14-hour on-duty window (our reading of the rule; the FMCSA summary page returned HTTP 403 on
2026-10-17, so the text must be checked on eCFR before publishing). A worked example on a synthetic load shows how many driving hours a
three-hour detention removes and what that means for the next load. We cite the regulation text directly and do not
model safety outcomes ourselves; the DOT OIG crash estimate above is quoted as theirs.

**5. Detention rule variants computed side by side.** Our rules engine already implements clock start (arrival vs
appointment), free time, rounding and caps. Running one synthetic arrival and departure through a dozen common
contract patterns and printing every result with its arithmetic produces a reference table nobody publishes. It is
our own computation on synthetic data and is labelled that way; a domain reviewer confirms the patterns are realistic.

**6. Ocean D&D free-time tracker.** Google Trends shows "msc detention and demurrage tariff" as a rising related query
(+650 percent over the window), so importers look for carrier tariffs. A tracker that records each major ocean
carrier's published free days per port, with the source page and the date we read it, would be original and
linkable. It is the most effort and the furthest from the product, so it sits last, after a check of each carrier
site's terms of use.

Source: Google Trends related queries for "demurrage", US, 2021-10-01 to 2026-09-30, `marketing/seo/data/trends_related.csv`, pulled 2026-10-17

**7. What shippers, importers and carriers search for.** A short public note on our own Trends pull (method, script, the
"freight claim" trap, the gap between carrier vocabulary and software vocabulary) is honest, cheap and useful to
other people in the niche. It reports relative interest only.

## 6. Rules every piece follows

These rules come from the project's honesty constraints and from what Google has said about structured data. Every
number is either cited to a primary source with a date or labelled as our arithmetic or an illustration. No page
claims a recovery rate, an accuracy figure, a customer, a certification or an integration, because none exists. A
freight-domain reviewer checks every P1, P2 and P3 piece before it goes live; until we have recruited one, those
pieces stay in draft. Comparison content uses only facts competitors publish about themselves, re-checked the week
we publish. We mark up FAQ sections honestly but expect no FAQ rich result: since August 2023 Google shows FAQ rich
results only for well-known government and health sites.

Source: Google Search Central Blog, Changes to HowTo and FAQ rich results (8 August 2023), https://developers.google.com/search/blog/2023/08/howto-faq-changes, accessed 2026-10-17

## 7. How we will know whether it works

We set no traffic targets, because there is no baseline and no measured volume. The measures that matter in year
one, in order, are: design-partner conversations where the prospect had opened a DP piece (tracked by asking, and by
tagged links in outreach); Search Console impressions and queries per pillar once the site is verified on its final
domain; and which pieces prospects forward inside their own company. Numeric targets get written down only after two
months of real data, and they are written as targets, never as results.

## 8. Open questions

- Domain: scoup.ai did not resolve on 2026-10-17 and the .ai registry's RDAP service returned "Object not found";
  publishing content before the final domain is secured means rebuilding search equity later. See
  `technical-checklist.md` item T1.
- A freight-domain reviewer: none recruited; every P1 to P3 piece is blocked on one.
- Merge of marketing's shipper and importer calculator variants (`marketing/brand/calculator-variants.md`) into `marketing/landing/calculator-spec.md`; the owner of `marketing/landing/` has not been assigned.
- Share of fuel surcharge tables keyed to the EIA index: `UNKNOWN — needs primary research`.
- First-hand reading of Federal Register document 2025-23920 and of 49 CFR part 395 (blocked or unreadable on 2026-10-17).
- Absolute search volumes for every target keyword: `UNKNOWN — needs primary research` (see `keyword-research.md`).
