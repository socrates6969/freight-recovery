# Ad and creative concepts for scoup.ai

> **Status: concepts for testing, not approved copy.** The product, scoup.ai, is pre-product: no customers, no measured
> recovery rate, no measured accuracy. Every concept below passes the project honesty rule by construction, and every one
> still needs human claims review (and counsel review before launch, per `marketing/seo-and-growth.md`) before it runs.
> Channels and budgets are in `channel-plan.md`. Last edited 2026-10-17.

## Audience and pillars

By owner decision, scoup.ai sells first to **mid-market shippers** (logistics and transportation managers, freight-pay
and accounts-payable leads) and **SME importers** (import managers, customs and logistics coordinators). Carrier creative
from the earlier draft is withdrawn until the later, partner-led carrier phase.

Each concept serves one of the pillars `marketing` settled (`marketing/brand/README.md`, section 4). **Proof attached**
leads every first-touch message: each flagged charge carries its arithmetic and documents. **A person decides** answers the trust
objection and runs as secondary creative only, because `market-researcher` found no outside demand for approval controls
(`research/04-gaps.md`). **Built for the loads big audit programs skip** frames who we serve without disparaging anyone.

The name appears as lowercase "scoup.ai" and never starts a sentence or headline.

## Rules every concept follows

No recovery rate, dollar recovered, accuracy figure or customer line, because we have measured none. Every number is
either cited to a primary source or labeled "illustration" with its arithmetic visible. Sample packets and invoices are
built on synthetic data and say so on the image. Pre-product status appears in the ad or on the first screen after the
click. No competitor is named in paid creative, and no line claims we are the only tool of our kind; BlueCargo and
Intelligent Audit already market D&D checks, per `research/01-competitors.md`. Nothing reads as legal advice: D&D copy
describes what the FMC rule requires and tells the reader to confirm with counsel or their customs broker.

Two outside facts are approved for use, both re-read today. The FMC reports that the nine largest ocean carriers
"collected roughly $15.4 billion in D&D charges between April 1, 2020, and March 31, 2025"; we present that as charges
billed, never as money anyone can recover. Thompson Hine summarizes the FMC rule this way: "Failure of the billing party
to abide by the invoice content and timing requirements relieves the billed party's obligation to pay an invoice for
detention and demurrage charges", and the billed party has 30 days to dispute.

Source: Federal Maritime Commission, Detention and Demurrage, https://www.fmc.gov/detention-and-demurrage/, accessed 2026-10-17
Source: Thompson Hine, FMC Issues Final Rule on Billing Requirements and Practices for Detention and Demurrage Invoices, https://www.thompsonhine.com/insights/fmc-issues-final-rule-on-billing-requirements-and-practices-for-detention-and-demurrage-invoices/, accessed 2026-10-17

Capability claims are limited to what the product does today on synthetic data: the D&D audit checks invoice timing
(46 CFR 541.7) and required content (46 CFR 541.6) field by field; the fuel check recomputes a surcharge from the
carrier's own table and the active diesel index; the accessorial check compares invoice lines with the rate confirmation
and holds uncertain lines for review (`freight-recovery-build`, `packages/shared/src/ocean-dd`, `api/src/intelligence/fuel.ts`).

## Concept 1: "Off AP's desk" (lead test)

- **Pillar:** Proof attached. **Audience:** shippers; AP manager and controller titles first, then transportation/logistics managers and CFOs/VPs finance. **Channels:** LinkedIn document ad, Google Search.
- **Headline:** Take accessorial review off AP's desk. Every line checked against the rate confirmation, with the source attached.
- **Alternate headline (A/B):** Stop paying accessorials that were never authorized.
- **Why workload leads:** RXO's November 2024 survey of 750 shippers and carriers (`research/04-gaps.md`, gap 5) found most
  shippers call accessorial requests a top accounting time-waster while most say carriers are usually honest, which
  favors a workload message over an overbilling one. Any creative that quotes RXO carries the source line below and
  presents the figures as RXO's survey findings, never as scoup.ai results.
