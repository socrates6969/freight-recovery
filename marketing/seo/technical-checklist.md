# Technical SEO checklist: audit of `marketing/site/`

> **Status.** Desk audit of the static marketing site source plus a few read-only requests to the copy that is
> already public. No edits were made to the site. scoup.ai is pre-product: no customers, no traffic data, no Search
> Console property we know of, so nothing here measures rankings or field performance. Every fix below names the file
> to change; the site's owner (not `seo`) makes the changes.

## 1. What was audited, and how

We audited three things, because they are not the same site. The **master source** in
`marketing/site/` (commit 5828944 on master, copied into this worktree) still brands the site "Freight Recovery".
The **brand branch** `feat/scoup-brand` (commits 98c9a54 and 3933aae) rebrands to scoup.ai, adds an Open Graph card,
a favicon and base-path support, and adds `.github/workflows/pages.yml`, which deploys the site to GitHub Pages. The
**live site** answers at https://socrates6969.github.io/freight-recovery/ with HTTP 200 and the scoup.ai title, and
its sitemap shows `lastmod` 2026-10-12, so a build from the brand work is public today even though the master
`marketing/site/README.md` still says "Not deployed".

We built both source versions in a scratch directory with Node 24.21.0 and ran the site's own `npm test`; both passed
9 of 9 page checks (master with `SITE_URL=https://www.scoup.ai`, brand with the github.io URL). We read the generated
HTML, `sitemap.xml` and `robots.txt`, fetched the live response headers, and compared the result against Google
Search Central documentation. File paths below are relative to the repository root and refer to master unless marked
"brand".

The overall picture is good for a site this young. The builder already does most things right: one H1 per page,
unique titles and descriptions with length warnings, canonical tags, Open Graph and Twitter tags, honest JSON-LD
with no ratings and no `SoftwareApplication`, a strict CSP, no JavaScript and no third-party requests, and a test
suite that fails the build on banned claims. The problems are mostly about where the site is hosted, what is
indexable, and what is missing for search to have anything to rank.

## 2. Findings summary

| ID | Priority | Finding | Main file(s) |
|---|---|---|---|
| T1 | P0 | Site is public on a github.io sub-path; final domain appears unregistered | `.github/workflows/pages.yml` (brand), `marketing/site/build.mjs` |
| T2 | P0 | Security headers in `_headers` are not served on GitHub Pages | `marketing/site/static/_headers`, `marketing/site/README.md` |
| T3 | P1 | Draft legal pages are indexable and listed in the sitemap | `marketing/site/pages/privacy.html`, `terms.html`, `cookies.html` |
| T4 | P1 | Every sitemap `lastmod` is the build date | `marketing/site/build.mjs` |
| T5 | P1 | No social image or favicon on master | `marketing/site/build.mjs` (fixed on brand) |
| T6 | P1 | Entity name "Freight Recovery (pre-product)" in schema and `og:site_name` | `marketing/site/build.mjs` (fixed on brand) |
| T7 | P1 | No page targets a measured keyword cluster; generic H1 on how-it-works | `marketing/site/pages/*.html` |
| T8 | P2 | Organization schema has no logo; WebPage schema has no dates | `marketing/site/build.mjs` |
| T9 | P2 | FAQPage markup will not produce a rich result | `marketing/site/pages/index.html` |
| T10 | P2 | 404 page carries a canonical tag | `marketing/site/build.mjs` |
| T11 | P2 | Obsolete `interest-cohort` directive; HSTS without `includeSubDomains` | `marketing/site/static/_headers` |
| T12 | P2 | Personal mailbox published as the contact address | `.github/workflows/pages.yml` (brand) |
| T13 | P2 | No skip link; minor accessibility gaps | `marketing/site/build.mjs`, `static/style.css` |
| T14 | P2 | Tests do not guard the new rules (noindex drafts, lastmod, og:image) | `marketing/site/test.mjs` |
| T15 | P3 | Performance: nothing to fix now; measure field data after launch | n/a |

## 3. Findings and fixes

### T1 (P0). Public on a github.io sub-path, and the final domain looks unregistered

