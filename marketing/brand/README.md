# scoup.ai brand summary (for the investor package)

> Status: summary of decisions already made in the brand worktree
> (`C:\Users\mariu\ventures\freight-recovery-brand`, branch `feat/scoup-brand`, head `3933aae`).
> This file does not redesign anything. Where the brand work and this package disagree, the brand
> worktree wins and the disagreement is listed under "Gaps". The company is pre-product: no hosted
> service, no customers, synthetic data only.

## 1. The name

The brand worktree settles the name as **scoup.ai**, written in lowercase every time, and treats the
company and the product as one brand (`brand/README.md`, "Name rules"). The rules we carry into every
marketing document:

- Write **scoup.ai**. Never "Scoup", "Scoup.ai", "SCOUP.AI" or "Scoup AI". Possessive: **scoup.ai's**.
- Avoid opening a sentence with the name; rephrase. If it cannot be avoided, keep it lowercase.
- Never place the name inside an all-caps context (CSS `text-transform: uppercase` included).
- In page and app headers the logo replaces the text name; the text name stays in titles, alt text,
  footers and legal text.
- "freight invoice recovery", "freight audit", "detention recovery" are ordinary lowercase words, not
  the name.
- Code and repositories keep the technical name (`freight-recovery`, `@fr/*`, `freight_recovery`).
  Only the name people see changed (commit `98c9a54`, "Rebrand to scoup.ai").

The integration owner confirmed lowercase **scoup.ai** package-wide on 2026-10-17 (`BRIEF.md`, line 13).

## 2. Logo and visual identity

The logo is the **"Reconciled s"**: an s built from two halves that meet exactly at the spine, standing
for the invoice and the contract agreeing. The upper half is neutral ink, the lower half teal, and the
s sits on a rounded tile (corner radius 22% of its width) that doubles as app icon, avatar and favicon
(`brand/README.md`, opening paragraph and "Do and don't"). The idea matters for marketing because it is
the product's claim drawn as a shape: two documents checked against each other until they agree.

Assets (all in `freight-recovery-brand/brand/`): horizontal and stacked lockups for light and dark
surfaces, one-colour black and white lockups for print, wordmark, mark (24 px and up) and a heavier
`favicon.svg` for 16-24 px. Clear space is 1x the wordmark's x-height around any lockup and 0.25x the
tile width around the tile alone. Minimum horizontal lockup: 20 px tall on screen, 6 mm in print.

Palette, taken from existing product tokens, with contrast ratios as measured in the brand README:

| Role | Light surfaces | Dark surfaces |
|---|---|---|
| Ink (letters, tile) | `#0f172a` (17.85:1 on white) | `#e2e8f0` (15.19:1 on `#0b1220`) |
| Teal (lower half of the s, single accent) | `#0f766e` (5.47:1 on white) | `#2dd4bf` (10.06:1 on `#0b1220`) |
| Muted (".ai") | `#64748b` (4.76:1 on white) | `#8b9ab0` (6.55:1 on `#0b1220`) |

The web app carries the same system in `web/src/styles/tokens.css`: an 8 px spacing grid, slate
neutrals, one accent (deep teal `#0f766e`), semantic colours used sparingly, 120-180 ms ease-out
motion, Inter Variable as the UI typeface, and WCAG AA contrast enforced by a unit test
(`web/src/styles/contrast.test.ts`).

Prohibited uses (from "Do and don't"): offsetting or recolouring the two halves, the dark tile on dark
slate (1.05:1), the s without its tile in colour, stretching, shadows, gradients, animation, and setting
the name in capitals or another typeface as a stand-in for the logo.

## 3. Voice

The brand worktree has no written voice guide, but the shipped marketing site
(`freight-recovery-brand/marketing/site/pages/*.html`) shows a consistent voice that we treat as decided.

1. **Plain and specific.** Sentences name documents a freight person handles every day: "rate
   confirmation, bill of lading and invoice". Arithmetic is shown, not summarised ("Free time 2 h, rate
   $60/h, cap $480 ... 3 h 10 min beyond free time", `how-it-works.html`).
2. **Candid about status.** Every page carries "pre-product, in design-partner validation", and the
   security page opens with "We would rather tell you what is missing than imply a posture we do not
   have" (`security.html`).
3. **Limits stated as promises.** "We never send anything without human approval"; "We do not move
   money, and we do not give legal advice" (`index.html`, "What we do not do").
4. **Asking, not selling.** The call to action is a design-partner conversation where "honest feedback
   is the point" (`index.html`, `contact.html`).
5. **No proof we do not have.** No logos, testimonials, savings percentages, "AI-powered" or
   certification claims; the site's `test.mjs` fails the build on a banned-phrase list
   (`marketing/site/README.md`).

