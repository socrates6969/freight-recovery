#!/usr/bin/env node
/**
 * Zero-dependency static site builder (Node >= 18). No framework, no bundler, no runtime JS.
 *
 *   SITE_URL=https://www.example.no CONTACT_EMAIL=you@example.no node build.mjs
 *
 * pages/*.html   fragments; first line is `<!--meta {json} -->` (title, description, path, crumb, noindex?)
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
const OG_IMAGE_ALT = "scoup.ai: Get paid for detention you can prove. Pre-product, looking for design partners.";
const brandDir = join(root, "..", "..", "brand");
// Horizontal lockup: viewBox 873.32 x 162.97. Header 28px tall, footer 20px (the minimum on screen).
const LOCKUP_RATIO = 873.32 / 162.97;
const BRAND_FILES = ["lockup-horizontal.svg", "lockup-horizontal-on-dark.svg", "favicon.svg"];
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
  ["/how-it-works/", "How it works"],
  ["/security/", "Security status"],
  ["/about/", "About"],
  ["/contact/", "Design partners"],
];

function jsonLd(meta, url) {
  const graph = [
    { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: SITE_NAME, url: `${SITE_URL}/`,
      description: "Pre-product venture working on documented freight detention and accessorial recovery. Not yet a live service." },
    { "@type": "WebSite", "@id": `${SITE_URL}/#site`, url: `${SITE_URL}/`, name: SITE_NAME, publisher: { "@id": `${SITE_URL}/#org` }, inLanguage: "en" },
    { "@type": "WebPage", "@id": `${url}#page`, url, name: fullTitle(meta), description: meta.description, isPartOf: { "@id": `${SITE_URL}/#site` }, inLanguage: "en" },
  ];
  if (meta.path !== "/") {
    graph.push({ "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: meta.crumb || meta.title, item: url },
    ] });
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(meta.description)}">
<meta name="robots" content="${robots}">
<meta name="referrer" content="no-referrer">
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
<p class="status" role="note"><strong>Pre-product.</strong> Nothing here is a live service; no customer data is accepted yet. Examples use synthetic data.</p>
<header class="site">${lockup(28, "brand")}
<nav aria-label="Main">${NAV.map(([h, t]) => `<a href="${h}"${h === meta.path ? ' aria-current="page"' : ""}>${t}</a>`).join("")}</nav></header>
<main>
${body}
</main>
<footer class="site">
${lockup(20, "brand brand-footer")}
<p>This site belongs to ${SITE_NAME}, a pre-product venture in design-partner validation. No customers, certifications or integrations are claimed.</p>
<p><a href="/privacy/">Privacy (draft)</a> | <a href="/terms/">Terms (draft)</a> | <a href="/cookies/">Cookies (draft)</a> | <a href="mailto:${esc(EMAIL)}">Contact</a></p>
<p>This site sets no cookies, runs no scripts and loads no third-party resources.</p>
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
  if (!meta.noindex) urls.push(meta.path);
}

const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.sort().map((p) => `  <url><loc>${esc(SITE_URL + p)}</loc><lastmod>${today}</lastmod></url>`).join("\n") + `\n</urlset>\n`);
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
console.log(`built ${urls.length} indexable pages -> ${dist}${BASE ? ` (base path ${BASE})` : ""}`);
