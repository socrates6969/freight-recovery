/**
 * Evaluation set manifest (Q7): strict schema plus path-traversal / symlink / size guards. Every case file
 * must resolve INSIDE the set directory, be a regular file (not a symlink) and be at most 5 MiB.
 */
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { IMPORT_DOC_TYPES, PARSE_REJECT_REASONS, PRESTORE_REJECT_REASONS } from '@fr/shared';
import { z } from 'zod';

export const MAX_CASE_BYTES = 5 * 1024 * 1024;

const REJECT_REASONS = [...new Set<string>([...PRESTORE_REJECT_REASONS, ...PARSE_REJECT_REASONS, 'parse_timeout', 'parse_memory', 'parse_failed'])] as [string, ...string[]];

const ExpectParsed = z.strictObject({
  outcome: z.literal('parsed'),
  docType: z.enum(IMPORT_DOC_TYPES),
  fields: z.array(z.strictObject({ key: z.string().min(1).max(64), groupIndex: z.int().min(0).nullable(), value: z.string().nullable() })),
});
const ExpectRejected = z.strictObject({ outcome: z.literal('rejected'), reason: z.enum(REJECT_REASONS) });

export const EvalCase = z.strictObject({
  id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/u),
  category: z.string().min(1).max(64),
  file: z.string().min(1).max(256),
  filename: z.string().min(1).max(255),
  expectedBasis: z.enum(['python_oracle', 'hand_authored']),
  expect: z.discriminatedUnion('outcome', [ExpectParsed, ExpectRejected]),
});
export type EvalCaseDef = z.infer<typeof EvalCase>;

export const Manifest = z.strictObject({
  evalSetId: z.string().min(1).max(64),
  version: z.string().min(1).max(32),
  stage: z.string().min(1).max(32),
  description: z.string().max(2000),
  cases: z.array(EvalCase).min(1).max(10000),
});
export type ManifestDef = z.infer<typeof Manifest>;

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

export interface LoadedSet {
  manifest: ManifestDef;
  manifestBytes: Buffer;
  files: Buffer[];
}

/** Resolve a case path inside `dir`; refuses absolute paths, `..` escapes and symlinks. */
export function resolveCaseFile(dir: string, rel: string): string {
  if (path.isAbsolute(rel) || rel.includes('\0')) throw new ManifestError(`case file must be relative: ${rel}`);
  const root = realpathSync(dir);
  const full = path.resolve(root, rel);
  const relToRoot = path.relative(root, full);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) throw new ManifestError(`case file escapes the set directory: ${rel}`);
  let st;
  try {
    st = lstatSync(full);
  } catch {
    throw new ManifestError(`case file missing: ${rel}`);
  }
  if (st.isSymbolicLink() || !st.isFile()) throw new ManifestError(`case file is not a regular file: ${rel}`);
  if (st.size > MAX_CASE_BYTES) throw new ManifestError(`case file too large: ${rel}`);
  const real = realpathSync(full);
  const relReal = path.relative(root, real);
  if (relReal.startsWith('..') || path.isAbsolute(relReal)) throw new ManifestError(`case file escapes the set directory: ${rel}`);
  return full;
}

export function loadSet(dir: string): LoadedSet {
  let manifestBytes: Buffer;
  try {
    manifestBytes = readFileSync(path.join(dir, 'manifest.json'));
  } catch {
    throw new ManifestError('manifest.json not found');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new ManifestError('manifest.json is not valid JSON');
  }
  const r = Manifest.safeParse(raw);
  if (!r.success) throw new ManifestError(`manifest.json invalid: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`).join('; ')}`);
  const ids = new Set<string>();
  for (const c of r.data.cases) {
    if (ids.has(c.id)) throw new ManifestError(`duplicate case id: ${c.id}`);
    ids.add(c.id);
  }
  const files = r.data.cases.map((c) => readFileSync(resolveCaseFile(dir, c.file)));
  return { manifest: r.data, manifestBytes, files };
}
