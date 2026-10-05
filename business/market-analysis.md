# Freight Recovery - Market Analysis

> **Status: pre-product.** Sizing is directional. Competitor descriptions are characterizations from general knowledge and earlier vendor-page research, **not** verified this session (live search budget was exhausted). Verify before external use. Grades: A primary/audited, B reputable secondary, C vendor/aggregator.

## 1. Market sizing (honest version)

### Top-down figures and why they mislead

| Figure | Value | Source | Grade | Use it for |
|---|---|---|---|---|
| Detention cost to US trucking | $15.1B/yr | ATRI Sept 2024 via trade press | B | Shows scale of the problem. **Not** a revenue TAM. |
| Freight audit and payment (FAP) market | ~$3.1B, ~6.8% growth | market-report / vendor blogs | **C** | Rough order of magnitude for the *incumbent services* market. Method unknown. Do not cite as fact. |
| Freight invoice error rate | 1-9% of spend | audit vendors | **C** | Marketing number from sellers of audits. |

**The vendor-figure caveat.** The most-quoted numbers in this category (invoice error %, FAP market size, "billions unclaimed") come from companies that sell audit services or market-research reports. They are inflated by incentive and rarely show method. Only the ATRI detention study is a credible third-party anchor, and even it measures cost, not recoverable revenue.

### Bottom-up (the only version worth defending)

Revenue = accounts x (freight spend or detention billing per account) x recoverable % x fee %.

Worked example, **all inputs ASSUMPTIONS, none measured**:
- Mid-market shipper, $20M annual freight spend.
- Recoverable unauthorized/unsupported accessorials and errors: 1.0% of spend = $200K/yr (the audit industry's 1-3% claim is grade C; we take the low end).
- Fee 20% gives **$40K revenue per account per year**.

At $40K/account: 250 accounts = $10M; 2,500 accounts = $100M. The relevant question is not "how big is $15.1B" but "how many accounts fit, can we reach them, and is 1% real". **The number of US mid-market shippers and small carriers in the target band is not sourced yet; to be sized from FMCSA carrier census data and shipper databases (TODO).**

**Honest read:** a real but modest market for a standalone company. Tens of millions of ARR is plausible in a good case; hundreds of millions needs thousands of accounts. More likely a strong niche business or acquisition target than a $1B standalone.

## 2. Competitor teardown

| Company | What it is (characterization, verify) | Customer focus | Model | Gap relative to us |
|---|---|---|---|---|
| **Cass Information Systems** | Public company; freight invoice audit and payment processing, bank-affiliated | Large shippers | Processing fees / payment economics | Enterprise and payment-centric; long tail and accessorial-dispute automation not the focus |
| **Trax Technologies** | Global transport-spend management and freight audit (vendor says ~$24B transport spend processed, grade C) | Large enterprise, multinational | Software + managed service | Enterprise integration weight; mid-market economics unclear |
| **CTSI-Global** | Freight audit/payment and managed logistics services | Mid-to-large shippers | Services-led | Services model; cost to serve small accounts is high |
| **Intelligent Audit** | Freight audit and payment, pricing/claims services | Shippers incl. mid-market | Audit fees / software plus service | Contract-rate matching focus; messy accessorial evidence still manual |
| **Loop** | AI-native freight invoice/audit automation | Shippers/3PLs (shipper-side) | SaaS | Closest AI-native competitor; biggest threat if it moves carrier-side or into dispute workflow. Funding and traction not verified. |
| *Adjacent:* **project44, FourKites** | Real-time transportation visibility | Shippers, carriers, brokers | Platform subscription | They hold the **timestamps** that prove detention; they sell visibility, not recovery. Potential partner, data source, acquirer, and, if they add a detention-claims module, competitor. |
| *Adjacent:* TMS-embedded audit (Oracle, Blue Yonder, MercuryGate) | Audit as a TMS feature | TMS customers | Bundled | Good enough for TMS users; weak for carriers and non-TMS shippers |

Pattern: legacy FAP firms match invoices to contract rates well. They do **not** adjudicate the messy accessorial dispute (evidence assembly, back-and-forth, deadlines) and do not serve small carriers. AI-native entrants such as Loop are shipper-side and oriented to mid-large accounts.

## 3. Where the defensible wedge is (and where it is not)

**Plausible wedge:**
1. **Evidence-packet and dispute workflow for detention/accessorials**, serving carriers and mid-market shippers the incumbents' cost-to-serve excludes.
2. **Contract-language extraction** into machine-readable accessorial rules (incumbent rule bases are largely hand-coded). Improves with each contract ingested.
3. **Proprietary dispute-outcome data:** which claims, with what evidence, against which counterparties, actually get paid. This compounds and is hard to copy quickly, but it exists only after real volume.
4. **Contingency pricing** aligns incentives and lowers sales friction in the underserved segment.

**Not defensible on its own:** LLM document extraction (commodity), a UI, or a rules engine. A funded competitor can build these in months.

**Honest threats:** (a) incumbents or Loop move down-market or add dispute modules; (b) visibility platforms (project44, FourKites) productize detention claims using their own timestamps; (c) data-access friction makes the long tail expensive to onboard; (d) customers bring the work in-house once they see the evidence-packet format.

**Counter-moves:** be the neutral evidence layer that integrates with visibility and TMS vendors rather than fighting them; build on dispute-outcome data; stay fast and narrow.

## 4. Likely acquirers (speculative; no announced intent)

Cass, Trax, Descartes, project44, FourKites, Trimble, TMS vendors, large brokers, and payment platforms. This follows adjacency logic only. Treat as a hypothesis about exit paths, not a plan.
