/**
 * Image structure validation (A5.6). No pixel decoding: PNG chunk walk with CRC-32 verification and
 * JPEG marker walk, dimension/pixel limits, and no trailing data. Images yield no fields (D8: no OCR).
 */
import { crc32 } from 'node:zlib';

import { ParseRejection } from './types.js';

export const MAX_IMAGE_DIMENSION = 20000;
export const MAX_PNG_CHUNKS = 10_000;
export const MAX_JPEG_MARKERS = 100_000;
const JPEG_MAX_TRAILING = 16;

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Valid PNG (colorType -> bit depths). */
const PNG_DEPTHS: Readonly<Record<number, readonly number[]>> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

function u32(b: Uint8Array, p: number): number {
  return ((b[p] ?? 0) * 0x1000000 + ((b[p + 1] ?? 0) << 16) + ((b[p + 2] ?? 0) << 8) + (b[p + 3] ?? 0)) >>> 0;
}

function u16(b: Uint8Array, p: number): number {
  return ((b[p] ?? 0) << 8) | (b[p + 1] ?? 0);
}

function checkDimensions(width: number, height: number, maxPixels: number): void {
  if (width < 1 || height < 1) throw new ParseRejection('malformed_image');
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > maxPixels) throw new ParseRejection('image_too_large');
}

export interface ImageInfo {
  width: number;
  height: number;
}

export function validatePng(b: Uint8Array, maxPixels: number): ImageInfo {
  if (b.length < 8 || PNG_SIG.some((v, i) => b[i] !== v)) throw new ParseRejection('malformed_image');
  let pos = 8;
  let chunks = 0;
  let info: ImageInfo | null = null;
  let sawIdat = false;
  for (;;) {
    if (pos + 12 > b.length) throw new ParseRejection('malformed_image');
    const length = u32(b, pos);
    if (length > 0x7fffffff || pos + 12 + length > b.length) throw new ParseRejection('malformed_image');
    const type = String.fromCharCode(...b.subarray(pos + 4, pos + 8));
    if (!/^[A-Za-z]{4}$/u.test(type)) throw new ParseRejection('malformed_image');
    const crc = u32(b, pos + 8 + length);
    if (crc32(b.subarray(pos + 4, pos + 8 + length)) !== crc) throw new ParseRejection('malformed_image');
    chunks += 1;
    if (chunks > MAX_PNG_CHUNKS) throw new ParseRejection('malformed_image');
    if (chunks === 1) {
      if (type !== 'IHDR' || length !== 13) throw new ParseRejection('malformed_image');
      const d = pos + 8;
      const width = u32(b, d);
      const height = u32(b, d + 4);
      const depth = b[d + 8] ?? 0;
      const colorType = b[d + 9] ?? 0;
      if (!(PNG_DEPTHS[colorType] ?? []).includes(depth) || b[d + 10] !== 0 || b[d + 11] !== 0 || (b[d + 12] !== 0 && b[d + 12] !== 1)) {
        throw new ParseRejection('malformed_image');
      }
      checkDimensions(width, height, maxPixels);
      info = { width, height };
    } else if (type === 'IHDR') {
      throw new ParseRejection('malformed_image');
    }
    if (type === 'IDAT') sawIdat = true;
    pos += 12 + length;
    if (type === 'IEND') {
      if (length !== 0 || !sawIdat || !info) throw new ParseRejection('malformed_image');
      if (pos !== b.length) throw new ParseRejection('trailing_data');
      return info;
    }
  }
}

export function validateJpeg(b: Uint8Array, maxPixels: number): ImageInfo {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new ParseRejection('malformed_image');
  let pos = 2;
  let markers = 0;
  let info: ImageInfo | null = null;
  let sawSos = false;
  for (;;) {
    if (pos >= b.length || b[pos] !== 0xff) throw new ParseRejection('malformed_image');
    while (pos < b.length && b[pos] === 0xff) pos += 1;
    if (pos >= b.length) throw new ParseRejection('malformed_image');
    const marker = b[pos] ?? 0;
    pos += 1;
    markers += 1;
    if (markers > MAX_JPEG_MARKERS) throw new ParseRejection('malformed_image');
    if (marker === 0x00 || marker === 0xd8) throw new ParseRejection('malformed_image');
    if (marker === 0xd9) {
      if (!info || !sawSos) throw new ParseRejection('malformed_image');
      const trailing = b.subarray(pos);
      if (trailing.length > JPEG_MAX_TRAILING || trailing.some((x) => x !== 0)) throw new ParseRejection('trailing_data');
      return info;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (pos + 2 > b.length) throw new ParseRejection('malformed_image');
    const segLen = u16(b, pos);
    if (segLen < 2 || pos + segLen > b.length) throw new ParseRejection('malformed_image');
    if (marker >= 0xc0 && marker <= 0xc2) {
      if (info) throw new ParseRejection('malformed_image');
      const precision = b[pos + 2];
      const height = u16(b, pos + 3);
      const width = u16(b, pos + 5);
      const comps = b[pos + 7] ?? 0;
      if (precision !== 8 || ![1, 3, 4].includes(comps) || segLen !== 8 + 3 * comps) throw new ParseRejection('malformed_image');
      checkDimensions(width, height, maxPixels);
      info = { width, height };
    } else if ([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      throw new ParseRejection('malformed_image');
    }
    pos += segLen;
    if (marker === 0xda) {
      if (!info) throw new ParseRejection('malformed_image');
      sawSos = true;
      // Entropy-coded data: FF00 (stuffed) and FFD0-FFD7 (restart) are data, FFFF is fill.
      for (;;) {
        if (pos >= b.length) throw new ParseRejection('malformed_image');
        if (b[pos] !== 0xff) {
          pos += 1;
          continue;
        }
        const next = b[pos + 1];
        if (next === undefined) throw new ParseRejection('malformed_image');
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          pos += 2;
          continue;
        }
        if (next === 0xff) {
          pos += 1;
          continue;
        }
        break;
      }
    }
  }
}
