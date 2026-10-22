// Post-build checks: SEO basics, honesty guards, security guards. Run: npm test
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "dist");
// Same base-path rule as build.mjs: "" at a domain root, "/repo" under a sub-path.
const BASE = new URL((process.env.SITE_URL || "https://example.invalid").replace(/\/$/, "")).pathname.replace(/\/$/, "");
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const B = reEsc(BASE);
// static/_headers is the source of truth for the CSP and referrer policy; the meta tags must mirror it.
const HEADERS = readFileSync(join(dist, "_headers"), "utf8").split(/\r?\n/).map((l) => l.trim());
const headerValue = (name) => ((HEADERS.find((l) => l.startsWith(`${name}:`)) || "").slice(name.length + 1)).trim();
const HEADER_CSP = headerValue("Content-Security-Policy");
const EXPECTED_META_CSP = HEADER_CSP.split(";").map((d) => d.trim()).filter((d) => d && !d.startsWith("frame-ancestors")).join("; ");
const pages = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith(".html")) pages.push(p);
  }
})(dist);
// The app under dist/app is a separate Vite bundle with its own checks (web/tools/check-product-dist.mjs);
// here only its presence is verified. Everything else in dist is a site page.
const appIndex = join(dist, "app", "index.html");
const appPages = pages.filter((p) => p.startsWith(join(dist, "app")));
pages.splice(0, pages.length, ...pages.filter((p) => !appPages.includes(p)));
// The developer portal under dist/docs is an MkDocs build with its own strict build (developer-portal/build.py);
// here its presence, that it is the real portal when SITE_DOCS_DIR is set, and the site's no-network rule are checked.
const docsDir = join(dist, "docs");
const docsIndex = join(docsDir, "index.html");
const docsPages = pages.filter((p) => p.startsWith(docsDir));
pages.splice(0, pages.length, ...pages.filter((p) => !docsPages.includes(p)));

let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.error("FAIL:", msg); } };