- **Body:** Each invoice line is checked against the rate confirmation. Charges the paperwork supports pass; charges it
  does not support come back with the page that shows why. Uncertain lines are held for your review, not disputed.
- **Visual:** a synthetic invoice with one line highlighted and a margin note "not on rate con: review", stamped SYNTHETIC.
- **CTA:** See a sample accessorial check.
- **Search ad variant:** "Accessorial audit, with the proof | Every line checked against the rate con | Pre-product: design partners wanted".
- **Must not say:** "cut freight costs by X%", any savings figure, any claim about how often charges are unauthorized,
  or RXO's percentages without attribution.

Source: RXO, What Shippers & Carriers Really Think About Trucking Accessorials (Original Research), https://rxo.com/resources/research/freight-accessorials/, accessed 2026-10-17

## Concept 2: "The 30-day window" (lead test)

- **Pillar:** Proof attached. **Audience:** SME ocean importers (import/logistics managers, AP managers and controllers). **Channels:** LinkedIn document ad, Google Search, JOC (Year 2).
- **Headline:** Check every D&D invoice before the 30-day window closes.
- **Alternate headline (A/B):** A D&D invoice has rules. So does the clock to dispute it.
- **Body:** Under the FMC billing rule, a demurrage or detention invoice must carry required information and arrive on
  time, and you have 30 days to dispute it. scoup.ai's check (in design-partner validation) reads each invoice field by
  field, cites the section it fails, and tracks your dispute deadline. Confirm any dispute with your counsel or customs broker.
- **Visual:** a synthetic D&D invoice with two fields flagged ("container number missing: 46 CFR 541.6") and a 30-day countdown bar.
- **CTA:** See a sample D&D invoice check.
- **Citation rule:** any line stating the rule's effect (that a non-compliant invoice need not be paid) carries the
  Thompson Hine citation; the gap and its sources are in `research/04-gaps.md`, gap 3.
- **Search ad variant:** "D&D invoice check, by the FMC rule | Required fields and 30-day deadlines tracked | Pre-product pilot".
- **Must not say:** "you don't have to pay", "get your money back", "guaranteed refund".

## Concept 3: "No source, no dispute" (lead test)

- **Pillar:** Proof attached. **Audience:** both segments. **Channels:** LinkedIn single-image and document ads.
- **Headline:** No source, no dispute.
- **Alternate headline (A/B):** Every flagged line points to a page.
- **Wording rule:** keep "claim" out of headlines and ad titles; `seo` found buyers read it as cargo loss and damage.
- **Body:** If a charge cannot be traced to a rate confirmation, a tariff table or a rule section, it does not go in the
  dispute packet. Software reads the documents, rules do the arithmetic, a person approves the send.
- **Visual:** one packet line ("Fuel surcharge billed $412; table gives $371", labeled illustration) with a callout to the synthetic surcharge table row and diesel index week.
- **CTA:** See a sample packet (synthetic data).
- **Must not say:** "accurate", "error-free", "AI-powered".

## Concept 4: "Fuel surcharge, recomputed"

- **Pillar:** Proof attached. **Audience:** shippers. **Channels:** LinkedIn (second wave), Google Search.
- **Headline:** Your carrier's fuel table, applied to the week you shipped.
- **Body:** The fuel check takes the surcharge schedule you agreed, the ship date and the published diesel price, and
  recomputes the charge line by line. Differences come with the arithmetic.
- **Visual:** a three-row worked example labeled "illustration": index price, table bracket, surcharge billed versus recomputed.
- **CTA:** Run a sample fuel check.
- **Must not say:** "carriers overcharge you", any overbilling percentage.

## Concept 5: "Too small for an audit program, too big to ignore"

- **Pillar:** Built for the loads big audit programs skip. **Audience:** shippers with $5M to $50M of freight spend. **Channels:** LinkedIn, Manifest follow-up email.
- **Headline:** A freight audit sized for a $20M freight budget.
- **Body:** No integration project and no enterprise contract. Send last quarter's carrier invoices and rate confirmations;
  get back the lines the paperwork does not support, each with its proof. Pre-product: we are looking for design partners.
