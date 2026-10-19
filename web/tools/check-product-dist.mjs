#!/usr/bin/env node
// Post-build guard of the public app bundle (dist-product): the same CSP invariants as check-dist.mjs
// (no inline script/style, no on*= handlers, no style attributes, no data: URLs in CSS, no sourcemaps),
// plus: the page carries its own meta CSP and is indexable (it is the product, not an internal console).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkCss } from './check-dist.mjs';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-product');

export function checkProductHtml(html) {
  const problems = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)) {
    if (!/\bsrc\s*=/iu.test(m[1] ?? '')) problems.push('inline <script> without src');
    if ((m[2] ?? '').trim().length > 0) problems.push('<script> with inline content');
  }
  if (/<style\b/iu.test(html)) problems.push('inline <style>');
  if (/\son[a-z]+\s*=/iu.test(html)) problems.push('inline event handler attribute');
  if (/\sstyle\s*=/iu.test(html)) problems.push('style attribute');
  if (/javascript:/iu.test(html)) problems.push('javascript: URL');
  if (!/<html[^>]*\blang="en"/iu.test(html)) problems.push('missing lang="en"');
  if (!/<title>[^<]{3,}<\/title>/iu.test(html)) problems.push('missing title');
  if (!/<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'/iu.test(html)) problems.push('missing meta CSP');
  if (!/<meta name="robots" content="index, follow"/iu.test(html)) problems.push('app page must be indexable');
  if (/%VITE_|%BASE_URL%|example\.invalid/u.test(html)) problems.push('unreplaced placeholder');
  if (!/<link rel="canonical" href="https:\/\/[^"]+\/app\/" ?\/?>/u.test(html)) problems.push('missing canonical');
  return problems;
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
    if (f.endsWith('.html')) for (const p of checkProductHtml(readFileSync(f, 'utf8'))) problems.push(`${rel}: ${p}`);
    if (f.endsWith('.css')) for (const p of checkCss(readFileSync(f, 'utf8'))) problems.push(`${rel}: ${p}`);
    if (f.endsWith('.map')) problems.push(`${rel}: sourcemap shipped`);
  }
  if (!files.some((f) => path.basename(f) === 'index.html')) problems.push('dist-product/index.html missing');
  if (!files.some((f) => /^favicon.*\.svg$/u.test(path.basename(f)))) problems.push('favicon missing');
  if (problems.length > 0) {
    console.error('check-product-dist failed:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`check-product-dist: OK (${files.length} files)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();