check(pages.length >= 11, "expected >= 11 pages");
check(existsSync(appIndex), "dist/app/index.html exists (product app or local placeholder)");
if (process.env.SITE_APP_DIR) {
  const appHtml = existsSync(appIndex) ? readFileSync(appIndex, "utf8") : "";
  check(existsSync(join(dist, "app", "assets")), "SITE_APP_DIR set: dist/app/assets must hold the built app");
  check(appHtml.includes('type="module"') && appHtml.includes("connect-src 'none'"), "SITE_APP_DIR set: dist/app/index.html must be the real app with its CSP");
  check(!appHtml.includes("not built"), "SITE_APP_DIR set: dist/app must not be the placeholder");
}
check(existsSync(docsIndex), "dist/docs/index.html exists (developer portal or local placeholder)");
if (process.env.SITE_DOCS_DIR) {
  const docsHtml = existsSync(docsIndex) ? readFileSync(docsIndex, "utf8") : "";
  check(existsSync(join(docsDir, "assets", "stylesheets")) && existsSync(join(docsDir, "api", "openapi.json")), "SITE_DOCS_DIR set: dist/docs must hold the built portal (assets and api/openapi.json)");
  check(/<meta name="generator" content="mkdocs-/.test(docsHtml) && !docsHtml.includes("<title>scoup.ai developer portal (not built)</title>"), "SITE_DOCS_DIR set: dist/docs/index.html must be the MkDocs portal, not the placeholder");
  const docsText = docsHtml.replace(/<script[\s\S]*?<\/script>/g, "").toLowerCase();
  check(docsText.includes("prototype") && docsText.includes("early-access teams"), "SITE_DOCS_DIR set: the portal landing page must say the workspace API is a prototype with keys for early-access teams only");
}
// No HTML or CSS under dist/docs may load or link anything from the network: no http(s) URL in src/href/url().
// The canonical link (the portal's own published address) is the one exception.
const docsFiles = [];
(function walk(d) {
  if (!existsSync(d)) return;
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(?:html|css)$/.test(n)) docsFiles.push(p);
  }
})(docsDir);
for (const p of docsFiles) {
  const body = readFileSync(p, "utf8").replace(/<link rel="canonical"[^>]*>/g, "");
  const hits = [...body.matchAll(/(?:\b(?:src|href)=["']|url\(\s*["']?)(https?:\/\/[^"') ]*)/g)].map((m) => m[1]);
  check(hits.length === 0, `${p.slice(dist.length)}: external URL under dist/docs: ${hits.slice(0, 3).join(", ")}`);
}
for (const p of pages) {
  const h = readFileSync(p, "utf8");
  const rel = p.slice(dist.length);
  check(/<title>[^<]{5,}<\/title>/.test(h), `${rel}: title`);
  check(/<meta name="description" content="[^"]{20,}"/.test(h), `${rel}: description`);
  check(/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(h), `${rel}: responsive viewport`);
  check(/<link rel="canonical" href="https?:\/\//.test(h), `${rel}: canonical`);
  check((h.match(/<h1[ >]/g) || []).length === 1, `${rel}: exactly one h1`);
  check(/property="og:title"/.test(h) && /name="twitter:card"/.test(h), `${rel}: og/twitter`);
  const ogImg = (h.match(/<meta property="og:image" content="([^"]+)">/) || [])[1] || "";
  check(/^https?:\/\/[^"]+\/og-card\.png$/.test(ogImg), `${rel}: absolute og:image (${ogImg})`);
  check(/<meta name="twitter:card" content="summary_large_image">/.test(h) && h.includes(`<meta name="twitter:image" content="${ogImg}">`), `${rel}: large twitter card with image`);
  check(/<meta property="og:image:alt" content="[^"]{20,}">/.test(h), `${rel}: og:image alt text`);
  check(/Content-Security-Policy/.test(h), `${rel}: CSP meta`);
  // security: only the JSON-LD script; no inline handlers; no third-party URLs in src/href attrs
  const scripts = [...h.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  check(scripts.every((a) => a.includes("application/ld+json")), `${rel}: only JSON-LD scripts`);
  check(!/\son[a-z]+\s*=/i.test(h.replace(/<script[\s\S]*?<\/script>/g, "")), `${rel}: no inline handlers`);
  check(!/(?:src|href)="https?:\/\/(?!example\.invalid|[^"]*\/sitemap)/.test(h.replace(/<link rel="canonical"[^>]*>/, "")), `${rel}: no external resources`);
  // honesty: banned claims
  const text = h.replace(/<script[\s\S]*?<\/script>/g, "").toLowerCase();
  check(!/\b(?:lorem ipsum|todo|coming soon|dummy data|example\.invalid|to be completed|to be determined|to be drafted|__contact_email__)\b/i.test(h), `${rel}: no shipped placeholder text`);
  for (const bad of ["soc 2", "gdpr compliant", "iso 27001", "testimonial", "trusted by", "% savings", "ai-powered",
    "recovered", "accurate", "seamless", "robust", "leverage", "saves "]) {
    check(!text.includes(bad), `${rel}: banned phrase "${bad}"`);
  }
  check(!/\bsecure\b/.test(text), `${rel}: "secure" used as a claim`);
  // Internal benchmark results are unpublished until data and methods are independently reproduced.
  if (rel.replaceAll("\\", "/") === "/platform/index.html") {
    for (const unpublished of ["2,132", "3,000", "145/159", "15% lower error", "74-81%", "74–81%", "80% ranges"])
      check(!text.includes(unpublished.toLowerCase()), `${rel}: unpublished benchmark "${unpublished}"`);
    check(text.includes("not published") && text.includes("not been independently reproduced"), `${rel}: benchmark caveat`);
  }
  // honesty: rule effects and third-party figures always travel with their source and caveat
  if (text.includes("fmc") || text.includes("46 cfr")) {
    check(text.includes("counsel or your customs broker"), `${rel}: FMC rule described without the counsel/customs-broker note`);
    check(text.includes("ecfr.gov/current/title-46/chapter-iv/subchapter-b/part-541"), `${rel}: FMC rule described without the current eCFR source`);
  }
  if (/\brxo\b/.test(text)) {
    check(text.includes("a freight broker") && text.includes("rxo.com/resources/research/freight-accessorials"), `${rel}: RXO survey quoted without broker label and source line`);
  }
  if (/\batri\b/.test(text)) check(text.includes("cost of waiting"), `${rel}: ATRI figure quoted without the cost-of-waiting caveat`);
  // security: meta CSP and referrer policy mirror static/_headers (minus frame-ancestors, which meta cannot carry)
  check(h.includes(`<meta http-equiv="Content-Security-Policy" content="${EXPECTED_META_CSP.replace(/&/g, "&amp;")}">`) && EXPECTED_META_CSP.includes("default-src 'none'"), `${rel}: meta CSP must equal the _headers CSP minus frame-ancestors`);
  check(h.includes(`<meta name="referrer" content="${headerValue("Referrer-Policy")}">`), `${rel}: meta referrer must equal _headers Referrer-Policy`);
  if (/[\\/](privacy|terms|cookies)[\\/]/.test(rel)) {
    // Real notices now: indexable, dated, and free of the old draft banner and placeholders.
    check(h.includes('<meta name="robots" content="index, follow">'), `${rel}: legal notice is indexable`);
    check(!/DRAFT - |must be reviewed by a licensed|To be completed|To be determined|to be drafted|placeholder/i.test(h), `${rel}: unfinished legal placeholder`);
  }
  // Every local page and asset referenced by rendered HTML must exist in dist; external/fragment URLs are ignored.
  const refs = [];
  for (const m of h.matchAll(/\b(?:href|src)="([^"]+)"/g)) refs.push(m[1]);
  for (const m of h.matchAll(/\bsrcset="([^"]+)"/g)) for (const candidate of m[1].split(',')) refs.push(candidate.trim().split(/\s+/)[0]);
  for (const ref of refs) {
    if (!ref || ref.startsWith('#')) continue;
    let u;
    try { u = new URL(ref, `https://local.invalid${rel.replaceAll('\\', '/')}`); } catch { check(false, `${rel}: invalid URL ${ref}`); continue; }
    if (u.origin !== 'https://local.invalid') continue;
    let pathname;
    try { pathname = decodeURIComponent(u.pathname); } catch { check(false, `${rel}: malformed URL ${ref}`); continue; }
    if (BASE && (pathname === BASE || pathname.startsWith(`${BASE}/`))) pathname = pathname.slice(BASE.length);
    const target = join(dist, pathname.replace(/^\//, ''));
    const resolved = pathname.endsWith('/') || !/\.[a-z0-9]{1,8}$/i.test(pathname) ? join(target, 'index.html') : target;
    check(existsSync(resolved), `${rel}: broken local link or asset ${ref}`);
  }
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
  // brand (brand/README.md): one name, lowercase, logo in header and footer, favicon
  check(!h.includes("Freight Recovery"), `${rel}: old product name "Freight Recovery"`);
  check(!/Scoup|SCOUP|scoup\s+ai/.test(h), `${rel}: name must be lowercase "scoup.ai"`);
  const title = (h.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
  const isHome = rel.replaceAll("\\", "/") === "/index.html";
  check(isHome ? title.startsWith("scoup.ai \u2013 ") : title.endsWith(" \u2013 scoup.ai"), `${rel}: title pattern (${title})`);
  check(h.includes('<meta property="og:site_name" content="scoup.ai">'), `${rel}: og:site_name scoup.ai`);
  check(h.includes(`<link rel="icon" href="${BASE}/favicon.svg" type="image/svg+xml">`), `${rel}: favicon link`);
  // The site is dark-only, so the header and footer always use the light-tile (on-dark) lockup.
  const logos = [...h.matchAll(new RegExp(`<a class="brand[^"]*" href="${B}/" aria-label="scoup\\.ai home"><img src="${B}/brand/lockup-horizontal-on-dark\\.svg" alt="scoup\\.ai" width="\\d+" height="(\\d+)"></a>`, "g"))];
  check(logos.length === 2, `${rel}: header + footer logo links with accessible names`);
  check(logos.every((m) => Number(m[1]) >= 20), `${rel}: lockup at least 20px tall`);
  // base path: every root-absolute link stays inside the site's prefix
  if (BASE) {
    const escaping = [...h.matchAll(/\b(?:href|src|srcset)="(\/[^"]*)"/g)].map((m) => m[1]).filter((u) => !(u === `${BASE}/` || u.startsWith(`${BASE}/`)));
    check(escaping.length === 0, `${rel}: links outside base path ${BASE}: ${escaping.slice(0, 3).join(", ")}`);
  }
  for (const ld of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const org = JSON.parse(ld[1])["@graph"].find((n) => n["@type"] === "Organization");
    check(org && org.name === "scoup.ai", `${rel}: JSON-LD Organization name`);
  }
}
for (const f of ["sitemap.xml", "robots.txt", "_headers", "style.css", "404.html", "favicon.svg", "og-card.png", "brand/lockup-horizontal.svg", "brand/lockup-horizontal-on-dark.svg"]) check(existsSync(join(dist, f)), `${f} exists`);
const css = readFileSync(join(dist, "style.css"), "utf8");
check(!/\.brand[^{]*\{[^}]*text-transform/.test(css), "brand never uppercased via CSS");
check(/@media[^{}]*max-width/.test(css), "mobile breakpoint exists");
check(/nav\s*\{[^}]*flex-wrap:\s*wrap/s.test(css), "navigation wraps at narrow widths");
check(/\.source\s*\{[^}]*overflow-wrap:\s*anywhere/s.test(css), "long source text can wrap");
check(/\.scroll\s*\{\s*overflow-x:\s*auto/s.test(css), "wide tables scroll within their container");
const csp = readFileSync(join(dist, "_headers"), "utf8");
check(/img-src 'self'/.test(csp), "CSP allows self-hosted logo images");
const sitemap = readFileSync(join(dist, "sitemap.xml"), "utf8");
check(!sitemap.includes("404"), "sitemap excludes 404");
for (const d of ["/privacy/", "/terms/", "/cookies/", "/pricing/", "/platform/"]) check(sitemap.includes(`${d}</loc>`), `sitemap lists ${d}`);
// lastmod: only from the page's own date (mirrored as WebPage dateModified), never one build date for all
for (const m of sitemap.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)) {
  const path = new URL(m[1]).pathname.slice(BASE.length);
  const file = join(dist, path, "index.html");
  check(existsSync(file), `sitemap entry ${path} has a page`);
  if (!existsSync(file)) continue;
  const ld = (readFileSync(file, "utf8").match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1];
  const page = ld && JSON.parse(ld)["@graph"].find((n) => n["@type"] === "WebPage");
  check(page && page.dateModified === m[2], `sitemap lastmod for ${path} (${m[2]}) must equal the page's dateModified (${page && page.dateModified})`);
}
check((sitemap.match(/<url>/g) || []).length >= 5, "sitemap lists the indexable pages");
const home = readFileSync(join(dist, "index.html"), "utf8");
check(home.includes("FAQPage") && home.includes("<details>"), "FAQPage only with visible FAQ");
// Launch positioning (2026-10-19): the product is the browser app. The home page carries the
// SoftwareApplication schema (free, browser-based) and leads with the in-browser promise; no other page does.
check(home.includes('"@type":"SoftwareApplication"') && home.includes('"price":"0"'), "home: SoftwareApplication schema for the free browser app");
for (const p of pages) if (p !== join(dist, "index.html")) check(!readFileSync(p, "utf8").includes("SoftwareApplication"), `${p.slice(dist.length)}: SoftwareApplication only on home`);
const h1 = (home.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || "";
check(h1.startsWith("Check freight invoices in your browser"), `home: in-browser hero line (${h1})`);
check(home.includes(`<a class="cta" href="${BASE}/app/">Open the app</a>`), "home: primary call to action opens the app");
check(home.includes("nothing you enter is uploaded"), "home: states that nothing is uploaded");
for (const p of pages) {
  const h = readFileSync(p, "utf8");
  check(!/pre-product|design partner|design-partner|free 90-day|30-day window closes/i.test(h.replace(/<script[\s\S]*?<\/script>/g, "")), `${p.slice(dist.length)}: launch copy must not carry pre-launch wording`);
  check(h.includes(`<a class="cta nav-cta" href="${BASE}/app/">Open the app</a>`), `${p.slice(dist.length)}: header link to the app`);
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log(`ok: ${pages.length} pages passed`);