Lines in use: the hero **"Get paid for detention you can prove."** (`index.html`); for carriers, "Bill
earned detention with the proof attached instead of writing it off"; for shippers, "Catch unauthorized
or unsupported accessorials; ambiguous lines are flagged for human review, not auto-disputed". The
earlier business plan proposed "The proof standard for freight recovery"
(`freight-recovery/business/investor-brief.md`, section 6.1); the site never used it.

After the owner's shipper- and importer-first decision (2026-10-17), the primary hero lines are the
shipper line "Take accessorial review off AP's desk. Every line checked against the rate confirmation,
with the source attached." (chosen 2026-10-17 over "Stop paying accessorials that were never
authorized", which stays as the A/B alternate; reasoning in `../marketing-plan.md` section 2.3) and a
new importer line, "Check every D&D invoice before the 30-day window closes"
(`../marketing-plan.md`, section 2.3). The carrier hero stays for the later partner phase.

## 4. Messaging pillars

The site copy and the investor brief's section 6.1 converge on three pillars. We adopt them in the
wording below; `../marketing-plan.md` section 3 maps them to each buyer.

| Pillar | One line | What we can show today | What we may not say |
|---|---|---|---|
| **Proof attached** | Every claim carries the documents, the clause and the arithmetic behind it. | Evidence packet with per-document SHA-256 fingerprints and printed calculation steps, on synthetic data (`how-it-works.html`). | Any recovery rate, win rate or dollar figure. |
| **A person decides** | Software drafts; a person approves every letter, and uncertain lines are held back, not claimed. | Letters generated as "DRAFT / not sent"; findings split into confirmed and "needs human review" (`index.html`). | "Automated recovery", "hands-free". |
| **Built for the loads big audit programs skip** | Mid-market shippers and small and mid-size importers who cannot justify an enterprise audit program; carriers later, through partners (owner decision, 2026-10-17). | Design-partner offer on closed loads, nothing to buy (`contact.html`). | That incumbents cannot serve them, or any competitor claim without a dated source. |

Pillar two is a trust answer, not a lead. `market-researcher` found no outside evidence that buyers
ask for approval controls (`research/04-gaps.md`), so "Proof attached" leads every message and "A
person decides" answers the objections that follow.

The investor brief's pillar "AI you can audit" and its neural-mesh speed figures do not carry into
marketing. Those figures come from internal benchmarks on synthetic workloads and tell a buyer nothing
they can check; under the package's honesty rule they stay out of external copy.

## 5. Gaps

1. **Name casing (resolved 2026-10-17).** `BRIEF.md` first wrote "Scoup"; the integration owner confirmed
   lowercase **scoup.ai** package-wide and updated the brief. Older repo documents still say
   "Freight Recovery" and need the same pass before external use.
2. **Marketing site palette does not match the brand.** `marketing/site/static/style.css` still uses a
   blue accent (`--accent:#0b5cad`) and a system font stack, while the brand and app use teal `#0f766e`
   and Inter. The site was rebranded in name and logo only.
3. **No written voice guide.** Section 3 is reconstructed from shipped copy. A one-page guide with
   do/don't sentence pairs would prevent drift once more people write copy.
4. **No messaging for factoring companies, brokers or 3PLs**, although the business plan names them as
   channels.
5. **Print sizes for the stacked lockup and the mark** are "not yet specified" in `brand/README.md`.
6. **Strokes not outlined.** The brand README's production TODO requires converting strokes to outlines
   before files go to a printer or sign maker.
7. **Trademark clearance for "scoup.ai"** is not recorded. UNKNOWN — needs primary research (USPTO,
   EUIPO and Norwegian IPO searches, ideally by counsel).
8. **Contact address unset.** `contact.html` renders `__CONTACT_EMAIL__` with an `example.invalid`
   fallback, so outreach cannot point at the site yet.
9. **Only a social card exists** (`static/og-card.png`). There is no deck template, letterhead, or
   branded template for the evidence packet itself, which is the artifact buyers will see most.
10. **Domain not registered.** On 2026-10-17 `seo` found that scoup.ai does not resolve and the .ai
    registry RDAP lookup returned 404 "Object not found"; the site currently lives at
    socrates6969.github.io/freight-recovery/. The name and the domain must be secured together
    before any copy, card or ad prints the domain.
11. **"Claim" is a loaded word in search.** `seo` reports that "freight claim" means cargo loss and
    damage claims (parcel carriers dominate it), and that carrier vocabulary ("detention pay", "rate
    confirmation") draws more search interest than "freight audit" (Google Trends, relative interest
    only; script in `fr-wt/seo/marketing/seo/data/`). Page titles and headlines should say
    "detention", "accessorial" and "rate confirmation" rather than "claim"; body copy may still use
    "claim" where the meaning is clear.
