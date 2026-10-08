#!/usr/bin/env node
// Post-build guard (B5): fails the build if the production output violates the CSP invariants.
//  - every HTML file: no inline <script> (scripts must have src), no <style>, no on*= handlers,
//    no style= attributes, no <meta http-equiv=refresh>, lang + title + robots noindex present;
//  - CSS/JS assets: no data: URLs in CSS (font-src/img-src are 'self' only), no sourcemaps.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

export function checkHtml(html) {
  const problems = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)) {
    if (!/\bsrc\s*=/iu.test(m[1] ?? '')) problems.push('inline <script> without src');
    if ((m[2] ?? '').trim().length > 0) problems.push('<script> with inline content');
  }
  if (/<style\b/iu.test(html)) problems.push('inline <style>');
  if (/\son[a-z]+\s*=/iu.test(html)) problems.push('inline event handler attribute');
  if (/\sstyle\s*=/iu.test(html)) problems.push('style attribute');
  if (/<meta[^>]+http-equiv\s*=\s*["']?refresh/iu.test(html)) problems.push('meta refresh');
  if (/javascript:/iu.test(html)) problems.push('javascript: URL');
  if (!/<html[^>]*\blang="en"/iu.test(html)) problems.push('missing lang="en"');
  if (!/<title>[^<]{3,}<\/title>/iu.test(html)) problems.push('missing title');
  if (!/<meta\s+name="robots"\s+content="noindex"/iu.test(html)) problems.push('missing robots noindex');
  return problems;
}

export function checkCss(css) {
  return /url\(\s*["']?data:/iu.test(css) ? ['data: URL in CSS'] : [];
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function main() {
  const files = walk(dist);
  const problems = [];
  for (const f of files) {
    const rel = path.relative(dist, f);
    if (f.endsWith('.html')) for (const p of checkHtml(readFileSync(f, 'utf8'))) problems.push(`${rel}: ${p}`);
    if (f.endsWith('.css')) for (const p of checkCss(readFileSync(f, 'utf8'))) problems.push(`${rel}: ${p}`);
    if (f.endsWith('.map')) problems.push(`${rel}: sourcemap shipped`);
  }
  if (!files.some((f) => f.endsWith('index.html'))) problems.push('dist/index.html missing');
  if (problems.length > 0) {
    console.error('check-dist failed:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`check-dist: OK (${files.length} files)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
