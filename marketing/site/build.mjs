#!/usr/bin/env node
/**
 * Zero-dependency static site builder (Node >= 18). No framework, no bundler, no runtime JS on these pages.
 * The product app (web/dist-product, a separate Vite build) is copied to dist/app when SITE_APP_DIR points at it;
 * without it a plain placeholder page is written so links resolve in local checks (the Pages workflow always sets it).
 *
 *   SITE_URL=https://www.example.no CONTACT_EMAIL=you@example.no node build.mjs
 *
 * pages/*.html   fragments; first line is `<!--meta {json} -->` (title, description, path, crumb, updated?, noindex?, faq?)
 *                updated = "YYYY-MM-DD" of the page's last content change; it becomes the sitemap lastmod and
 *                the WebPage dateModified. Without it no lastmod is written (never the build date).
 * static/*       copied as-is (style.css, _headers)
 * ../../brand/   logo files (single source of truth) -> dist/favicon.svg, dist/brand/*.svg
 * -> dist/<path>/index.html, sitemap.xml, robots.txt, 404.html
 *
 * SITE_URL has no default that looks real: an unset value builds with a visible placeholder and
 * the build prints a warning, because canonical/sitemap URLs must be the user's real domain.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const SITE_URL = (process.env.SITE_URL || "https://example.invalid").replace(/\/$/, "");
// Path prefix when the site is served from a sub-path (e.g. GitHub project Pages at
// https://user.github.io/repo): "" at a domain root, "/repo" otherwise. Root-absolute links in the
// output are rewritten through withBase() so CSS, logo and navigation resolve under the prefix.
const BASE = new URL(SITE_URL).pathname.replace(/\/$/, "");
const withBase = (html) => (BASE ? html.replace(/\b(href|src|srcset)="\/(?!\/)/g, `$1="${BASE}/`) : html);
const EMAIL = process.env.CONTACT_EMAIL || "contact@example.invalid";
// Brand name: always lowercase "scoup.ai" (see brand/README.md). Never put it in an uppercase context.
const SITE_NAME = "scoup.ai";
const TITLE_SEP = " – "; // en dash: "Page – scoup.ai"
const MAX_TITLE = 60;
const MAX_DESCRIPTION = 160;
// Social preview card (static/og-card.png, rendered from og/og-card.html). Crawlers need an absolute URL.
const OG_IMAGE = `${SITE_URL}/og-card.png`;
const OG_IMAGE_ALT = "scoup.ai: check freight invoices in your browser. Accessorials, detention and ocean D&D against the rate confirmation and the tariff, with the arithmetic shown.";
const APP_DIR = process.env.SITE_APP_DIR ? join(process.cwd(), process.env.SITE_APP_DIR) : null;
const brandDir = join(root, "..", "..", "brand");
// Horizontal lockup: viewBox 873.32 x 162.97. Header 28px tall, footer 20px (the minimum on screen).
const LOCKUP_RATIO = 873.32 / 162.97;
const BRAND_FILES = ["lockup-horizontal.svg", "lockup-horizontal-on-dark.svg", "favicon.svg"];
// The meta CSP and referrer policy are derived from static/_headers so the two never drift apart. A meta CSP
// cannot carry frame-ancestors (or report-uri/report-to/sandbox), so those stay header-only; on a host that
// ignores _headers (GitHub Pages) the pages can therefore still be framed. See README.md.
const HEADERS = readFileSync(join(root, "static", "_headers"), "utf8");
function headerValue(name) {
  const line = HEADERS.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith(`${name}:`));
  if (!line) throw new Error(`static/_headers: ${name} missing`);
  return line.slice(name.length + 1).trim();
}
const META_CSP = headerValue("Content-Security-Policy").split(";").map((d) => d.trim())
  .filter((d) => d && !/^(frame-ancestors|report-uri|report-to|sandbox)\b/.test(d)).join("; ");
const REFERRER = headerValue("Referrer-Policy");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

if (SITE_URL.includes("example.invalid")) console.warn("WARN: SITE_URL not set; canonical/sitemap use a placeholder. Set it before deploying.");
if (EMAIL.includes("example.invalid")) console.warn("WARN: CONTACT_EMAIL not set; the contact link is a placeholder.");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, "static"), dist, { recursive: true });
mkdirSync(join(dist, "brand"), { recursive: true });
for (const f of BRAND_FILES) cpSync(join(brandDir, f), join(dist, "brand", f));
cpSync(join(brandDir, "favicon.svg"), join(dist, "favicon.svg"));

/** Full document title: home is "scoup.ai – <title>", every other page "<title> – scoup.ai". */
function fullTitle(meta) {
  return meta.path === "/" ? `${SITE_NAME}${TITLE_SEP}${meta.title}` : `${meta.title}${TITLE_SEP}${SITE_NAME}`;
}

