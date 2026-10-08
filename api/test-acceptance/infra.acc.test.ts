/* eslint-disable */
// T-INFRA-01/02: Terraform skeleton (command + static assertions)
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, have, hclBlocks, read, rel, sh, walk } from './helpers/sh.js';

const tf = () => walk(resolve(REPO, 'infra'), (p) => p.endsWith('.tf')).map((p) => ({ file: rel(p), src: readFileSync(p, 'utf8') }));
const stripComments = (s: string) => s.replace(/^\s*(#|\/\/).*$/gm, '');
const allBlocks = () => tf().flatMap((f) => hclBlocks(stripComments(f.src)).map((b) => ({ ...b, file: f.file })));
const res = (type: string) => allBlocks().filter((b) => b.kind === 'resource' && b.labels[0] === type);
const attr = (body: string, name: string) => new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, 'm').exec(body)?.[1];

describe('T-INFRA-01 terraform tooling', () => {
  it('fmt -check, init -backend=false, validate', (ctx) => {
    if (!have('terraform')) return ctx.skip('terraform not installed');
    expect(sh('terraform -chdir=infra fmt -check -recursive').status).toBe(0);
    const init = sh('terraform -chdir=infra init -backend=false -input=false', { timeout: 600000 });
    expect(init.status, init.out.slice(-2000)).toBe(0);
    const val = sh('terraform -chdir=infra validate', { timeout: 300000 });
    expect(val.status, val.out.slice(-2000)).toBe(0);
  }, 900000);
});

describe('T-INFRA-02 static assertions over infra/**/*.tf', () => {
  it('infra exists', () => {
    expect(tf().length).toBeGreaterThan(0);
  });
  it('RDS: encrypted, private, deletion-protected, KMS, backups >= 7 days', () => {
    const dbs = res('aws_db_instance');
    expect(dbs.length).toBeGreaterThan(0);
    for (const d of dbs) {
      expect(attr(d.body, 'storage_encrypted'), 'storage_encrypted').toBe('true');
      expect(attr(d.body, 'publicly_accessible'), 'publicly_accessible').toBe('false');
      expect(attr(d.body, 'deletion_protection'), 'deletion_protection').toBe('true');
      expect(attr(d.body, 'kms_key_id'), 'kms_key_id').toBeTruthy();
      let ret = attr(d.body, 'backup_retention_period') ?? '';
      const vm = /^var\.(\w+)$/.exec(ret);
      if (vm) {
        const vb = allBlocks().find((b) => b.kind === 'variable' && b.labels[0] === vm[1]);
        const def = vb ? attr(vb.body, 'default') : undefined;
        const floor = vb ? /condition\s*=\s*var\.\w+\s*>=\s*(\d+)/.exec(vb.body)?.[1] : undefined;
        ret = def ?? floor ?? '';
        if (def && floor) ret = String(Math.min(Number(def), Number(def)));
        else if (!def && floor) ret = floor; // enforced floor via validation
      }
      expect(Number(ret), 'backup retention (days)').toBeGreaterThanOrEqual(7);
    }
    expect(res('aws_kms_key').length).toBeGreaterThan(0);
  });
  it('S3: public-access-block (4 flags), encryption, documents versioning, TLS-only deny', () => {
    const buckets = res('aws_s3_bucket');
    const pab = res('aws_s3_bucket_public_access_block');
    expect(buckets.length).toBeGreaterThan(0);
    expect(pab.length).toBeGreaterThanOrEqual(buckets.length);
    for (const p of pab) for (const f of ['block_public_acls', 'block_public_policy', 'ignore_public_acls', 'restrict_public_buckets']) expect(attr(p.body, f), `${f}`).toBe('true');
    expect(res('aws_s3_bucket_server_side_encryption_configuration').length).toBeGreaterThanOrEqual(buckets.length);
    const sse = res('aws_s3_bucket_server_side_encryption_configuration').map((s) => s.body).join('\n');
    expect(sse).toMatch(/aws:kms|AES256/);
    expect(res('aws_s3_bucket_versioning').some((v) => /status\s*=\s*"Enabled"/.test(v.body))).toBe(true);
    const policies = tf().map((f) => f.src).join('\n');
    expect(policies).toMatch(/aws:SecureTransport/);
    expect(res('aws_s3_bucket_policy').length).toBeGreaterThanOrEqual(1);
  });
  it('network: no world-open ingress except 443/80; never 5432/6379', () => {
    const open = '0.0.0.0/0';
    for (const sg of res('aws_security_group')) {
      for (const ing of [...sg.body.matchAll(/ingress\s*\{([\s\S]*?)\n\s*\}/g)]) {
        if (!ing[1]!.includes(open)) continue;
        const from = Number(attr(ing[1]!, 'from_port'));
        const to = Number(attr(ing[1]!, 'to_port'));
        expect([80, 443], `${sg.labels[1]} world ingress on ${from}-${to}`).toContain(from);
        expect(to).toBe(from);
      }
    }
    for (const t of ['aws_vpc_security_group_ingress_rule', 'aws_security_group_rule']) {
      for (const r of res(t)) {
        if (t === 'aws_security_group_rule' && !/type\s*=\s*"ingress"/.test(r.body)) continue;
        if (!r.body.includes(open)) continue;
        expect([80, 443], `${r.labels[1]} world ingress`).toContain(Number(attr(r.body, 'from_port')));
      }
    }
    for (const f of tf()) for (const port of ['5432', '6379']) expect(new RegExp(`${port}[\\s\\S]{0,200}0\\.0\\.0\\.0/0|0\\.0\\.0\\.0/0[\\s\\S]{0,200}${port}`).test(stripComments(f.src)) && /ingress/.test(f.src), `${f.file}: ${port} open to world`).toBe(false);
  });
  it('ElastiCache encrypted in transit and at rest', () => {
    const rg = res('aws_elasticache_replication_group');
    expect(rg.length).toBeGreaterThan(0);
    for (const r of rg) {
      expect(attr(r.body, 'transit_encryption_enabled')).toBe('true');
      expect(attr(r.body, 'at_rest_encryption_enabled')).toBe('true');
    }
  });
  it('no secret material, account ids, keys or literal passwords; no provisioners; IAM wildcards justified', () => {
    for (const f of tf()) {
      const s = stripComments(f.src);
      const literalSecretResources = hclBlocks(s).filter((b) => b.kind === 'resource' && b.labels[0] === 'aws_secretsmanager_secret_version' && /secret_string|secret_binary/.test(b.body));
      expect(literalSecretResources.length, `${f.file}: secret values in Terraform`).toBe(0);
      expect(/AKIA[0-9A-Z]{16}/.test(f.src)).toBe(false);
      expect(/\b(?!0{12}\b)\d{12}\b/.test(s.replace(/"[^"]*\$\{[^"]*"/g, '')), `${f.file}: hard-coded 12-digit account id?`).toBe(false);
      for (const m of s.matchAll(/^\s*(?:master_)?password\s*=\s*"([^"$]+)"/gm)) throw new Error(`${f.file}: literal password ${m[0].trim().slice(0, 30)}`);
      expect(/local-exec|remote-exec/.test(s), `${f.file}: provisioner`).toBe(false);
      const lines = f.src.split('\n');
      lines.forEach((l, i) => {
        if (/^\s*(resources?|Resource)\s*=\s*(\[\s*)?"\*"/i.test(l) || /"Resource"\s*:\s*"\*"/.test(l)) {
          const ok = /#|\/\//.test(l) || /^\s*(#|\/\/)/.test(lines[i - 1] ?? '');
          expect(ok, `${f.file}:${i + 1} wildcard IAM Resource needs a justification comment`).toBe(true);
        }
      });
    }
  });
  it('ECS hardened; ALB HTTPS+redirect; WAF associated; CloudFront headers mirror web/security-headers.json; constrained versions', () => {
    const all = tf().map((f) => f.src).join('\n');
    const clean = stripComments(all);
    expect(res('aws_ecs_task_definition').length).toBeGreaterThan(0);
    expect(clean).toMatch(/readonlyRootFilesystem\s*=\s*true|"readonlyRootFilesystem"\s*:\s*true/);
    expect(clean).toMatch(/\buser\s*=\s*"(?!root"|0")[^"]+"|"user"\s*:\s*"(?!root"|0")[^"]+"/);
    const listeners = res('aws_lb_listener');
    expect(listeners.some((l) => /port\s*=\s*443/.test(l.body) && /protocol\s*=\s*"HTTPS"/.test(l.body) && /ssl_policy\s*=\s*"[^"]*(TLS13|TLS-1-2|FS-1-2)[^"]*"/.test(l.body))).toBe(true);
    expect(listeners.some((l) => /port\s*=\s*80/.test(l.body) && /type\s*=\s*"redirect"/.test(l.body))).toBe(true);
    expect(res('aws_wafv2_web_acl').length).toBeGreaterThan(0);
    expect(res('aws_wafv2_web_acl_association').length).toBeGreaterThan(0);
    const web = JSON.parse(read('web/security-headers.json')).headers as Record<string, string>;
    const csp = web['Content-Security-Policy'];
    expect(csp).toBeTruthy();
    expect(res('aws_cloudfront_response_headers_policy').length).toBeGreaterThan(0);
    const fromFile = /security-headers\.json/.test(all);
    if (!fromFile) {
      expect(all.includes(csp!), 'CloudFront CSP must equal web/security-headers.json').toBe(true);
      const maxAge = /access_control_max_age_sec|strict_transport_security[\s\S]{0,200}?max_age_sec\w*\s*=\s*(\d+)/.exec(all);
      expect(Number(maxAge?.[1] ?? 0)).toBeGreaterThanOrEqual(31536000);
    }
    expect(clean).toMatch(/required_version\s*=\s*"[^"]*\d/);
    expect(clean).toMatch(/required_providers[\s\S]*?version\s*=\s*"[^"]*\d/);
    expect(existsSync(resolve(REPO, 'infra'))).toBe(true);
  });
});