The brand workflow builds with `SITE_URL: https://socrates6969.github.io/freight-recovery`, so every canonical URL,
`og:url`, JSON-LD `@id` and sitemap entry points at a GitHub-owned hostname under a repository path. Three problems
follow. Search equity earned now accrues to a URL we will abandon. Google ignores a `robots.txt` that is not at the
host root ("Crawlers don't check for robots.txt files in subdirectories"), and the root
https://socrates6969.github.io/robots.txt returned HTTP 404 on 2026-10-17, so the site's own `robots.txt` and its
`Sitemap:` line are invisible to crawlers. And Search Console can only verify a URL-prefix property for a sub-path,
not a Domain property.

The brand guidelines name the company and product "scoup.ai", but on 2026-10-17 `scoup.ai` did not resolve in DNS
and the .ai registry's RDAP service (`rdap.identitydigital.services`) answered `404 Object not found` for it. That
strongly suggests the domain is not registered. We did not check trademark or availability beyond that one lookup.

Source: Google Search Central, Create and submit a robots.txt file, https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt, accessed 2026-10-17

Fix, in order: (1) the owner decides and secures the production domain (scoup.ai or another) before more public
content ships; (2) point the host at it and rebuild with `SITE_URL=https://<domain>` in `.github/workflows/pages.yml`
(brand) or the new host's settings, so the builder's existing logic rewrites canonicals and the sitemap; (3) confirm
whether the old github.io URLs 301 to the new domain (GitHub's custom-domain documentation we read does not state it
for project sites); if they do not, keep them out of search by taking that deployment down once the new one is live;
(4) verify a Domain property in Search Console by DNS and submit `https://<domain>/sitemap.xml`. Until step 1 is done,
consider adding `"noindex": true` site-wide via a build flag so the github.io copy is not indexed at all.

### T2 (P0). The security headers are not served

