/** Canonical per-run output of the extraction stage and its SHA-256 digest (Q7). */
import { createHash } from 'node:crypto';

export type FieldTriple = [key: string, groupIndex: number | null, value: string | null];
export type RunOutput = { rejected: string } | { docType: string; fields: FieldTriple[] };

function cmp(a: FieldTriple, b: FieldTriple): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  const ga = a[1] ?? -1;
  const gb = b[1] ?? -1;
  if (ga !== gb) return ga - gb;
  const va = a[2] ?? '';
  const vb = b[2] ?? '';
  if (a[2] === null && b[2] !== null) return -1;
  if (b[2] === null && a[2] !== null) return 1;
  return va < vb ? -1 : va > vb ? 1 : 0;
}

export function sortFields(fields: readonly FieldTriple[]): FieldTriple[] {
  return [...fields].sort(cmp);
}

/** Stable JSON: fixed key order, fields sorted by (key, groupIndex, value). */
export function canonicalOutput(o: RunOutput): string {
  if ('rejected' in o) return JSON.stringify({ rejected: o.rejected });
  return JSON.stringify({ docType: o.docType, fields: sortFields(o.fields) });
}

export function digest(o: RunOutput): string {
  return createHash('sha256').update(canonicalOutput(o), 'utf8').digest('hex');
}
