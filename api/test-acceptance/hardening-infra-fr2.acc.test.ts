/* eslint-disable */
// REQ-20261012-hardening fix round 2, Tier L (file checks only): C-FR2.3 (H-2, H-3) Terraform policy over infra/*.tf
// and infra/README.md. Terraform is never applied; `terraform fmt -check` / `validate` stay in HP-C07
// (hardening-static.acc.test.ts, declared skip when the binary is absent). Assertions are on observable file content only.
// FR2-I01 (a) at least one ALB listener rule matches on the x-origin-verify header.
// FR2-I02 (a) no committed origin-verify value is accepted: every x-origin-verify rule either forwards only on a generated
//   value (values reference random_password, no string literal, also through locals) or answers a fixed 403.
// FR2-I03 (a) a referenced random_password is declared, and the random provider is pinned in required_providers.
// FR2-I04 (a) infra/README.md deploy-gate section: a request with the placeholder value gets 403.
// FR2-I05 (b) the CloudFront distribution does not ignore the whole origin (nor `all`) unless a check {} block asserts
//   the origin domain names and the origin protocol policy; without the ignore, the x-origin-verify origin header is not
//   a committed literal (managed from the secret / generated value).
// FR2-I06 (c) the api origin's behaviours use either the AWS managed policy Managed-AllViewerExceptHostHeader, or the
//   custom policy (forwarding CloudFront-Viewer-Address) plus a host_header = [var.app_domain] condition on the
//   x-origin-verify rule and a certificate precondition; the choice is documented in infra/README.md.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** FR2_INFRA_DIR: test self-check only (run the checks against a scratch copy of infra/); CI never sets it. */
const INFRA = process.env.FR2_INFRA_DIR || resolve(__dirname, '..', '..', 'infra');
/** All .tf text with full-line comments removed (comments may mention placeholders or names without being config). */
const tfText = () => readdirSync(INFRA).filter((f) => f.endsWith('.tf')).map((f) => readFileSync(join(INFRA, f), 'utf8').replace(/\r\n/g, '\n'))
  .join('\n').split('\n').filter((l) => !/^\s*(#|\/\/)/.test(l)).join('\n');
const readme = () => readFileSync(join(INFRA, 'README.md'), 'utf8').replace(/\r\n/g, '\n');

/** Brace-matched body of every match of `head` (a regex ending in `{`); group 1 is the block label when present. */
function blocksOf(text: string, head: RegExp): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = new RegExp(head.source, 'g');
  for (const m of text.matchAll(re)) {
    let depth = 1;
    let i = (m.index ?? 0) + m[0].length;
    for (; i < text.length && depth > 0; i++) depth += text[i] === '{' ? 1 : text[i] === '}' ? -1 : 0;
    out.push({ name: m[1] ?? '', body: text.slice(m.index, i) });
  }
  return out;
}
const resources = (t: string, type: string) => blocksOf(t, new RegExp(`resource\\s+"${type}"\\s+"([\\w-]+)"\\s*\\{`));
const datas = (t: string, type: string) => blocksOf(t, new RegExp(`data\\s+"${type}"\\s+"([\\w-]+)"\\s*\\{`));
const inner = (body: string, kw: string) => blocksOf(body, new RegExp(`\\b${kw}\\s*\\{`));

/** `local.NAME` definitions (single-line expressions in any locals block). */
function localsMap(t: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const b of blocksOf(t, /\blocals\s*\{/)) for (const x of b.body.matchAll(/^\s*([A-Za-z_][\w-]*)\s*=\s*(.+)$/gm)) m.set(x[1]!, x[2]!.trim());
  return m;
}
/** Replace local.NAME references by their definitions (bounded depth). */
function resolveLocals(expr: string, L: Map<string, string>): string {
  let e = expr;
  for (let d = 0; d < 5; d++) e = e.replace(/\blocal\.([A-Za-z_][\w-]*)/g, (all, n: string) => (L.has(n) ? `(${L.get(n)})` : all));
  return e;
}
/** Quoted strings that carry literal text (a string that is only `${...}` interpolation is a reference, not a literal). */
const literals = (expr: string) => [...expr.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]!).filter((s) => s.replace(/\$\{[^}]*\}/g, '').length > 0);
/** The `values = [...]` expression of the http_header block named x-origin-verify in a listener-rule body. */
function verifyValues(rule: string): string | null {
  for (const h of inner(rule, 'http_header')) {
    if (!/http_header_name\s*=\s*"x-origin-verify"/i.test(h.body)) continue;
    const v = /values\s*=\s*(\[[\s\S]*?\])/.exec(h.body);
    return v ? v[1]! : '';
  }
  return null;
}
const verifyRules = (t: string) => resources(t, 'aws_lb_listener_rule').filter((r) => verifyValues(r.body) !== null);
const isForward = (rule: string) => inner(rule, 'action').some((a) => /type\s*=\s*"forward"/.test(a.body) || /\bforward\s*\{/.test(a.body));
const isFixed403 = (rule: string) => {
  const acts = inner(rule, 'action');
  return acts.length > 0 && acts.every((a) => /type\s*=\s*"fixed-response"/.test(a.body) && /status_code\s*=\s*"?403"?/.test(a.body));
};
/** README section that starts at the `## Deploy gate` heading and ends before the next `## ` heading. */
function deployGate(): string {
  const r = readme();
  const i = r.search(/^## Deploy gate/m);
  expect(i, 'infra/README.md has a "## Deploy gate" section').toBeGreaterThanOrEqual(0);
  const rest = r.slice(i + 3);
  const j = rest.search(/^## /m);
  return j < 0 ? rest : rest.slice(0, j);
}
/** The CloudFront x-origin-verify origin custom_header value expression of the distribution. */
function originHeaderValue(dist: string): string | null {
  for (const h of inner(dist, 'custom_header')) {
    if (!/name\s*=\s*"x-origin-verify"/i.test(h.body)) continue;
    return /value\s*=\s*(.+)$/m.exec(h.body)?.[1]?.trim() ?? '';
  }
  return null;
}

describe('C-FR2.3 (a) origin verification never accepts a committed value', () => {
  it('FR2-I01 at least one listener rule matches on the x-origin-verify header', () => {
    expect(verifyRules(tfText()).length).toBeGreaterThanOrEqual(1);
  });
  it('FR2-I02 every x-origin-verify rule forwards only on a generated value (random_password, no literal) or answers a fixed 403', () => {
    const t = tfText();
    const L = localsMap(t);
    for (const r of verifyRules(t)) {
      const vals = resolveLocals(verifyValues(r.body)!, L);
      if (isForward(r.body)) {
        expect(literals(vals), `${r.name}: forwards on a committed literal value ${vals}`).toEqual([]);
        expect(vals, `${r.name}: forwarded value must be generated (random_password)`).toMatch(/\brandom_password\.[\w-]+\.result\b/);
      } else {
        expect(isFixed403(r.body), `${r.name}: a rule that does not forward must answer a fixed 403`).toBe(true);
      }
    }
    // nothing else forwards on a placeholder: no listener (default action) forwards to the API target group
    for (const l of resources(t, 'aws_lb_listener').filter((x) => /certificate_arn\s*=|ssl_policy\s*=/.test(x.body))) {
      expect(inner(l.body, 'default_action').some((a) => /type\s*=\s*"forward"/.test(a.body)), `${l.name}: HTTPS default action must not forward`).toBe(false);
    }
  });
  it('FR2-I03 a referenced random_password is declared and the random provider is pinned', () => {
    const t = tfText();
    const refs = [...t.matchAll(/\brandom_password\.([\w-]+)\b/g)].map((m) => m[1]!);
    if (refs.length === 0) return; // the fixed-403 variant of FR2-I02 needs no generated value
    const declared = resources(t, 'random_password').map((b) => b.name);
    for (const n of refs) expect(declared, `random_password.${n} declared`).toContain(n);
    const rp = blocksOf(t, /required_providers\s*\{/).map((b) => b.body).join('\n');
    expect(rp, 'required_providers declares random = { source = "hashicorp/random", version = ... }').toMatch(/random\s*=\s*\{[^}]*source\s*=\s*"hashicorp\/random"[^}]*\}/);
    expect(rp).toMatch(/random\s*=\s*\{[^}]*version\s*=\s*"[^"]+"[^}]*\}/);
  });
  it('FR2-I04 infra/README.md deploy-gate check includes "a request with a placeholder value gets 403"', () => {
    expect(deployGate()).toMatch(/placeholder[^.]{0,200}\b403\b/i);
  });
});

describe('C-FR2.3 (b) CloudFront origin drift is not hidden', () => {
  it('FR2-I05 no whole-origin ignore_changes (nor all) unless a check {} block asserts origin domains and protocol policy', () => {
    const t = tfText();
    const L = localsMap(t);
    const dists = resources(t, 'aws_cloudfront_distribution');
    expect(dists.length).toBeGreaterThanOrEqual(1);
    for (const d of dists) {
      const igns = inner(d.body, 'lifecycle').map((l) => /ignore_changes\s*=\s*(\[[\s\S]*?\]|all\b)/.exec(l.body)?.[1] ?? '');
      expect(igns, `${d.name}: ignore_changes = all hides every drift`).not.toContain('all');
      const ign = igns.join(' ');
      // `origin` as a whole attribute (not a nested path such as origin[0].custom_header)
      const wholeOrigin = /(^|[\[,\s])origin\s*(?=[,\]\s])/.test(ign);
      if (wholeOrigin) {
        const checks = blocksOf(t, /\bcheck\s+"([\w-]+)"\s*\{/).filter((c) => /\bassert\s*\{/.test(c.body) && /aws_cloudfront_distribution/.test(c.body));
        expect(checks.length, `${d.name}: whole-origin ignore needs a check {} block over the distribution`).toBeGreaterThanOrEqual(1);
        const body = checks.map((c) => c.body).join('\n');
        expect(body, 'check asserts the origin domain names').toMatch(/domain_name/);
        expect(body, 'check asserts the origin protocol policy').toMatch(/origin_protocol_policy/);
      } else {
        const v = originHeaderValue(d.body);
        expect(v, `${d.name}: api origin keeps the x-origin-verify header`).not.toBeNull();
        expect(literals(resolveLocals(v!, L)), `${d.name}: without the ignore, the origin header must be managed from the secret/generated value, not a literal`).toEqual([]);
      }
    }
  });
});

describe('C-FR2.3 (c) origin request policy choice', () => {
  it('FR2-I06 managed AllViewerExceptHostHeader, or custom policy + host_header [var.app_domain] + certificate precondition; documented in the README', () => {
    const t = tfText();
    const dist = resources(t, 'aws_cloudfront_distribution').map((d) => d.body).join('\n');
    const api = inner(dist, 'ordered_cache_behavior').filter((b) => /target_origin_id\s*=\s*"api"/.test(b.body));
    expect(api.length, 'behaviours to the api origin').toBeGreaterThanOrEqual(1);
    const ids = api.map((b) => /origin_request_policy_id\s*=\s*(.+)$/m.exec(b.body)?.[1]?.trim() ?? '');
    const managed = datas(t, 'aws_cloudfront_origin_request_policy').filter((x) => /name\s*=\s*"Managed-AllViewerExceptHostHeader"/.test(x.body)).map((x) => x.name);
    const custom = resources(t, 'aws_cloudfront_origin_request_policy').filter((x) => /CloudFront-Viewer-Address/.test(x.body)).map((x) => x.name);
    const usesManaged = ids.every((e) => managed.some((n) => e === `data.aws_cloudfront_origin_request_policy.${n}.id`));
    const usesCustom = ids.every((e) => custom.some((n) => e === `aws_cloudfront_origin_request_policy.${n}.id`));
    expect(usesManaged || usesCustom, `api behaviours use one documented policy: ${JSON.stringify(ids)}`).toBe(true);
    const doc = readme();
    if (usesManaged) {
      expect(doc, 'README records the managed-policy choice').toMatch(/AllViewerExceptHostHeader/);
    } else {
      for (const r of verifyRules(t).filter((x) => isForward(x.body))) {
        const hh = inner(r.body, 'host_header');
        expect(hh.some((h) => /values\s*=\s*\[\s*var\.app_domain\s*\]/.test(h.body)), `${r.name}: host_header condition values = [var.app_domain]`).toBe(true);
      }
      const pre = blocksOf(t, /\bprecondition\s*\{/).filter((p) => /certificate/i.test(p.body));
      expect(pre.length, 'a certificate precondition').toBeGreaterThanOrEqual(1);
      expect(doc, 'README records the custom-policy + Host condition choice').toMatch(/host[_ -]header|Host header/i);
    }
  });
});