`marketing/site/static/_headers` holds the CSP with `frame-ancestors 'none'`, `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP and HSTS. That file format is honoured by Netlify and
Cloudflare Pages, not by GitHub Pages. The live response on 2026-10-17 carried only `Server: GitHub.com`,
`Strict-Transport-Security: max-age=31556952` and `Cache-Control: max-age=600`: no CSP header, no
`X-Frame-Options`, no `nosniff`. The meta CSP in `build.mjs` still applies to scripts, styles and images, but a meta
CSP cannot set `frame-ancestors`, so the pages can be framed by any site today. This is mainly a security item; it
matters to SEO because the site's `/security/` page and README promise these headers, and a reviewer who checks will
find the gap.

Source: Cloudflare, Pages headers configuration, https://developers.cloudflare.com/pages/configuration/headers/, accessed 2026-10-17
Source: GitHub Community, HSTS (and other security headers) for GitHub Pages with custom domains (discussion 4444), https://github.com/orgs/community/discussions/4444, accessed 2026-10-17

Fix: host on a platform that applies `_headers` (Cloudflare Pages or Netlify; no code change needed) or put a CDN in
front of GitHub Pages that sets them; then confirm with `curl -sI`. Update the deploy section of
`marketing/site/README.md` so it no longer implies the headers apply on every host.

### T3 (P1). Draft legal pages are indexable

`pages/privacy.html`, `pages/terms.html` and `pages/cookies.html` say "DRAFT - must be reviewed by a licensed Norwegian
advokat before use" and "not in force", yet their meta has no `noindex`, so `build.mjs` emits
`<meta name="robots" content="index, follow">` and adds them to `sitemap.xml`. The live `/privacy/` page shows exactly
that. A search result for "scoup.ai privacy policy" landing on a document that says it is not in force helps nobody.
Fix: add `"noindex": true` to the meta line of each of the three pages; the builder already drops `noindex` pages
from the sitemap. Remove the flag when the advokat has signed off.

### T4 (P1). Sitemap `lastmod` is the build date for every URL

`build.mjs` writes `<lastmod>${today}</lastmod>` for every page, so each rebuild claims every page changed. Google
says it uses `lastmod` only "if it's consistently and verifiably ... accurate", so this teaches Google to ignore it.
Fix: add an `"updated": "YYYY-MM-DD"` field to each page's meta line and write that value (fall back to the file's
last git commit date via `git log -1 --format=%cs -- <file>` if absent); reuse the same date for `dateModified` in
T8. Google also ignores `priority` and `changefreq`, so do not add them.

Source: Google Search Central, Build and submit a sitemap, https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap, accessed 2026-10-17

### T5 (P1). No social image or favicon on master

The master `layout()` in `build.mjs` emits `twitter:card` "summary" and no `og:image`, and there is no favicon, so a
shared link renders as bare text and browser tabs and some result displays show a generic icon. The brand branch
fixes all three: `static/og-card.png` (57,555 bytes, 1200 x 630, rendered from `og/og-card.html`), `og:image` with
width, height and alt, `summary_large_image`, and `favicon.svg` copied from `brand/`. Fix: merge the brand branch's
`build.mjs`, `static/og-card.png` and `og/` into master rather than re-implementing them.

### T6 (P1). The entity name in structured data is wrong on master

Master sets `SITE_NAME = "Freight Recovery (pre-product)"`, which becomes the `Organization` and `WebSite` name in
JSON-LD and `og:site_name`. A status note in an entity name is the kind of string Google may display as the site
name. The brand rules say the name is always lowercase "scoup.ai", and the brand branch sets `SITE_NAME = "scoup.ai"`
and appends " – scoup.ai" to titles (all eight brand titles stay at or under 59 characters; we measured them). Fix:
take the brand branch value; keep the pre-product status in the visible banner and the Organization `description`,
where it already is.

### T7 (P1). Nothing on the site targets a measured keyword cluster

The site has eight indexable pages: home, how it works, security, about, contact and three draft legal pages. None
targets the carrier detention, accessorial dispute or rate-confirmation clusters in `keyword-research.md`, and the
pages that would (`/detention-recovery/`, `/accessorial-audit/`, `/guides/...`, `/evidence-packet-example/`) are
listed as deferred in `marketing/site/README.md`. The how-it-works page has a good title ("How freight detention
recovery works") but a generic H1 ("How it works"). Fix: change the H1 in `pages/how-it-works.html` to match the
title's topic; then add pages in the order of `content-plan.md` section 3, each as a fragment in `pages/` with its own
meta line. Add the new pages to `NAV` in `build.mjs` only when they exist; keep the nav short.

### T8 (P2). Structured data is thin where it is cheap to improve

`jsonLd()` in `build.mjs` emits Organization, WebSite, WebPage, BreadcrumbList and (home only) FAQPage, all honest.
Two gaps: Organization has no `logo`, and WebPage has no `datePublished` or `dateModified`. Fix: add `logo` pointing
to a brand image that meets Google's Organization structured-data image requirements (check format and minimum size
in that documentation before choosing the file), and add `dateModified` from the T4 `updated` field. Add `sameAs`
only for profiles that really exist. When guides ship, give them `Article` with a named author; never add `Review`,
`AggregateRating` or `SoftwareApplication` until something real is available.

### T9 (P2). FAQPage markup is honest but will not earn a rich result

The home page FAQ is visible in `<details>` elements and mirrored in `FAQPage` JSON-LD, which the test suite
enforces. Since August 2023 Google shows FAQ rich results only for well-known, authoritative government and health
sites, and says there is no need to remove existing markup. Fix: none required; just do not count on the rich result,
and do not add FAQ blocks to pages for SEO reasons.

Source: Google Search Central Blog, Changes to HowTo and FAQ rich results (8 August 2023), https://developers.google.com/search/blog/2023/08/howto-faq-changes, accessed 2026-10-17

### T10 (P2). The 404 page carries a canonical tag

`layout()` adds `<link rel="canonical">` and `og:url` to every page, including `pages/404.html`, whose path is
`/404.html` and which is correctly `noindex`. A canonical on an error page is meaningless at best. Fix: in
`build.mjs`, skip the canonical and `og:url` tags when `meta.noindex` is true and the path is `/404.html`, and relax
the matching canonical check in `test.mjs` for that page.

### T11 (P2). Header details

In `static/_headers`, `Permissions-Policy` lists `interest-cohort=()`, which belongs to Google's withdrawn FLoC
proposal and does nothing useful now; remove it to keep the policy clean. Once the site is on its own domain, add
`includeSubDomains` to HSTS if every subdomain will serve HTTPS. `X-Frame-Options: DENY` duplicates
`frame-ancestors 'none'` but is harmless for older browsers. When the calculator ships it needs a script, so the CSP
in both `build.mjs` and `_headers` will need `script-src 'self'` for that page; `test.mjs` currently fails any
non-JSON-LD script and will need a scoped exception.

### T12 (P2). A personal mailbox is the public contact address

The brand workflow sets `CONTACT_EMAIL: mariuscarlsson@gmail.com`, which `build.mjs` writes into the footer and the
contact page of the public site. For a company asking businesses to share freight documents, a personal free-mail
address undercuts the trust the security page works to build, and it exposes the founder's inbox to scraping. Fix:
switch to an address on the production domain once T1 is done.

### T13 (P2). Accessibility basics

There is no skip-to-content link before the nav in `layout()`, and the pre-product banner sits above it. Contrast in
`static/style.css` looks sufficient by inspection (white on `#0b5cad` for buttons), but we did not run an automated
checker. Fix: add a visually hidden "Skip to content" link targeting `<main id="main">`; run an automated WCAG 2.2 AA
check (axe or Lighthouse) once and add the result to the README. Accessibility is a ranking-adjacent quality signal and
a legal-risk item, not a ranking factor we can quantify.