/**
 * Logo lockup linked to the home page. The dark-tile file is the default (light theme); the site
 * follows prefers-color-scheme, so the same media query swaps in the light-tile (on-dark) file.
 * Self-hosted SVG via <img>: allowed by img-src 'self', no inline style.
 */
function lockup(heightPx, cls) {
  const w = Math.round(heightPx * LOCKUP_RATIO);
  return `<a class="${cls}" href="/" aria-label="${SITE_NAME} home"><picture>` +
    `<source media="(prefers-color-scheme: dark)" srcset="/brand/lockup-horizontal-on-dark.svg">` +
    `<img src="/brand/lockup-horizontal.svg" alt="${SITE_NAME}" width="${w}" height="${heightPx}"></picture></a>`;
}

const NAV = [
  ["/platform/", "Product"],
  ["/how-it-works/", "How it works"],
  ["/pricing/", "Pricing"],
  ["/security/", "Security and privacy"],
  ["/about/", "About"],
  ["/contact/", "Contact"],
];

function jsonLd(meta, url) {
  const graph = [
    { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: SITE_NAME, url: `${SITE_URL}/`,
      description: "scoup.ai checks accessorial, detention and ocean D&D invoices against the rate confirmation, the carrier tariff and the FMC billing rule. The checks run in the visitor's browser." },
    { "@type": "WebSite", "@id": `${SITE_URL}/#site`, url: `${SITE_URL}/`, name: SITE_NAME, publisher: { "@id": `${SITE_URL}/#org` }, inLanguage: "en" },
    { "@type": "WebPage", "@id": `${url}#page`, url, name: fullTitle(meta), description: meta.description, isPartOf: { "@id": `${SITE_URL}/#site` }, inLanguage: "en",
      ...(meta.updated ? { dateModified: meta.updated } : {}) },
  ];
  if (meta.path !== "/") {
    graph.push({ "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: meta.crumb || meta.title, item: url },
    ] });
  }
  if (meta.path === "/") {
    graph.push({ "@type": "SoftwareApplication", "@id": `${SITE_URL}/app/#app`, name: `${SITE_NAME} app`, url: `${SITE_URL}/app/`,
      applicationCategory: "BusinessApplication", operatingSystem: "Any (web browser)", browserRequirements: "Requires JavaScript",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, publisher: { "@id": `${SITE_URL}/#org` },
      description: "Freight invoice checks that run in the browser: accessorial and detention lines against the rate confirmation, ocean D&D invoices against 46 CFR Part 541 and the carrier tariff, and charge-name recognition." });
  }
  if (meta.faq) {
    graph.push({ "@type": "FAQPage", mainEntity: meta.faq.map(([q, a]) => (
      { "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });
  }
  // Escape "<" so the JSON can never close the script element.
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
}

function layout(meta, body) {
  const url = `${SITE_URL}${meta.path}`;
  const robots = meta.noindex ? "noindex, follow" : "index, follow";
  const title = fullTitle(meta);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(META_CSP)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(meta.description)}">
<meta name="robots" content="${robots}">
<meta name="referrer" content="${esc(REFERRER)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(OG_IMAGE)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(OG_IMAGE_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(meta.description)}">
<meta name="twitter:image" content="${esc(OG_IMAGE)}">
<meta name="twitter:image:alt" content="${esc(OG_IMAGE_ALT)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css">
<script type="application/ld+json">${jsonLd(meta, url)}</script>
</head>
<body>
<header class="site">${lockup(28, "brand")}
<nav aria-label="Main">${NAV.map(([h, t]) => `<a href="${h}"${h === meta.path ? ' aria-current="page"' : ""}>${t}</a>`).join("")}<a class="cta nav-cta" href="/app/">Open the app</a></nav></header>
<main>
${body}
</main>
<footer class="site">
${lockup(20, "brand brand-footer")}
<p>${SITE_NAME} checks freight invoices with fixed, published rules and shows its arithmetic. It does not decide what is owed and does not give legal advice; outputs are drafts for a person to review.</p>
<p><a href="/app/">Open the app</a> | <a href="/privacy/">Privacy</a> | <a href="/terms/">Terms</a> | <a href="/cookies/">Cookies</a> | <a href="mailto:${esc(EMAIL)}">Contact</a></p>
<p>These pages set no cookies, run no scripts and load no third-party resources. The app runs in your browser and sends nothing anywhere.</p>
</footer>
</body>
</html>
`;
}

const urls = [];
for (const f of readdirSync(join(root, "pages")).filter((n) => n.endsWith(".html"))) {
  const raw = readFileSync(join(root, "pages", f), "utf8").replaceAll("__CONTACT_EMAIL__", esc(EMAIL));
  const m = raw.match(/^<!--meta\s*([\s\S]*?)-->\s*/);
  if (!m) throw new Error(`${f}: missing <!--meta {json} --> first line`);
  const meta = JSON.parse(m[1]);
  for (const k of ["title", "description", "path"]) if (!meta[k]) throw new Error(`${f}: meta.${k} missing`);
  if (meta.updated !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(meta.updated)) throw new Error(`${f}: meta.updated must be YYYY-MM-DD`);
  const t = fullTitle(meta);
  if (t.length > MAX_TITLE) console.warn(`WARN ${f}: title ${t.length} chars (>${MAX_TITLE})`);
  if (meta.description.length > MAX_DESCRIPTION) console.warn(`WARN ${f}: description ${meta.description.length} chars (>${MAX_DESCRIPTION})`);
  const html = withBase(layout(meta, raw.slice(m[0].length)));
  if (meta.path === "/404.html") {
    writeFileSync(join(dist, "404.html"), html);
    continue;
  }
  const dir = join(dist, meta.path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  if (!meta.noindex) urls.push(meta);
}

// The product app: a separate Vite build (web/dist-product) copied under /app/. Without SITE_APP_DIR, a
// placeholder keeps local link checks meaningful; test.mjs refuses the placeholder when SITE_APP_DIR is set.
const appDist = join(dist, "app");
if (APP_DIR) {
  cpSync(APP_DIR, appDist, { recursive: true });
} else {
  mkdirSync(appDist, { recursive: true });
  writeFileSync(join(appDist, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>scoup.ai app (not built)</title><meta name="robots" content="noindex"></head><body><p>The app bundle is built separately (npm run build:product -w web) and copied here by the Pages workflow.</p><p><a href="${BASE}/">Back to the site</a></p></body></html>\n`);
  console.warn("WARN: SITE_APP_DIR not set; dist/app holds a placeholder, not the product app.");
}

// lastmod comes only from each page's own "updated" date: one build date on every URL teaches crawlers to
// ignore lastmod. (A git-log fallback would be wrong in CI, where the Pages workflow uses a shallow clone.)
writeFileSync(join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.sort((a, b) => a.path.localeCompare(b.path)).map((m) =>
    `  <url><loc>${esc(SITE_URL + m.path)}</loc>${m.updated ? `<lastmod>${m.updated}</lastmod>` : ""}</url>`).join("\n") + `\n</urlset>\n`);
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
console.log(`built ${urls.length} indexable pages -> ${dist}${BASE ? ` (base path ${BASE})` : ""}`);
