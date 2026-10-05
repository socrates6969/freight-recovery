# Marketing site (static, pre-product)

A real, deployable static site built from `../seo-and-growth.md` and `../landing/outline.md`.
**Not deployed.** You hold the hosting and domain.

## Stack choice

Hand-rolled HTML/CSS plus a ~100-line, zero-dependency Node build script (`build.mjs`, Node >= 18). No
framework, no bundler, no client-side JavaScript, no `node_modules`, so there is nothing to pin or
audit beyond the Node runtime. The script adds the shared layout, per-page SEO tags, JSON-LD,
`sitemap.xml` and `robots.txt`. Pages are fragments in `pages/` (first line `<!--meta {json} -->`).

## Build and preview

```bash
cd marketing/site
SITE_URL=https://www.your-domain.example CONTACT_EMAIL=you@your-domain.example npm run build
npm test            # builds, then checks SEO basics and honesty/security guards
npx --yes serve dist   # or: python -m http.server -d dist 8080
```

`SITE_URL` drives canonical URLs, Open Graph URLs, JSON-LD and the sitemap; `CONTACT_EMAIL` fills the
contact links. If unset, the build uses visible `example.invalid` placeholders and warns.

## What is on the site

Home (value prop, how it works, two audiences, trust limits, design-partner CTA, FAQ), How it works,
Security status, About, Design partners (mailto only: no form backend, no tracking), and **draft** Privacy, Terms,
Cookie/disclaimer pages (each flagged "must be reviewed by a licensed Norwegian advokat"; they do not claim GDPR compliance).

## Lenses built in

- **SEO:** unique title/description, one H1, canonical, Open Graph and Twitter tags, honest JSON-LD
  (Organization, WebSite, WebPage, BreadcrumbList; FAQPage only because the FAQ is visible; no
  SoftwareApplication, no ratings), `sitemap.xml`, `robots.txt`, no JS, ~2 KB CSS.
- **Security:** meta CSP (`default-src 'none'`) plus `static/_headers` with CSP, HSTS, nosniff,
  frame-ancestors, referrer and permissions policies; no third-party resources, so no SRI is needed
  (if you ever add an external asset, pin it with `integrity=` and extend the CSP); no cookies or trackers.
- **Marketing/honesty:** no testimonials, logos, metrics, "AI-powered", certification or integration claims;
  `test.mjs` fails the build on a list of banned phrases.
- **Legal:** DRAFT pages only. A licensed Norwegian advokat must review before use.

## Deploying later (your decision)

Upload `dist/` to any static host (Cloudflare Pages, Netlify, S3+CDN, nginx). Apply the headers in
`dist/_headers` (native on Netlify/Cloudflare; translate on other hosts). Set `SITE_URL` to the final
origin and rebuild, serve over HTTPS, and submit `sitemap.xml` to Search Console. Before launch: complete the
contact address, publish entity details on About/Privacy, and have the legal pages reviewed.

## Deferred

Per-audience pages (`/detention-recovery/`, `/accessorial-audit/`), recovery calculator, guides, evidence-packet example,
pricing and comparison pages from the outline (need content review/verified facts); OG image; a Norwegian-language
version; consent-aware analytics (none by design until decided).
