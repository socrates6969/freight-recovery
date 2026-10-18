# 04 Gaps

Status: pre-product. The product, scoup.ai, uses synthetic data only, never deployed, no paying customers. A gap below means "no competitor we profiled covers this well, and people outside our company have said they need it". It does not mean we have shown scoup.ai closes the gap; nothing here has been measured on real claims.

Research date: 2026-10-17. Competitor coverage refers to the nine companies in 01-competitors.md and the cells in 03-feature-matrix.md. Quotes were checked against the raw page text, not only a summary, unless marked otherwise.

## How we judged a gap

A capability counts as a gap when two things hold. First, no profiled competitor documents it publicly, or only one does and only for a segment we do not target. Second, we can quote demand for it from a source that is not a vendor selling the fix: a regulator, a trade survey, a court or legal analysis, or practitioners on a public forum. Vendor blogs count only as weak support and are labelled so. Where we found a plausible gap but no outside demand evidence, it goes in the last section rather than being promoted.

## Gap 1: A cited evidence packet for the carrier who is owed detention

The carrier-side tools we found (Hey Bubba, FleetOptos, Detention Source) record geofence arrival and departure and create a claim line. The FAP firms do not sell to carriers at all. Nobody we profiled documents the next step: pulling the free-time clause from the rate confirmation, the BOL or POD times, the appointment record, the geofence log and any lumper receipt into one packet where every number points at its source. That packet is the core of scoup.ai’s claims module.

The demand evidence is about proof, not about tracking. Carriers say claims die because they cannot show the time in a form the payer accepts.

- ATRI: "94.5 percent of fleets charge detention fees", yet they are paid for "fewer than 50 percent of those invoices" (release of 10 September 2024).
  Source: American Transportation Research Institute, https://truckingresearch.org/2024/09/new-research-documents-substantial-financial-and-safety-impacts-from-truck-driver-detention/, accessed 2026-10-17
- DAT survey of 257 carriers: "Only three percent of carriers were paid on 90 percent or more of their detention claims, at a rate between $30 and $50 per hour" (14 July 2016; old, but the only survey we found that measures paid share per carrier).
  Source: DAT Solutions, https://www.dat.com/company/news-events/news-releases/63-percent-of-drivers-are-detained-for-more-than-3-hours-per-stop-dat-solutions, accessed 2026-10-17
- A driver on TheTruckersReport, describing how they protect claims (August 2025): "I always note my arrival and departure times on my freight bill as well as a note for the reason (ie, "line of trucks", "out of product", "mill down for repairs"...". The same thread’s poll had 7 of 13 votes (53.8%) for "They just ignore my request / It’s too much hassle to fight for it". The sample is tiny; we quote it for the wording, not the percentage.
  Source: TheTruckersReport forum, https://www.thetruckersreport.com/truckingindustryforum/threads/whats-the-1-reason-your-detention-claims-get-denied-poll.2529156/page-3, accessed 2026-10-17
- The same thread shows what happens when the evidence is automatic: "Where I’m at as a company driver we’re geo-fenced at all locations so the wait time is automatically accounted for and paid. Drivers don’t have to do anything it pays like clockwork." That is a large fleet with its own systems; the 5 to 100 truck carrier usually has the geofence data in an ELD and no one to turn it into a claim.
  Source: same thread, accessed 2026-10-17

Why it stays open: tracking vendors stop at the timestamp because the packet needs document extraction and contract reading, which is a different product. Audit firms stop at the invoice because the carrier is not their customer.

## Gap 2: Machine-readable detention terms when every broker writes its own

Detention terms are not standard. Free time, hourly rate, cap, notice requirements and disqualifying conditions vary by broker and shipper, and they live in rate confirmations and broker policies. FleetOptos says it applies "contract-specific billing rules (free time allowances, hourly rates)", which suggests the rules are configured by hand. No profiled competitor documents extracting those terms from the document into rules that a calculation can cite.
Source: Geotab Marketplace, FleetOptos listing, https://marketplace.geotab.com/solutions/fleetoptos/, accessed 2026-10-17

- A carrier posting in January 2025: "Detention pay on a industry standard was 2 hrs, 3hrs, and sometimes 4 hrs. A broker told hs that their us no standard." In the next post the same user quotes a broker’s written refusal: "Per our company policy in line with industry standards. We cannot and will not compensate for any layovers or detention if the driver left the shipper before getting loaded."
  Source: TheTruckersReport forum, "Broker doesn’t want to pay / one of those days", page 2, https://www.thetruckersreport.com/truckingindustryforum/threads/broker-doesn%E2%80%99t-want-to-pay-one-of-those-days.2519612/page-2, accessed 2026-10-17
