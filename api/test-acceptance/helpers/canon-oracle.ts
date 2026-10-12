// REQ-20261011-fuel-outlook fix round 1: test-owned canonical JSON (recursively key-sorted in code-unit order, no
// whitespace, arrays in order) and paramsSha256 = sha256 hex of its UTF-8 bytes (Part C F13). Independent of the
// product's canonicalJson.
import { createHash } from 'node:crypto';

export function oCanon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(oCanon).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${oCanon(o[k])}`).join(',')}}`;
}
export const oParamsSha = (p: unknown): string => createHash('sha256').update(oCanon(p), 'utf8').digest('hex');