### T14 (P2). The tests do not guard the new rules

`test.mjs` already checks titles, descriptions, canonicals, one H1, OG and Twitter tags, CSP, scripts, external
resources and banned claims. Fix: add checks that draft legal pages carry `noindex` and are absent from the sitemap
(T3), that `lastmod` values differ when page dates differ (T4), that `og:image` is present and absolute (T5), and that
no title or JSON-LD name contains "(pre-product)" (T6).

### T15 (P3). Performance: nothing to fix, something to measure

The master home page is 8,027 bytes of HTML plus a 2,065-byte stylesheet; the brand build adds two 1,059-byte SVG
logos with explicit width and height (no layout shift) and a favicon. There is no JavaScript, no web font and no
third-party request; the live home page downloaded 11,261 bytes in 0.20 s from our connection on 2026-10-17 (one
request, not a benchmark). Core Web Vitals field data needs real traffic and does not exist yet. Fix: after launch,
read Core Web Vitals in Search Console; if the stylesheet ever grows, fingerprint its filename so it can be cached
longer than the 3,600 s set in `_headers`.

## 4. Launch gate

The order matters because some fixes undo others if done early. Secure the domain first (T1), then move to a host
that serves the headers (T2), then rebuild with the final `SITE_URL` and the T3 to T6 fixes merged. Only after that
should Search Console be verified and the sitemap submitted, followed by a real crawl-based audit of the live domain
as `marketing/seo-and-growth.md` section 9 requires. Content from `content-plan.md` starts publishing after the gate,
not before, so that no page earns links on a URL we intend to abandon.

- [ ] T1 domain secured; `SITE_URL` set to it; github.io copy redirected or removed
- [ ] T2 headers confirmed with `curl -sI https://<domain>/`
- [ ] T3 to T6 merged; `npm test` passes with the new checks from T14
- [ ] Search Console Domain property verified by DNS; sitemap submitted; coverage report read
- [ ] Baseline crawl audit recorded (indexation, schema validation in the Rich Results Test, internal links)

## 5. Open questions

- Is scoup.ai registered by the owner through a channel the public RDAP lookup does not show? On 2026-10-17 it did
  not resolve and the registry RDAP returned 404.
- Was the GitHub Pages deployment from `feat/scoup-brand` intended to be public now? Its README on master says "Not
  deployed".
- Has the github.io copy already been indexed? We did not check Google's index; Search Console on that URL prefix
  would answer it.
- Which host will production use (GitHub Pages, Cloudflare Pages, Netlify)? T2's fix depends on it.