- Another member (August 2025): "They all have different policy and procedures there though so it’s not uniform and can be a headache."
  Source: TheTruckersReport forum, poll thread above, accessed 2026-10-17

Why it stays open: rule bases at the audit firms are built for contract freight rates at large shippers, and the carrier tools have no document intake. The rules engine in scoup.ai already separates extracted terms from the calculation; whether extraction holds up on real rate confirmations is unmeasured.

## Gap 3: FMC-rule checks and dispute deadlines for small and mid-size importers

This one is a partial gap, and we say so. BlueCargo markets invoice checks "against OSRA invoice requirements" and "Dispute resolution with evidence-backed documentation", and claims "1 in 5 Top US Shippers" as customers. That covers the large importer at the big ports. We found no competitor that packages the same checks for the 234,023 SME importers in the Census profile, or ties the 30-day dispute clock into a claims workflow that also handles truck detention for the same shipments.
Source: BlueCargo, home page, https://www.bluecargo.io/home-tests, accessed 2026-10-17
Source: U.S. Census Bureau, release CB26-73, https://www.census.gov/foreign-trade/Press-Release/edb/edbrel2024.pdf, accessed 2026-10-17

The rule itself creates the demand, because a missed deadline or a missing field changes who pays.

- Thompson Hine on the FMC final rule: "Failure of the billing party to abide by the invoice content and timing requirements relieves the billed party’s obligation to pay an invoice for detention and demurrage charges." And: "The party that receives the invoice has 30 calendar days from the date of issuance to request mitigation, refund, or waiver".
  Source: Thompson Hine, https://www.thompsonhine.com/insights/fmc-issues-final-rule-on-billing-requirements-and-practices-for-detention-and-demurrage-invoices/, accessed 2026-10-17
- After the D.C. Circuit’s September 2025 ruling: "Apart from the vacatur of 46 C.F.R. § 541.4, the FMC’s Final Rule on demurrage and detention remains in effect."
  Source: Thompson Hine, 26 September 2025, https://www.thompsonhine.com/insights/court-sets-aside-part-of-fmcs-demurrage-and-detention-billing-rule/, accessed 2026-10-17
- Volume of disputes: "HTA members disputed more than 3 million detention and demurrage charges in 2020, according to the organization. The majority of survey participants (65%) said the most common reason for disputes was "no available appointments."" (Harbor Trucking Association, reported by Supply Chain Dive.)
  Source: Supply Chain Dive, Harbor Trucking Association survey coverage, https://www.supplychaindive.com/news/detention-demurrage-port-congestion-fees-Harbor-Trucking-Association-TradeLanes/594406/, accessed 2026-10-17
- Money at stake: the nine largest carriers "have collected roughly $15.4 billion in D&D charges between April 1, 2020, and March 31, 2025."
  Source: Federal Maritime Commission, https://www.fmc.gov/detention-and-demurrage/, accessed 2026-10-17

Why it stays open for SMEs: the specialist serves the top of the market, and the FAP firms treat D&D as one more audit line. At our assumed recovery rate (02-industries.md) this is a feature that wins importer accounts, not a business on its own.

## Gap 4: One packet the broker can use on both sides of the load

A broker that approves a carrier’s detention claim usually wants to rebill the shipper with the same proof. No profiled competitor documents producing a packet meant to travel from carrier to broker to shipper. Loop sells to brokers, but its public pages describe audit and payment, not detention rebilling.
Source: Loop, home page, https://www.loop.com/, accessed 2026-10-17

- DAT: "Two-thirds of brokers surveyed said they paid detention only when they could collect the fee from the shipper or consignee, while the other one-third of brokers paid detention whenever carriers complained." Brokers that were "reimbursed by their shipper customers were twice as likely to compensate carriers for detention."
  Source: DAT Solutions, 14 July 2016, https://www.dat.com/company/news-events/news-releases/63-percent-of-drivers-are-detained-for-more-than-3-hours-per-stop-dat-solutions, accessed 2026-10-17
- Counter-evidence we must keep in view: the same release says that among 50 brokers "only 20 percent agreed that detention was one of their top five problems". Demand on the broker side may be weaker than on the carrier side.

Why it stays open: each existing tool is built for one party. A two-sided packet only makes sense to a vendor that sells to both, and the incumbents sell to shippers.

## Gap 5: Auditing accessorials and fuel surcharge against the shipper’s own rate confirmation and FSC table (added 2026-10-17)

This is the capability the architect lists as lead innovation I1: check each carrier accessorial and fuel-surcharge line against the shipper’s own rate confirmation and fuel-surcharge (FSC) schedule, and produce a short-pay packet. Coverage: Trax and Intelligent Audit say they audit accessorials (01-competitors.md), so this is not unserved at the enterprise end; the gap is the mid-market shipper, where no profiled competitor publishes a freight (non-parcel) offer.

