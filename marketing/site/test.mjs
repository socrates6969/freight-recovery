// Post-build checks: SEO basics, honesty guards, security guards. Run: npm test
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "dist");
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
for (const p of pages) {
  const h = readFileSync(p, "utf8");
  const rel = p.slice(dist.length);
  check(/<title>[^<]{5,}<\/title>/.test(h), `${rel}: title`);
  check(/<meta name="description" content="[^"]{20,}"/.test(h), `${rel}: description`);
  check(/<link rel="canonical" href="https?:\/\//.test(h), `${rel}: canonical`);
  check((h.match(/<h1[ >]/g) || []).length === 1, `${rel}: exactly one h1`);
  check(/property="og:title"/.test(h) && /name="twitter:card"/.test(h), `${rel}: og/twitter`);
  check(/Content-Security-Policy/.test(h), `${rel}: CSP meta`);
  // security: only the JSON-LD script; no inline handlers; no third-party URLs in src/href attrs
  const scripts = [...h.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  check(scripts.every((a) => a.includes("application/ld+json")), `${rel}: only JSON-LD scripts`);
  check(!/\son[a-z]+\s*=/i.test(h.replace(/<script[\s\S]*?<\/script>/g, "")), `${rel}: no inline handlers`);
  check(!/(?:src|href)="https?:\/\/(?!example\.invalid|[^"]*\/sitemap)/.test(h.replace(/<link rel="canonical"[^>]*>/, "")), `${rel}: no external resources`);
  // honesty: banned claims
  const text = h.replace(/<script[\s\S]*?<\/script>/g, "").toLowerCase();
  for (const bad of ["soc 2", "gdpr compliant", "iso 27001", "testimonial", "trusted by", "% savings", "ai-powered"]) {
    check(!text.includes(bad), `${rel}: banned phrase "${bad}"`);
  }
  if (/\/(privacy|terms|cookies)\//.test(rel)) check(h.includes("licensed Norwegian advokat"), `${rel}: advokat review flag`);
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
}
for (const f of ["sitemap.xml", "robots.txt", "_headers", "style.css", "404.html"]) check(existsSync(join(dist, f)), `${f} exists`);
check(!readFileSync(join(dist, "sitemap.xml"), "utf8").includes("404"), "sitemap excludes 404");
const home = readFileSync(join(dist, "index.html"), "utf8");
check(home.includes("FAQPage") && home.includes("<details>"), "FAQPage only with visible FAQ");
check(!home.includes("SoftwareApplication"), "no SoftwareApplication schema (nothing usable yet)");

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log(`ok: ${pages.length} pages passed`);
