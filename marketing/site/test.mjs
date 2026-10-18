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

let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.error("FAIL:", msg); } };

check(pages.length >= 9, "expected >= 9 pages");
let iconCount = 0;
for (const p of pages) {
  const h = readFileSync(p, "utf8");
  const rel = p.slice(dist.length);
  check(/<title>[^<]{5,}<\/title>/.test(h), `${rel}: title`);
  check(/<meta name="description" content="[^"]{20,}"/.test(h), `${rel}: description`);
  // The 404 page declares no URL of its own (technical-checklist T10); every other page has an absolute canonical.
  const is404 = rel.endsWith("404.html");
  if (is404) check(!h.includes('rel="canonical"') && !h.includes('property="og:url"'), `${rel}: 404 page must not carry a canonical or og:url`);
  else check(/<link rel="canonical" href="https?:\/\//.test(h), `${rel}: canonical`);
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
  for (const bad of ["soc 2", "gdpr compliant", "iso 27001", "testimonial", "trusted by", "% savings", "ai-powered",
    "recovered", "accurate", "seamless", "robust", "leverage", "saves "]) {
    check(!text.includes(bad), `${rel}: banned phrase "${bad}"`);
  }
  check(!/\bsecure\b/.test(text), `${rel}: "secure" used as a claim`);
  // honesty: rule effects and third-party figures always travel with their source and caveat
  if (text.includes("fmc") || text.includes("46 cfr")) {
    check(text.includes("confirm with counsel or your customs broker"), `${rel}: FMC rule described without the counsel/customs-broker note`);
    check(text.includes("thompsonhine.com"), `${rel}: FMC rule described without its source line`);
  }
  if (/\brxo\b/.test(text)) {
    check(text.includes("a freight broker") && text.includes("rxo.com/resources/research/freight-accessorials"), `${rel}: RXO survey quoted without broker label and source line`);
  }
  if (/\batri\b/.test(text)) check(text.includes("cost of waiting"), `${rel}: ATRI figure quoted without the cost-of-waiting caveat`);
  // security: meta CSP and referrer policy mirror static/_headers (minus frame-ancestors, which meta cannot carry)
  check(h.includes(`<meta http-equiv="Content-Security-Policy" content="${EXPECTED_META_CSP.replace(/&/g, "&amp;")}">`) && EXPECTED_META_CSP.includes("default-src 'none'"), `${rel}: meta CSP must equal the _headers CSP minus frame-ancestors`);
  check(h.includes(`<meta name="referrer" content="${headerValue("Referrer-Policy")}">`), `${rel}: meta referrer must equal _headers Referrer-Policy`);
  if (/[\\/](privacy|terms|cookies)[\\/]/.test(rel)) {
    check(h.includes("licensed Norwegian advokat"), `${rel}: advokat review flag`);
    check(h.includes('<meta name="robots" content="noindex'), `${rel}: draft legal page must be noindex`);
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
  const logos = [...h.matchAll(new RegExp(`<a class="brand[^"]*" href="${B}/" aria-label="scoup\\.ai home"><picture><source media="\\(prefers-color-scheme: dark\\)" srcset="${B}/brand/lockup-horizontal-on-dark\\.svg"><img src="${B}/brand/lockup-horizontal\\.svg" alt="scoup\\.ai" width="\\d+" height="(\\d+)"></picture></a>`, "g"))];
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
  check(!title.includes("(pre-product)"), `${rel}: "(pre-product)" in the title`);
  for (const ld of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    // T14/T6: status notes belong in the banner and descriptions, never in an entity or page name
    check(JSON.parse(ld[1])["@graph"].every((n) => !String(n.name || "").includes("(pre-product)")), `${rel}: "(pre-product)" in a JSON-LD name`);
  }
  // accessibility: skip link to the main landmark (technical-checklist T13)
  check(h.includes('<a class="skip" href="#main">Skip to content</a>') && h.includes('<main id="main">'), `${rel}: skip link to <main id="main">`);
  // CSP: no inline style attributes (style-src has no 'unsafe-inline'), so icons and markup must not use them
  check(!/<[a-z][^>]*\sstyle\s*=/i.test(h.replace(/<script[\s\S]*?<\/script>/g, "")), `${rel}: inline style attribute`);
  // icons: every <svg> is decorative (aria-hidden, no label of its own) or carries its own accessible name
  const svgs = [...h.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g)];
  iconCount += svgs.length;
  for (const [, attrs, inner] of svgs) {
    const hidden = /\saria-hidden="true"/.test(attrs);
    const named = /\saria-label="[^"]+"/.test(attrs) || (/\srole="img"/.test(attrs) && /<title>[^<]+<\/title>/.test(inner));
    check(hidden !== named, `${rel}: <svg> must be either aria-hidden or labelled (hidden=${hidden}, named=${named})`);
  }
  // every <svg> inside a link or button: a hidden icon needs visible label text in the same control
  const labelText = (inner) => inner.replace(/<svg\b[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "x").trim();
  for (const [, tag, attrs, inner] of h.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    if (!inner.includes("<svg")) continue;
    const ownName = /\saria-label="[^"]+"/.test(attrs);
    const iconsHidden = [...inner.matchAll(/<svg\b([^>]*)>/g)].every((m) => /\saria-hidden="true"/.test(m[1]));
    check(labelText(inner).length >= 2 || ownName, `${rel}: <${tag}> with an icon but no visible label or aria-label`);
    check(iconsHidden || ownName, `${rel}: <${tag}> has an icon that is neither hidden nor named by the control`);
  }
  // every navigation item and every call to action carries an icon next to a visible label
  for (const nav of h.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)) {
    for (const a of nav[1].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
      check(a[1].includes("<svg") && labelText(a[1]).length >= 2, `${rel}: nav item without icon and visible label: ${labelText(a[1]).slice(0, 40)}`);
    }
  }
  for (const a of h.matchAll(/<a class="cta[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    check(a[1].includes("<svg") && labelText(a[1]).length >= 2, `${rel}: call to action without icon and label: ${labelText(a[1]).slice(0, 40)}`);
  }
  // in-page navigation: every jump link targets an id on the same page
  for (const jump of h.matchAll(/<nav class="jump" aria-label="On this page">([\s\S]*?)<\/nav>/g)) {
    for (const t of jump[1].matchAll(/href="#([^"]+)"/g)) check(h.includes(`id="${t[1]}"`), `${rel}: in-page link #${t[1]} has no target`);
  }
}
for (const f of ["sitemap.xml", "robots.txt", "_headers", "style.css", "404.html", "favicon.svg", "og-card.png", "brand/lockup-horizontal.svg", "brand/lockup-horizontal-on-dark.svg"]) check(existsSync(join(dist, f)), `${f} exists`);
const css = readFileSync(join(dist, "style.css"), "utf8");
check(!/\.brand[^{]*\{[^}]*text-transform/.test(css), "brand never uppercased via CSS");
const csp = readFileSync(join(dist, "_headers"), "utf8");
check(/img-src 'self'/.test(csp), "CSP allows self-hosted logo images");
const sitemap = readFileSync(join(dist, "sitemap.xml"), "utf8");
check(!sitemap.includes("404"), "sitemap excludes 404");
for (const d of ["/privacy/", "/terms/", "/cookies/"]) check(!sitemap.includes(`${d}</loc>`), `sitemap excludes draft ${d}`);
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
check(!home.includes("SoftwareApplication"), "no SoftwareApplication schema (nothing usable yet)");
// positioning (marketing-plan.md section 2.3): shipper hero leads, importer line present, carriers later
const h1 = (home.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || "";
check(h1.startsWith("Take accessorial review off AP's desk.") && h1.includes("checked against the rate confirmation"), `home: shipper hero line (${h1})`);
check(home.includes("Check every D&amp;D invoice before the 30-day window closes") || home.includes("check every D&amp;D invoice before the 30-day window closes"), "home: importer line");
check(home.includes("Carriers, later and through partners"), "home: carriers only as a later, partner-led channel");

// audience entry points: each has its own indexable page with in-page navigation, linked from the home page's
// main nav and from the home page's audience list
const homeNav = (home.match(/<nav aria-label="Main">([\s\S]*?)<\/nav>/) || [])[1] || "";
const homeAudiences = (home.match(/<ul class="audiences">([\s\S]*?)<\/ul>/) || [])[1] || "";
for (const a of ["buyers", "developers", "investors"]) {
  const file = join(dist, a, "index.html");
  check(existsSync(file), `audience page /${a}/ exists`);
  if (!existsSync(file)) continue;
  const p = readFileSync(file, "utf8");
  check(homeNav.includes(`href="${BASE}/${a}/"`), `home: main nav links to /${a}/`);
  check(homeAudiences.includes(`href="${BASE}/${a}/"`), `home: audience entry point for /${a}/`);
  check(/<nav class="jump" aria-label="On this page">[\s\S]*?href="#/.test(p), `/${a}/: in-page navigation`);
  check(sitemap.includes(`/${a}/</loc>`), `/${a}/ is in the sitemap`);
  check(p.includes('<p class="draft">Status: pre-product'), `/${a}/: pre-product status note`);
}
const buyers = readFileSync(join(dist, "buyers", "index.html"), "utf8");
check(buyers.includes("Take accessorial review off AP") && buyers.includes("before the 30-day window closes"), "buyers: shipper and importer lines");
check(buyers.includes("Carriers: later, through partners"), "buyers: carriers only as a later, partner-led channel");
const dev = readFileSync(join(dist, "developers", "index.html"), "utf8");
check(dev.includes("fr_live_") && dev.includes("Bearer") && ["imports.write", "claims.read", "exports.claims"].every((x) => dev.includes(x)), "developers: key format, Bearer header and the three scopes");
check(dev.includes("Python reference service") && dev.includes("built but not hosted"), "developers: honest developer-portal status");
check(!/href="[^"]*developer-portal/.test(dev), "developers: no link to a developer portal that is not hosted");
// investor documents: sent on request only (owner decision, 2026-10-18; general-solicitation risk). The site must
// carry no PDF link and no /investors/pdf/ path anywhere, and the investors page must say the documents are on request.
const inv = readFileSync(join(dist, "investors", "index.html"), "utf8");
for (const p of pages) {
  const h = readFileSync(p, "utf8");
  const rel = p.slice(dist.length);
  check(!/(?:href|src)="[^"]*\.pdf(?:[?#][^"]*)?"/i.test(h), `${rel}: links to a PDF (investor documents are sent on request only)`);
  check(!h.includes("/investors/pdf"), `${rel}: mentions an /investors/pdf/ path`);
}
check(!existsSync(join(dist, "investors", "pdf")), "dist/investors/pdf/ must not exist (documents are not published)");
check(inv.includes('<h2 id="documents">Documents on request</h2>') && inv.includes("not published on this site"), "investors: 'Documents on request' section");
check(/<h2 id="documents">Documents on request<\/h2>[\s\S]*?<a class="cta" href="mailto:[^"]+">/.test(inv), "investors: contact call to action after the documents section");
check(!/\$\d[\d.,]*\s?M seed/i.test(inv) && !/raising/i.test(inv), "investors: no raise size on the public page");
// brand typeface: self-hosted Inter, relative URL (works under the base path), allowed by the CSP
check(existsSync(join(dist, "fonts", "inter-latin-wght-normal.woff2")) && existsSync(join(dist, "fonts", "OFL.txt")), "Inter font file and its licence are shipped");
check(/font-family:\s*"Inter Variable"/.test(css) && /font:[^;]*"Inter Variable"/.test(css), "CSS uses the brand typeface Inter");
check(!/url\(\s*["']?\//.test(css), "CSS url() values are relative, so they resolve under a base path");
check(/font-src 'self'/.test(csp), "CSP allows self-hosted fonts");
// contrast: every text/background pair in the stylesheet meets WCAG AA (4.5:1) in the light and the dark theme
const lum = (hex) => {
  let x = hex.slice(1);
  if (x.length === 3) x = [...x].map((c) => c + c).join("");
  const ch = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/gi)].map((m) => [m[1], m[2]]));
const light = tokens((css.match(/:root\s*\{([^}]*)\}/) || [])[1] || "");
const dark = { ...light, ...tokens((css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/) || [])[1] || "") };
// explicit pairs (text on each surface it sits on) plus every rule that sets a colour, against its own background or the page
const pairs = new Set(["fg/bg", "muted/bg", "accent/bg", "fg/surface", "muted/surface", "accent/surface", "on-accent/accent", "warn/warnbg"]);
for (const rule of css.replace(/@font-face\s*\{[^}]*\}/g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  if (rule[1].includes(":root")) continue;
  const fg = (rule[2].match(/(?:^|[;\s])color:\s*var\(--([a-z-]+)\)/) || [])[1];
  const bg = (rule[2].match(/background:\s*var\(--([a-z-]+)\)/) || [])[1];
  if (fg) pairs.add(`${fg}/${bg || "bg"}`);
  check(!/(?:^|[;\s])(?:color|background):\s*#/.test(rule[2]), `CSS rule "${rule[1].trim()}" uses a raw hex colour instead of a token`);
}
check(Object.keys(light).length >= 8 && Object.keys(dark).length >= 8, "contrast: colour tokens parsed for both themes");
for (const [name, theme] of [["light", light], ["dark", dark]]) {
  for (const pr of pairs) {
    const [f, b] = pr.split("/");
    check(Boolean(theme[f] && theme[b]), `contrast (${name}): --${f} or --${b} is not a hex token`);
    if (!theme[f] || !theme[b]) continue;
    const r = ratio(theme[f], theme[b]);
    check(r >= 4.5, `contrast (${name}): --${f} ${theme[f]} on --${b} ${theme[b]} is ${r.toFixed(2)}:1 (< 4.5:1)`);
  }
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log(`ok: ${pages.length} pages passed; ${iconCount} inline icons checked; ${pairs.size} text/background pairs >= 4.5:1 in both themes`);