What we searched on 2026-10-17: shipper surveys on freight invoice errors and accessorial overcharges (CSCMP, Gartner, ARC, APQC, Logistics Management, SupplyChainBrain), shipper associations (NASSTRAC), practitioner forums (Reddit, TheTruckersReport) and analyst reports. Results:

- Found, independent of audit vendors: RXO’s survey of 750 shippers and carriers on truckload accessorials (published 25 November 2024). RXO is a freight broker, not an audit vendor, so it has no audit product to sell, but it is not neutral either. Verbatim findings for shippers:
  - "61% of shippers agree that managing accessorial requests is one of the biggest time-wasters for their accounting team."
  - "65% of shippers think accessorials they have a moderate impact to their freight budget and 19% thinking they have a significant impact."
  - "71% are actively working on reducing accessorial spend with strategic initiatives, and a further 26% are planning to do so in the near future."
  - "80% of shippers would rather pay higher freight rates up front than deal with accessorials on the back end."
  - Counter-evidence, which matters for the pitch: "70% of shippers agree that carriers are usually honest when requesting accessorials — only 8% thought there was outright dishonesty", and "67% of shippers think they’re paying the industry standard".
  Source: RXO, "What Shippers & Carriers Really Think About Trucking Accessorials (Original Research)", https://rxo.com/resources/research/freight-accessorials/, accessed 2026-10-17
- Found, old: Transplace’s accessorial benchmarking study of more than 150 shippers with over $12 billion of annual freight spend, which found the fuel surcharge to be the most common accessorial that shippers publish (93% of companies, per search summaries of the article; SupplyChainBrain dates it 2014). It supports the premise that shippers hold their own FSC schedules to audit against. We could not read the article text (several mirrors returned HTTP 403 or no readable text).
  Source: SupplyChainBrain, "Fuel Surcharges Are Most Common Accessorial Published by Shippers: Benchmarking", https://supplychainbrain.com/articles/18205-fuel-surcharges-are-most-common-accessorial-published-by-shippers-benchmarking, accessed 2026-10-17
- Not found: any CSCMP, Gartner, ARC, APQC or NASSTRAC figure on the rate of accessorial or FSC overcharges at shippers. The error-rate figures that circulate (3% to 10% of invoices, 1% to 9% of spend) trace back to audit vendors or vendor-cited consultancies and stay grade C. A Flock Freight / Drive Research figure that "83.9% of LTL shippers" are charged accessorials often appears in search summaries, but the press release page returned no readable text, so we do not use it. We found no shipper-side practitioner thread on Reddit through search.

Reading: the independent evidence supports I1 as a workload problem (accessorial requests eat accounting time, and shippers want them simpler) more than an overcharge problem (most shippers think carriers are honest and rates are standard). The pitch for I1 should lead with "verify every accessorial and fuel line in minutes against your own terms" rather than "carriers are overbilling you". The size of recoverable overcharges for mid-market shippers stays an assumption (1% of spend) until design-partner data replaces it.

## Candidate gaps without outside demand evidence

These are capabilities scoup.ai has that we did not find documented by any profiled competitor. We did not find independent sources asking for them, so they are not counted as gaps above. Each needs buyer interviews before anyone puts it in a pitch.

- Four-eyes approval before a claim or demand letter is sent. No competitor page we read describes a second-person approval gate on outgoing disputes. The business plan cites the risk that a carrier hesitates to dun a shipper it depends on; that is our own reasoning, not buyer testimony.
- Fuel-surcharge outlook. Fuel surcharge is widely described as the largest accessorial, but our only sources for its size are vendor blogs (grade C), and we found no buyer asking for a forecast.
- Charge intelligence and priority scoring (which open charges to dispute first). Plausible for a small back office with limited hours; no outside evidence gathered.
- Dispute-outcome data (which evidence wins against which counterparty). This is the moat the business plan describes. It does not exist until there is real claim volume, and no buyer can ask for a dataset they have never seen.

## What this means for the pitch

The owner has since chosen a shipper- and importer-first strategy (2026-10-17). Read against it, Gap 3 (FMC-rule checks and dispute deadlines for SME importers) is the gap that sits inside the core market, though BlueCargo covers the enterprise end. The strongest gap with outside evidence is still Gap 1, which is carrier-side and therefore a later, partner-led segment; its evidence also explains why shippers receive detention claims they cannot verify. Gap 2 is the technical reason Gap 1 is hard and applies equally to a shipper checking a carrier’s claim against the rate confirmation. Gap 4 is a distribution idea with mixed evidence. We found no independent shipper survey on accessorial disputes, which is the main evidence hole for the core segment. None of these has been tested with a paying customer, and the honest pitch says the evidence shows a problem people describe, not a product people have bought.
