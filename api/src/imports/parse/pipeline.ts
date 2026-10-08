/**
 * `parseDocument` (A5.7): bytes + sniffed type -> normalized text, classification, extracted fields with
 * provenance, warnings and review reasons, or a fixed rejection reason. Pure apart from the PDF engine;
 * deterministic (same bytes + config -> byte-identical result). Runs inside the sandboxed worker.
 */
import { DOC_REVIEW_REASONS, type DocReviewReason, type WarningCode } from '@fr/shared/import-fields';

import { classify } from './classify.js';
import { CsvError, csvToText } from './csv.js';
import { validateJpeg, validatePng } from './image.js';
import { pdfToText } from './pdf.js';
import { getProvider } from './provider.js';
import { documentReviewReasons } from './reasons.js';
import { cpLength, decodeUtf8, pySplitlinesWithOffsets } from './text.js';
import {
  MAX_LINES,
  PARSER_VERSION,
  ParseRejection,
  type ParseLimits,
  type ParseRequest,
  type ParseResult,
  type ParseSuccess,
  type ParsedText,
} from './types.js';

export interface ParseInput extends ParseRequest {
  bytes: Uint8Array;
  /** Optional cooperative deadline (epoch ms) for PDF page loops. */
  deadlineMs?: number;
}

function assertTextSize(text: string, limits: ParseLimits): void {
  if (cpLength(text) > limits.textChars) throw new ParseRejection('text_too_large');
}

/** Map each splitlines() line to the entry (page / CSV record) containing its first character. */
function lineOwners(text: string, starts: readonly { start: number; owner: number }[]): (number | null)[] {
  const lines = pySplitlinesWithOffsets(text);
  const out: (number | null)[] = [];
  let k = 0;
  for (const l of lines) {
    while (k + 1 < starts.length && (starts[k + 1]?.start ?? Infinity) <= l.start) k += 1;
    out.push(starts.length > 0 ? (starts[k]?.owner ?? null) : null);
  }
  return out;
}

function sortReasons(rs: Iterable<DocReviewReason>): DocReviewReason[] {
  const set = new Set(rs);
  return DOC_REVIEW_REASONS.filter((r) => set.has(r));
}

async function parseUnsafe(input: ParseInput): Promise<ParseSuccess> {
  const warnings: WarningCode[] = [];
  const passthrough: DocReviewReason[] = [];
  let text = '';
  let isPdf = false;
  let pageCount: number | null = null;
  let pageOfLine: (number | null)[] = [];
  let rowOfLine: (number | null)[] = [];
  let decodeReplacements = false;

  switch (input.detectedType) {
    case 'PNG':
    case 'JPEG': {
      if (input.detectedType === 'PNG') validatePng(input.bytes, input.limits.imagePixels);
      else validateJpeg(input.bytes, input.limits.imagePixels);
      return {
        ok: true,
        docType: 'OTHER',
        docTypeBasis: 'NONE',
        status: 'NEEDS_REVIEW',
        text: '',
        pageCount: null,
        charCount: 0,
        lineCount: 0,
        fields: [],
        warnings: [],
        reviewReasons: ['IMAGE_NO_TEXT_LAYER'],
        loadNumber: null,
        providerName: getProvider().name,
        providerVersion: getProvider().version,
        parserVersion: PARSER_VERSION,
      };
    }
    case 'PDF': {
      const pdf = await pdfToText(input.bytes, input.limits, input.deadlineMs);
      text = pdf.text;
      isPdf = true;
      pageCount = pdf.pageCount;
      pageOfLine = lineOwners(
        text,
        pdf.pageStarts.map((start, i) => ({ start, owner: i + 1 })),
      );
      break;
    }
    case 'CSV':
    case 'TXT': {
      const decoded = decodeUtf8(input.bytes);
      assertTextSize(decoded.text, input.limits);
      decodeReplacements = decoded.replacements;
      if (decodeReplacements) {
        warnings.push('DECODE_REPLACEMENTS');
        passthrough.push('DECODE_REPLACEMENTS');
      }
      if (input.detectedType === 'CSV') {
        let csv;
        try {
          csv = csvToText(decoded.text);
        } catch (e) {
          if (e instanceof CsvError) throw new ParseRejection('malformed_csv');
          throw e;
        }
        text = csv.text;
        warnings.push(...csv.warnings);
        let offset = 0;
        const starts = csv.entries.map((e) => {
          const s = { start: offset, owner: e.row };
          offset += e.text.length + 1;
          return s;
        });
        rowOfLine = lineOwners(text, starts);
      } else {
        text = decoded.text;
      }
      break;
    }
  }

  assertTextSize(text, input.limits);
  const lineCount = pySplitlinesWithOffsets(text).length;
  if (lineCount > MAX_LINES) throw new ParseRejection('text_too_large');
  const { docType, basis } = classify(text, input.filename);
  const provider = getProvider();
  const parsed: ParsedText = { text, isPdf, docType, basis, pageOfLine, rowOfLine, decodeReplacements };
  const draft = provider.extract(parsed, input.threshold);
  warnings.push(...draft.warnings);
  passthrough.push(...draft.reviewReasons);
  const reviewReasons = sortReasons(
    documentReviewReasons({
      docType,
      detectedType: input.detectedType,
      fields: draft.fields.map((f) => ({ key: f.key, value: f.value, needsReview: f.needsReview })),
      passthrough,
    }),
  );
  return {
    ok: true,
    docType,
    docTypeBasis: basis,
    status: reviewReasons.length === 0 ? 'ACCEPTED' : 'NEEDS_REVIEW',
    text,
    pageCount,
    charCount: cpLength(text),
    lineCount,
    fields: draft.fields,
    warnings: warnings.slice(0, 50),
    reviewReasons,
    loadNumber: draft.loadNumber,
    providerName: provider.name,
    providerVersion: provider.version,
    parserVersion: PARSER_VERSION,
  };
}

/** Parse one document; content problems become `{ok:false, reason}` (never thrown). */
export async function parseDocument(input: ParseInput): Promise<ParseResult> {
  try {
    return await parseUnsafe(input);
  } catch (e) {
    if (e instanceof ParseRejection) return { ok: false, reason: e.reason };
    throw e;
  }
}
