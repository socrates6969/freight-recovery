#!/usr/bin/env node
/**
 * Zero-dependency static site builder (Node >= 18). No framework, no bundler, no runtime JS.
 *
 *   SITE_URL=https://www.example.no CONTACT_EMAIL=you@example.no node build.mjs
 *
 * pages/*.html   fragments; first line is `<!--meta {json} -->` (title, description, path, crumb, updated?, noindex?, faq?)
 *                updated = "YYYY-MM-DD" of the page's last content change; it becomes the sitemap lastmod and
 *                the WebPage dateModified. Without it no lastmod is written (never the build date).
 *                Page bodies may use {{icon:name}}; it becomes an inline line icon from ICONS (aria-hidden, so it
 *                must sit next to visible label text).
 * static/*       copied as-is (style.css, _headers, fonts/)
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
const OG_IMAGE_ALT = "scoup.ai: Take accessorial review off AP's desk. Pre-product, looking for design partners.";
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

/**
 * Simple line icons drawn on a 24px grid (no icon library, no external request; inline SVG is markup, so the
 * strict CSP is unaffected). Every icon is decorative: aria-hidden, next to a visible label that names what the
 * link does, so the link's accessible name is that label and meaning never rests on the icon or its colour.
 * No style attributes: the CSP has no 'unsafe-inline' for styles.
 */
const ICONS = {
  buyers: '<path d="M3 6h11v9H3z"/><path d="M14 9h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.5"/><circle cx="17.5" cy="17.5" r="1.5"/>',
  container: '<rect x="3" y="6" width="18" height="12" rx="1"/><path d="M7.5 6v12M12 6v12M16.5 6v12"/>',
  developers: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5.5l-3 13"/>',
  investors: '<path d="M4 20h16"/><path d="M7 16v-4M12 16V8M17 16V5"/>',
  platform: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
  flow: '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h10M14 9l3 3-3 3"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  partner: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
  key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M21 12v2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 7l9 6 9-6"/>',
};
function icon(name) {
  if (!ICONS[name]) throw new Error(`unknown icon "${name}"`);
  return `<svg class="icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}
const withIcons = (html) => html.replace(/{{icon:([a-z]+)}}/g, (_, n) => icon(n));

// Audience entry points first (buyers, developers, investors), then the site pages. Every item carries an icon
// and a visible label; "How it works" is reached from Buyers, Platform and the footer.
const NAV = [
  ["/buyers/", "Buyers", "buyers"],
  ["/developers/", "Developers", "developers"],
  ["/investors/", "Investors", "investors"],
  ["/platform/", "Platform", "platform"],
  ["/security/", "Security status", "shield"],
  ["/about/", "About", "info"],
  ["/contact/", "Design partners", "partner"],
];

function jsonLd(meta, url) {
  const graph = [
    { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: SITE_NAME, url: `${SITE_URL}/`,
      description: "Pre-product venture building accessorial, detention and container D&D invoice checks for shippers and importers. Not yet a live service." },
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
  // The 404 page has no URL of its own to declare, so it gets no canonical and no og:url (technical-checklist T10).
  const is404 = meta.path === "/404.html";
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
${is404 ? "" : `<link rel="canonical" href="${esc(url)}">`}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(meta.description)}">
${is404 ? "" : `<meta property="og:url" content="${esc(url)}">`}
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
<a class="skip" href="#main">Skip to content</a>
<p class="status" role="note"><strong>Pre-product.</strong> Nothing here is a live service; no customer data is accepted yet. Examples use synthetic data.</p>
<header class="site">${lockup(28, "brand")}
<nav aria-label="Main">${NAV.map(([h, t, i]) => `<a href="${h}"${h === meta.path ? ' aria-current="page"' : ""}>${icon(i)}${t}</a>`).join("")}</nav></header>
<main id="main">
${body}
</main>
<footer class="site">
${lockup(20, "brand brand-footer")}
<p>This site belongs to ${SITE_NAME}, a pre-product venture in design-partner validation. No customers, certifications or integrations are claimed.</p>
<p><a href="/how-it-works/">How it works</a> | <a href="/buyers/">Buyers</a> | <a href="/developers/">Developers</a> | <a href="/investors/">Investors</a></p>
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
  if (meta.updated !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(meta.updated)) throw new Error(`${f}: meta.updated must be YYYY-MM-DD`);
  const t = fullTitle(meta);
  if (t.length > MAX_TITLE) console.warn(`WARN ${f}: title ${t.length} chars (>${MAX_TITLE})`);
  if (meta.description.length > MAX_DESCRIPTION) console.warn(`WARN ${f}: description ${meta.description.length} chars (>${MAX_DESCRIPTION})`);
  const html = withBase(layout(meta, withIcons(raw.slice(m[0].length))));
  if (meta.path === "/404.html") {
    writeFileSync(join(dist, "404.html"), html);
    continue;
  }
  const dir = join(dist, meta.path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  if (!meta.noindex) urls.push(meta);
}

// lastmod comes only from each page's own "updated" date: one build date on every URL teaches crawlers to
// ignore lastmod. (A git-log fallback would be wrong in CI, where the Pages workflow uses a shallow clone.)
writeFileSync(join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.sort((a, b) => a.path.localeCompare(b.path)).map((m) =>
    `  <url><loc>${esc(SITE_URL + m.path)}</loc>${m.updated ? `<lastmod>${m.updated}</lastmod>` : ""}</url>`).join("\n") + `\n</urlset>\n`);
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
console.log(`built ${urls.length} indexable pages -> ${dist}${BASE ? ` (base path ${BASE})` : ""}`);
