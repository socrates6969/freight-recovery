# Marketing site (static) and the public app

The launch site of scoup.ai plus the public app under `/app/`: the shared rules engine
(`packages/shared`) bundled by Vite from `web/product/` and `web/src/product/` so that every check
runs in the visitor's browser (no API, no network after load, no storage). The site itself is built from
`../seo-and-growth.md` and `../landing/outline.md`.
**Deployed to GitHub Pages** at https://socrates6969.github.io/freight-recovery/ by
`.github/workflows/pages.yml` on every push to `master` that touches `marketing/site/` or `brand/`.
The workflow builds with `npm test`, so a failing check blocks the deploy. When the site is served under
a sub-path, `SITE_URL`'s path becomes the base path and every root-absolute link is prefixed with it.
GitHub Pages ignores `static/_headers` (only the meta tags apply there), and crawlers read
`robots.txt` only at a domain root. See "What GitHub Pages cannot do" below.

## Stack choice

Hand-rolled HTML/CSS plus a zero-dependency Node build script (`build.mjs`, Node >= 18) for the pages: no
framework, no bundler, no client-side JavaScript, no `node_modules`. The app is the one exception: it is a
Vite build of the web workspace (`npm run build:product -w web`, output `web/dist-product`) that `build.mjs`
copies to `dist/app/` when `SITE_APP_DIR` points at it. Without `SITE_APP_DIR` a plain placeholder page is
written so local link checks still resolve; `test.mjs` refuses the placeholder when the variable is set. The script adds the shared layout, per-page SEO tags, JSON-LD,
`sitemap.xml` and `robots.txt`. Pages are fragments in `pages/` (first line `<!--meta {json} -->`).
The header/footer logo and favicon are copied at build time from the repo-root `brand/` folder (see
`brand/README.md` for the name and logo rules: always lowercase "scoup.ai").

## Build and preview

```bash
# App bundle (from the repository root; needs npm ci --ignore-scripts once)
SITE_URL=https://www.your-domain.example npm run build -w packages/shared && npm run build:product -w web
# Pages (from marketing/site)
cd marketing/site
SITE_URL=https://www.your-domain.example CONTACT_EMAIL=you@your-domain.example SITE_APP_DIR=../../web/dist-product npm test
npx --yes serve dist   # or: python -m http.server -d dist 8080
```

`SITE_URL` drives canonical URLs, Open Graph URLs, JSON-LD and the sitemap; `CONTACT_EMAIL` fills the
contact links. If unset, the build uses visible `example.invalid` placeholders and warns.

Each page's meta line may carry `"updated": "YYYY-MM-DD"`, the date of its last content change. It becomes
the sitemap `<lastmod>` and the WebPage `dateModified`; a page without it gets no `lastmod` at all. Bump it
when you change a page's content. The build date is never used (it would mark every page as changed on every
build), and a `git log` fallback is not used because the Pages workflow checks out a shallow clone.

## What is on the site

Launch positioning (owner decision of 2026-10-19): scoup.ai is the product, and the product is the browser app.
Home leads with "Check freight invoices in your browser." and its primary call to action opens `/app/`; then
Product (every rule of the three tools, and the team workspace prototype), How it works (worked synthetic example
LD-5001, the same one the app loads), Pricing (browser tools free; team workspace by early-access request),
Security and privacy (what runs where, limits, prototype controls), About, Contact, and indexable Privacy, Terms and
Cookies notices. The team workspace (`api/`, `web/`) is described as a prototype that is not hosted or offered.

Copy rules the tests enforce: any page that describes the FMC billing rule carries the current eCFR source line
and "confirm with counsel or your customs broker"; no page carries pre-launch wording ("pre-product", "design
partner"); banned words include "recovered", "accurate", "secure", "seamless", "robust", "leverage" and "saves";
no accuracy figures or customer results; the home page is the only one with a SoftwareApplication schema; every
page links to the app from the header. Sources are plain text, not links, because the site loads and links to
nothing outside itself.
## Lenses built in

- **SEO:** unique title/description, one H1, canonical, Open Graph and Twitter tags, honest JSON-LD
  (Organization, WebSite, WebPage with `dateModified`, BreadcrumbList; FAQPage only because the FAQ is
  visible; no SoftwareApplication, no ratings), `sitemap.xml` with per-page `lastmod`, `robots.txt`, no JS,
  ~2 KB CSS. Titles say "accessorial", "D&D", "freight invoice" and "rate confirmation", not "claim".
- **Security:** `static/_headers` holds the full header set (CSP, HSTS, nosniff, X-Frame-Options,
  frame-ancestors, referrer and permissions policies, COOP). `build.mjs` derives the meta CSP and the meta
  referrer policy from that file, so they cannot drift; the meta CSP drops `frame-ancestors`, which a meta tag
  cannot carry. The referrer policy is `no-referrer` in both places (stricter than the browser default
  `strict-origin-when-cross-origin`; the site links nowhere external, so nothing breaks). No third-party
  resources, so no SRI is needed (if you ever add an external asset, pin it with `integrity=` and extend the
  CSP in `_headers`); no cookies or trackers.
- **Marketing/honesty:** no testimonials, logos, unsupported product-performance metrics, "AI-powered", certification or integration claims;
  `test.mjs` fails the build on a list of banned phrases.
- **Legal:** the Privacy, Terms and Cookies pages describe the static site and the browser app as they are.
  Legal entity details are not confirmed for publication and are marked as such. Obtain legal review before
  accepting customer files or offering the hosted workspace.

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
(need content review and verified facts); Organization `logo` in JSON-LD; dropping the canonical tag on the 404 page;
removing the obsolete `interest-cohort` directive from `_headers`; a skip link; a Norwegian-language version;
consent-aware analytics (none by design until decided). The stylesheet uses the brand teal defined in
`brand/README.md`.
