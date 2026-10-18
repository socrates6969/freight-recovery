# Founder narrative

> The product, scoup.ai, is pre-product: synthetic data only, never deployed, no customers and no revenue. Figures are traced to `business/business-plan.md` and the research and finance files it cites.

## Why this problem

I came to freight billing through detention: a truck waits four hours at a dock, the carrier is owed money for it, and nobody disputes that the wait happened. What kept me was the other side of the same invoice. Every detention charge, lumper fee, reweigh and fuel surcharge lands on somebody's accounts-payable desk, and at a company too small for an audit programme that desk has no time to check it.

The evidence for that is plain and a little uncomfortable. In RXO's 2024 survey of 750 shippers and carriers, 61% of shippers called accessorial requests one of their accounting team's biggest time-wasters. In the same survey 70% said carriers are usually honest. So the problem I can document is not fraud. It is hours: a controller comparing each line with a rate confirmation that sits in a PDF, or not comparing it at all.
Source: RXO, "What Shippers & Carriers Really Think About Trucking Accessorials (Original Research)", https://rxo.com/resources/research/freight-accessorials/, accessed 2026-10-17

Importers have the sharper version. Since 28 May 2024 the Federal Maritime Commission's billing rule has said that a container demurrage or detention invoice missing required content or timing relieves the importer of paying it, and gives the importer 30 days to dispute. That is a rule a program can check, line by line, before the window closes. The largest importers already buy that check. The mid-size importer bringing in around 2,000 TEU (twenty-foot-equivalent units) a year, about $67.5M of goods, mostly does not; research puts the number of such importers somewhere between 4,160 and 20,279 (`research/02-industries.md`, "Importers by size").
Source: Thompson Hine, "FMC Issues Final Rule on Billing Requirements and Practices for Detention and Demurrage Invoices", https://www.thompsonhine.com/insights/fmc-issues-final-rule-on-billing-requirements-and-practices-for-detention-and-demurrage-invoices/, accessed 2026-10-17
Source: U.S. Census Bureau, release CB26-73, https://www.census.gov/foreign-trade/Press-Release/edb/edbrel2024.pdf, accessed 2026-10-17 (employment-size counts behind research's range)

## Why now

The rule is new, and the market around it is moving. Loop raised a $95M Series C in April 2026 and has bought mid-size books of freight audit business; Intelligent Audit launched a product for smaller shippers in 2025, parcel first. Buyers clearly pay for freight-billing software, and the incumbents are heading toward the mid-market. That is both the opportunity and the threat, and I would rather build for this segment now than explain later why we waited.
Source: AlphaMaven, "Loop raises $95M Series C", https://alpha-maven.com/story/venture-capital/loop-raises-95m-series-c, accessed 2026-10-17

The other change is in how software gets built. One person directing a disciplined pipeline of coding agents can now produce a multi-tenant platform with row-level security, separation-of-duties approvals and 136 acceptance test files across the eight days of commits between 5 and 12 October 2026. That does not make the product good. It does mean the first design partners can test a working system on their own invoices rather than react to slides.

## Why us

I am not a freight veteran, and I say so first. What I bring is a way of working that fits a product whose whole value is being believed by a controller who must answer for every short-payment. Every amount in our packets comes from deterministic rules that print their arithmetic and point at the line of the document they rest on. Nobody can approve a dispute they helped prepare; the database refuses it even if the application is bypassed. Every money rule is checked string for string against an independent implementation. None of that proves what a customer will recover, and we will not claim a figure until design partners' closed invoices give us one.

The same discipline governs the plan. We chose the contested side of the market: Loop has $160M and Intelligent Audit is moving down-market, so we compete only where a buyer wants no fee until money is found, no integration for the pilot, and a line-by-line reason before it short-pays, and we walk away elsewhere. Our base case assumes we acquire customers for $0.73 of sales and marketing per dollar of new revenue, against a $2.00 industry median, and our own review found paid channels convert about one sixth as well as we assumed; at a $31K cost per customer the plan needs a $9.98M seed rather than $7.0M. I would rather show an investor those numbers with the arithmetic than discover them a year after the money is spent. That is why the seed comes in two tranches, why the second releases only when five customers pay on measured recoveries, and why the person I most want to add to the plan is someone who has run freight billing and can tell me where my rules are wrong.

The work for the next four quarters is plain: careful conversations with mid-market shippers and mid-size importers, three to five partners sharing closed invoices under NDA, a free review on each, and the first disputes approved by a person and paid. If the money is not in their files, we will know early and say so.
