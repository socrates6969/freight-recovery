# Marketing site (static, pre-product)

A real, deployable static site built from `../seo-and-growth.md` and `../landing/outline.md`.
**Deployed to GitHub Pages** at https://socrates6969.github.io/freight-recovery/ by
`.github/workflows/pages.yml` on every push to `master` that touches `marketing/site/` or `brand/`.
The workflow builds with `npm test`, so a failing check blocks the deploy. When the site is served under
a sub-path, `SITE_URL`'s path becomes the base path and every root-absolute link is prefixed with it.
GitHub Pages ignores `static/_headers` (only the meta tags apply there), and crawlers read
`robots.txt` only at a domain root. See "What GitHub Pages cannot do" below.

## Stack choice

Hand-rolled HTML/CSS plus a ~100-line, zero-dependency Node build script (`build.mjs`, Node >= 18). No
framework, no bundler, no client-side JavaScript, no `node_modules`, so there is nothing to pin or
audit beyond the Node runtime. The script adds the shared layout, per-page SEO tags, JSON-LD,
`sitemap.xml` and `robots.txt`. Pages are fragments in `pages/` (first line `<!--meta {json} -->`).
The header/footer logo and favicon are copied at build time from the repo-root `brand/` folder (see
`brand/README.md` for the name and logo rules: always lowercase "scoup.ai").

## Build and preview

```bash
cd marketing/site
SITE_URL=https://www.your-domain.example CONTACT_EMAIL=you@your-domain.example npm run build
npm test            # builds, then checks SEO basics and honesty/security guards
npx --yes serve dist   # or: python -m http.server -d dist 8080
```

`SITE_URL` drives canonical URLs, Open Graph URLs, JSON-LD and the sitemap; `CONTACT_EMAIL` fills the
contact links. If unset, the build uses visible `example.invalid` placeholders and warns.

Each page's meta line may carry `"updated": "YYYY-MM-DD"`, the date of its last content change. It becomes
the sitemap `<lastmod>` and the WebPage `dateModified`; a page without it gets no `lastmod` at all. Bump it
when you change a page's content. The build date is never used (it would mark every page as changed on every
build), and a `git log` fallback is not used because the Pages workflow checks out a shallow clone.

## What is on the site

Positioning follows the owner's shipper- and importer-first decision of 2026-10-17
(`marketing/marketing-plan.md` sections 2-3 on the `docs/investor-package` branch). Home leads with the shipper
line "Take accessorial review off AP's desk. Every line checked against the rate confirmation, with the source
attached.", then the importer line "Check every D&D invoice before the 30-day window closes."; carriers appear
only as a later, partner-led channel. Home also has the four modules, trust limits, the design-partner offer (a
free review of 90 days of invoices) and the FAQ. Then Platform, How it works, Security status, About, Design
partners (mailto only: no form backend, no tracking), and **draft** Privacy, Terms, Cookie/disclaimer pages (each
flagged "must be reviewed by a licensed Norwegian advokat"; they do not claim GDPR compliance, and they are
`noindex` and left out of the sitemap until the advokat signs off).

Copy rules the tests enforce: any page that describes the FMC billing rule carries the Thompson Hine source line
and "confirm with counsel or your customs broker"; the RXO survey is quoted only with its source line and the
label "a freight broker"; ATRI figures only with the "cost of waiting" caveat. Banned words include
"recovered", "accurate", "secure", "seamless", "robust", "leverage" and "saves". Sources are plain text, not
links, because the site loads and links to nothing outside itself.

### Audience entry points (2026-10-18)

Home links three audience pages from the main nav and from a "Pick your starting point" list:

- **/buyers/**: the shipper and importer messages from home (with their source lines), a per-role table from
  `marketing/marketing-plan.md` section 3, carriers as "later, through partners", and the 90-day review offer.
- **/developers/**: what the TypeScript API does today for machine clients (9 key routes, scopes `imports.write`,
  `claims.read`, `exports.claims`; `fr_live_` Bearer keys; 401/403/429 behaviour), what a key cannot do, and the
  developer portal's real status (built, not hosted, still documents the Python reference service; being
  regenerated). Source: `docs/architecture/dev-portal-drift.md` and `api-surface.md` on `docs/investor-package`.
  No portal link until a portal is hosted.
- **/investors/**: a plain summary of the business plan's executive summary with a section reference per point,
  and a "Documents on request" section that lists the seven investor documents as plain text with a contact link.
  By the owner's decision of 2026-10-18 the documents are **not published** on the site (general-solicitation risk)
  and the raise size stays off the page; `npm test` fails on any `.pdf` link, any `/investors/pdf/` path or a
  `dist/investors/pdf/` folder.

Each audience page has an in-page "On this page" nav. Every nav item and call to action carries an inline line
icon from `ICONS` in `build.mjs` (pages write `{{icon:name}}`): drawn on a 24px grid, no library, no request,
`aria-hidden` next to a visible label, so the CSP is unchanged and meaning never rests on the icon or a colour.

The stylesheet uses the brand tokens (slate neutrals, teal `#0f766e` / `#2dd4bf`) and self-hosted Inter Variable
(`static/fonts/`, from `@fontsource-variable/inter` 5.3.0, the version the web app pins; OFL licence alongside).
`_headers` gained `font-src 'self'`.

## Lenses built in

- **SEO:** unique title/description, one H1, canonical, Open Graph and Twitter tags, honest JSON-LD
  (Organization, WebSite, WebPage with `dateModified`, BreadcrumbList; FAQPage only because the FAQ is
  visible; no SoftwareApplication, no ratings), `sitemap.xml` with per-page `lastmod`, `robots.txt`, no JS,
  ~4.5 KB CSS plus one 48 KB self-hosted Inter font file. Titles say "accessorial", "D&D", "freight invoice" and "rate confirmation", not "claim".
- **Security:** `static/_headers` holds the full header set (CSP, HSTS, nosniff, X-Frame-Options,
  frame-ancestors, referrer and permissions policies, COOP). `build.mjs` derives the meta CSP and the meta
  referrer policy from that file, so they cannot drift; the meta CSP drops `frame-ancestors`, which a meta tag
  cannot carry. The referrer policy is `no-referrer` in both places (stricter than the browser default
  `strict-origin-when-cross-origin`; the site links nowhere external, so nothing breaks). No third-party
  resources, so no SRI is needed (if you ever add an external asset, pin it with `integrity=` and extend the
  CSP in `_headers`); no cookies or trackers.
- **Marketing/honesty:** no testimonials, logos, metrics, "AI-powered", certification or integration claims;
  `test.mjs` fails the build on a list of banned phrases.
- **Legal:** DRAFT pages only. A licensed Norwegian advokat must review before use.

## What GitHub Pages cannot do

GitHub Pages serves no custom HTTP headers and only one `robots.txt` per host. On the current
`socrates6969.github.io/freight-recovery/` deployment, therefore:

- **Framing protection is missing.** `frame-ancestors 'none'` and `X-Frame-Options: DENY` only work as
  response headers; a meta CSP cannot carry them. Any site can frame these pages today.
- **HSTS is GitHub's, not ours.** github.io sends its own `Strict-Transport-Security`; we cannot set it,
  add `includeSubDomains`, or set HSTS for a custom domain on Pages.
- **nosniff, Permissions-Policy and Cross-Origin-Opener-Policy are not sent** (they exist only in
  `_headers`). The meta CSP and meta referrer policy do apply.
- **`robots.txt` is invisible.** Crawlers read it only at the host root, and
  `socrates6969.github.io/robots.txt` is not ours, so the `Sitemap:` line in our `robots.txt` is never seen.
  Submit the sitemap in Search Console instead, or move to a domain root.

All four need either a custom domain at its own root on a header-capable host (Cloudflare Pages or Netlify,
which apply `_headers` as is), or a CDN in front of GitHub Pages that adds the headers. A custom domain on
GitHub Pages alone fixes `robots.txt` but not the headers. Confirm with `curl -sI https://<domain>/` after the
move.

## Deploying later (your decision)

Upload `dist/` to any static host (Cloudflare Pages, Netlify, S3+CDN, nginx). Apply the headers in
`dist/_headers` (native on Netlify/Cloudflare; translate on other hosts). Set `SITE_URL` to the final
origin and rebuild, serve over HTTPS, and submit `sitemap.xml` to Search Console. Before launch: complete the
contact address, publish entity details on About/Privacy, and have the legal pages reviewed.

## Deferred

Solution pages in the order of `marketing/seo/content-plan.md` (`/accessorial-audit/`, `/demurrage-detention-audit/`,
carrier `/detention-recovery/` later), guides, evidence-packet examples, the calculator, pricing and comparison pages
(need content review and verified facts); a Norwegian-language version;
consent-aware analytics (none by design until decided). Done on 2026-10-18: brand palette and Inter, skip link, no canonical on 404, `interest-cohort` removed. Still open: Organization `logo` (needs Google's image requirements checked) and HSTS `includeSubDomains` (only once on an own domain).
