# Landing page and site outline (pre-product; copy outline, not final copy)

> Status: outline. Placeholders in `<angle brackets>` are decisions or facts we do not have yet
> (domain, company legal name, contact address). Nothing below may be published until a real
> person has reviewed it for claims, and a freight-domain reviewer has checked the explainers.

## Site map (first release, deliberately small)

| URL (proposed) | Page | Primary intent | Priority |
|---|---|---|---|
| `/` | Home / landing | Brand + design-partner offer | 1 |
| `/detention-recovery/` | Carriers: detention recovery | Cluster A | 1 |
| `/accessorial-audit/` | Shippers: accessorial audit | Cluster A | 1 |
| `/calculator/` | Recovery calculator (lead magnet) | Cluster C tool | 1 |
| `/guides/` | Hub: detention and accessorial glossary + guides | Cluster C | 2 |
| `/guides/how-detention-is-calculated/` | Worked-example explainer | Cluster C | 2 |
| `/guides/dispute-a-detention-charge/` | Playbook (shipper) | Cluster C | 2 |
| `/guides/bill-detention-with-proof/` | Playbook (carrier) + evidence checklist download | Cluster C | 2 |
| `/freight-audit-alternatives/` | Neutral comparison guide | Cluster B | 3 (after facts verified) |
| `/evidence-packet-example/` | Sample packet + DRAFT demand letter on **synthetic** data | Decision | 2 |
| `/pricing/` | Contingency model, explained | Decision | 3 |
| `/security/` | What is and is not in place today | Trust | 3 |
| `/about/` | Who is behind this; pre-product status | Trust | 3 |
| `/privacy/`, `/imprint/` | Legal | Compliance | required |

## `/` Home

**Meta title (<=60):** `Freight detention and accessorial recovery, with the evidence` (placeholder; test)
**Meta description (<=155):** `Turn rate confirmations, BOLs and invoices into documented detention and accessorial claims. Pre-product: we are looking for design partners.`
**H1:** Get paid for detention you can prove. (alternative: Find the detention and accessorial charges you are owed or should not have paid.)

Sections, in order:
1. **Hero.** One-sentence value proposition; two CTAs: "Try the recovery calculator" (primary), "Become a design partner" (secondary). A visible one-line status: "Pre-product: in design-partner validation."
2. **The problem (cited).** Detention is a well-documented cost: ATRI (Sept 2024) puts the cost to US trucking at $15.1B/yr and reports fewer than half of billed detention invoices are paid (secondary coverage; link the primary once opened; label as such). State that this is a cost of waiting, not a pool of recoverable dollars.
3. **How it works** (3 steps, matches the repo's real pipeline): (1) bring a load's rate confirmation, BOL/gate record and invoice; (2) rules apply the contract terms and show the arithmetic (clock start, free time, rate, cap); (3) you get an evidence packet and a DRAFT demand that a person approves. Link: `/evidence-packet-example/`.
4. **Two audiences, two doors.** Carriers (earned-but-unbilled/under-billed detention) and shippers (unauthorized or unsupported accessorials). Each links to its page.
5. **What we do not do (trust section).** We never send anything without human approval; only confirmed findings count toward the recoverable estimate; low-confidence items are listed separately for review; we do not move money.
6. **Design-partner offer.** "Share 20-50 closed loads (read-only, under NDA) and get a leakage review on your own data. No software to buy." Short form (name, company, role, work email, perspective carrier/shipper, consent checkbox). State what happens to the data.
7. **FAQ** (on-page, real questions; `FAQPage` schema only if shown): Is this live? (No, pre-product.) Which systems does it connect to? (None yet.) How is it priced? (Planned contingency for pilots; not final.) Is my data safe? (Link to `/security/`: what exists today and what is still required.) Who is behind it? (Link to `/about/`.)
8. **Footer.** Legal links, contact, "Pre-product" notice, no social-proof widgets.

**Not allowed on this page:** customer logos, testimonials, "X% savings", "AI-powered accuracy", "SOC 2/enterprise-grade", "integrates with <any TMS/ELD>", countdowns or fake scarcity.

## `/detention-recovery/` (carriers)

- **H1:** Bill detention with the proof attached.
- Problem in the carrier's words (billing by hand, no proof, written off); cite ATRI as above.
- What the evidence packet contains (rate-con terms, appointment vs. arrival, departure, free time, rate, cap, computed amount with steps).
- Worked example, labeled "illustration on synthetic data" (the fixture load: arrived early, clock starts at appointment, dwell, free time, 15-minute rounding, rate, cap).
- Honest limits: rules are illustrative until validated on real closed files; contracts vary; a human reviews every claim.
- CTA: calculator; design-partner form (carrier variant).
- Schema: `WebPage`, `BreadcrumbList`; `FAQPage` if FAQ present. Add `SoftwareApplication` only when something real can be used.

## `/accessorial-audit/` (shippers)

- **H1:** Stop paying accessorials that were never authorized.
- Explain the rate-confirmation-vs-invoice check; why unauthorized lumper/accessorial lines are flagged **for review** rather than auto-disputed (they may be legitimate with a receipt).
- Worked example on synthetic data: linehaul above rate-con, detention above supported amount, unauthorized accessorial flagged for human review; show confirmed total vs pending-review total.
- CTA: calculator (shipper variant); design-partner form (shipper variant).

## `/calculator/`

See `calculator-spec.md`. Page copy: one paragraph on what it does and does not do, the form, the printed arithmetic, the caveat block, and the design-partner follow-up CTA. Include the formula and the hand-checkable worked example on the page.

## `/guides/` hub and explainers

- Glossary entries (detention, accessorial, TONU, layover, lumper, rate confirmation, free time, appointment window) each with: one-sentence definition, a short example, related-guides links.
- Explainer template: question as H1; direct answer first; worked example with arithmetic; "what varies by contract"; sources (primary + grade); author/reviewer and dates; next-step CTA.

## `/freight-audit-alternatives/` (publish only after verification)

- Neutral criteria checklist: customer size fit, accessorial/detention handling, dispute workflow, pricing model, integrations, security posture, contract terms.
- A category view of the options (enterprise freight audit and payment firms, AI-native audit tools, TMS-embedded audit, in-house) based on each vendor's **own public pages verified and date-stamped on publication**. Say where incumbents are stronger (scale, payment processing, integrations). Place ourselves honestly: pre-product, no integrations, narrow focus.
- No claims about competitors' performance or customers beyond what they publish.

## `/pricing/`

- Explain the intended pilot model: contingency (a percentage of dollars actually recovered, nothing if nothing is recovered). State that rates are not final and that hybrid/SaaS tiers may follow. No numeric fee until it is a real offer after design-partner feedback.

## `/security/`

- Mirror the repository's honest status: what exists (per-tenant API keys, tenant isolation, bounded parsing in a separate process, hash-locked supply chain, scanning in CI) and what does **not** yet (third-party security audit, compliance certification, malware scanning of uploads, retention/deletion policy). State that real customer data is not accepted until those are done.

## Conversion and tracking plan (events to define before launch)

`calculator_started`, `calculator_completed`, `checklist_downloaded`, `design_partner_form_started`, `design_partner_form_submitted` (carrier/shipper), `evidence_packet_example_viewed`. Consent-aware analytics; no third-party trackers without consent.

## Global on-page template

Every page ships with: unique title and meta description; one H1; canonical; Open Graph tags; breadcrumb schema; internal links to the calculator and one guide; author/dates on guides; visible pre-product notice where capability is described. Use the checklist in `../seo-and-growth.md` section 9 as the acceptance test; the live-site audit comes after launch.