- **Visual:** a short stack of invoices going in, one packet coming out.
- **CTA:** Apply for a free leakage review.
- **Honesty check:** says who we build for, not how others treat them. "No integration project" is true because no
  integration exists; the FAQ says so. $20M is the business plan's illustrative midpoint, not a customer.
- **Must not say:** "the big audit firms ignore you", "integrates with your TMS".

## Concept 6: "Import by container, ship by truck?"

- **Pillar:** Built for the loads big audit programs skip. **Audience:** manufacturers and wholesalers that both import and ship domestically. **Channels:** LinkedIn importer ad set, TPM or Manifest follow-up.
- **Headline:** Ocean D&D and truck accessorials, checked in one review.
- **Body:** One design-partner review covers both sides of your freight: D&D invoices against the FMC rule, carrier
  invoices against your rate confirmations and fuel table. Under NDA, read-only, on invoices you have already closed.
- **Visual:** a container and a trailer feeding the same packet.
- **CTA:** Apply for a free leakage review.
- **Honesty check:** describes the importer-shipper account the financial model assumes; both checks exist on synthetic data.
- **Must not say:** "one platform for all your freight", any combined savings figure.

## Concept 7: "We're pre-product. Test us on your closed invoices." (founder content)

- **Pillar:** Proof attached. **Audience:** both. **Channels:** founder LinkedIn posts from day one; lead-form ad if posts produce conversations.
- **Headline:** Send us a quarter of closed invoices. We'll show you what the checks find, or that they find nothing.
- **Body:** We are in design-partner validation. Under NDA, read-only, we run the checks on invoices you have already
  paid and walk you through every flagged line. No software to buy.
- **Visual:** founder photo (with consent) and a plain text card.
- **Must not say:** "limited spots", countdowns, any number of partners we do not have.

## Concept 8: "The packet, unboxed"

- **Pillar:** Proof attached. **Audience:** both, with a shipper and an importer version. **Channels:** LinkedIn document ad, gated download.
- **Headline:** What a dispute looks like with the proof attached.
- **Body:** Page through a complete sample: the invoice, the rule or rate-con term each flagged line breaks, the
  arithmetic, and the draft dispute letter. Built on synthetic data so you can see everything.
- **Visual:** the first three pages, each stamped "SYNTHETIC SAMPLE".
- **Must not say:** "real dispute", "won", any outcome.

## Secondary creative

**Concept 9, "You approve every dispute"** (A person decides): "Nothing is sent without your OK. You read the draft, edit
it and decide." It runs on the solution pages and in follow-up emails as the answer to "will this damage my carrier or
ocean-carrier relationship?", never as a lead ad.

**Concept 10, "You ran the numbers"** (Proof attached, retargeting): "You estimated it from your inputs. Want it run on
your invoices?" It is the retargeting ad for calculator visitors and waits for Year 2, when retargeting is funded.

## How we test them

Year 1 LinkedIn ($4,500): the shipper ad set runs Concepts 1 and 3 ($1,350 each of its $2,700), the importer ad set runs
Concepts 2 and 6 ($900 each of its $1,800). Google Search ($3,000) uses the search variants of Concepts 1 and 2, one per
ad group. Concept 7 runs as founder content from day one at no media cost. Concepts 4, 5 and 8 enter the second wave or
replace any lead concept whose first 10 leads produce no qualified conversation. Concept 9 lives on pages and emails;
Concept 10 waits for Year-2 retargeting. We compare concepts on cost per qualified conversation, not click-through rate.

## Open questions

- Counsel review of the FMC-rule copy in Concepts 2 and 6, so it describes the rule without reading as legal advice.
- Founder photo and named-person consent for Concept 7.
- Whether the importer version of Concept 8 needs a customs-broker reviewer before publication.
