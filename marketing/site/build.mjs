#!/usr/bin/env node
/**
 * Zero-dependency static site builder (Node >= 18). No framework, no bundler, no runtime JS.
 *
 *   SITE_URL=https://www.example.no CONTACT_EMAIL=you@example.no node build.mjs
 *
 * pages/*.html   fragments; first line is `<!--meta {json} -->` (title, description, path, crumb, noindex?)
 * static/*       copied as-is (style.css, _headers, favicon)
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
const EMAIL = process.env.CONTACT_EMAIL || "contact@example.invalid";
const SITE_NAME = "Freight Recovery (pre-product)";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

if (SITE_URL.includes("example.invalid")) console.warn("WARN: SITE_URL not set; canonical/sitemap use a placeholder. Set it before deploying.");
if (EMAIL.includes("example.invalid")) console.warn("WARN: CONTACT_EMAIL not set; the contact link is a placeholder.");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, "static"), dist, { recursive: true });

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
    { "@type": "WebPage", "@id": `${url}#page`, url, name: meta.title, description: meta.description, isPartOf: { "@id": `${SITE_URL}/#site` }, inLanguage: "en" },
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
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">
<meta name="robots" content="${robots}">
<meta name="referrer" content="no-referrer">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(meta.title)}">
<meta name="twitter:description" content="${esc(meta.description)}">
<link rel="stylesheet" href="/style.css">
<script type="application/ld+json">${jsonLd(meta, url)}</script>
</head>
<body>
<p class="status" role="note"><strong>Pre-product.</strong> Nothing here is a live service; no customer data is accepted yet. Examples use synthetic data.</p>
<header class="site"><a class="brand" href="/">Freight Recovery</a>
<nav aria-label="Main">${NAV.map(([h, t]) => `<a href="${h}"${h === meta.path ? ' aria-current="page"' : ""}>${t}</a>`).join("")}</nav></header>
<main>
${body}
</main>
<footer class="site">
<p>Freight Recovery is a pre-product venture in design-partner validation. No customers, certifications or integrations are claimed.</p>
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
  if (meta.title.length > 60) console.warn(`WARN ${f}: title ${meta.title.length} chars (>60)`);
  if (meta.description.length > 160) console.warn(`WARN ${f}: description ${meta.description.length} chars (>160)`);
  const html = layout(meta, raw.slice(m[0].length));
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
console.log(`built ${urls.length} indexable pages -> ${dist}`);
