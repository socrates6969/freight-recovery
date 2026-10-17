/**
 * Content sniffing (A7.3, pure). The client's media type is NEVER used: the type comes from magic
 * bytes, and the sanitized name's last extension must be allowed and agree with it (registered
 * divergence D3). PDF magic must be at offset 0 (D1). Text candidates may not contain NUL or C0 control
 * bytes other than HT, LF, CR, FF (D4) and may not start an HTML/SVG/XML/PHP document.
 */
import type { DetectedType, PrestoreRejectReason } from '@fr/shared';

export type SniffResult = { ok: true; detectedType: DetectedType } | { ok: false; reason: Exclude<PrestoreRejectReason, 'too_large'> };

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const PDF = ascii('%PDF-');
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

/** Signatures of known, NOT allowed formats (archives, executables, other images, office, PostScript). */
const DENIED_SIGNATURES: readonly (readonly number[])[] = [
  ascii('PK'),
  [0x1f, 0x8b],
  ascii('MZ'),
  [0x7f, 0x45, 0x4c, 0x46],
  ascii('GIF8'),
  ascii('RIFF'),
  [0xd0, 0xcf, 0x11, 0xe0],
  ascii('%!PS'),
  ascii('Rar!'),
  [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
];

const MARKUP_PREFIXES = ['<!doctype', '<html', '<script', '<svg', '<?xml', '<?php'];
const MARKUP_WINDOW = 256;

const EXT_TYPE: Readonly<Record<string, 'PDF' | 'PNG' | 'JPEG' | 'TEXT'>> = {
  '.pdf': 'PDF',
  '.png': 'PNG',
  '.jpg': 'JPEG',
  '.jpeg': 'JPEG',
  '.csv': 'TEXT',
  '.txt': 'TEXT',
};

/** Lower-cased last extension (including the dot), or '' when there is none. */
export function lastExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

/** C0 controls except HT, LF, CR, FF, plus DEL (0x7F; leader ruling SQ2). */
function isBinaryControl(byte: number): boolean {
  return (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) || byte === 0x7f;
}

function looksLikeMarkup(b: Uint8Array): boolean {
  let i = startsWith(b, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d || b[i] === 0x0c)) i += 1;
  const head = String.fromCharCode(...b.subarray(i, i + MARKUP_WINDOW)).toLowerCase();
  return MARKUP_PREFIXES.some((p) => head.startsWith(p));
}

/** Decide the detected type of an upload, or the pre-store rejection reason. */
export function sniff(bytes: Uint8Array, displayName: string): SniffResult {
  if (bytes.length === 0) return { ok: false, reason: 'empty_file' };
  if (DENIED_SIGNATURES.some((sig) => startsWith(bytes, sig))) return { ok: false, reason: 'unsupported_type' };
  const ext = lastExtension(displayName);
  const family = EXT_TYPE[ext];
  if (!family) return { ok: false, reason: 'unsupported_type' };
  const magic = startsWith(bytes, PDF) ? 'PDF' : startsWith(bytes, PNG) ? 'PNG' : startsWith(bytes, JPEG) ? 'JPEG' : 'TEXT';
  if (magic !== family) return { ok: false, reason: 'type_mismatch' };
  if (magic !== 'TEXT') return { ok: true, detectedType: magic };
  if (bytes.some(isBinaryControl)) return { ok: false, reason: 'binary_content' };
  if (looksLikeMarkup(bytes)) return { ok: false, reason: 'markup_content' };
  return { ok: true, detectedType: ext === '.csv' ? 'CSV' : 'TXT' };
}
