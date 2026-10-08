/**
 * PDF text layer (A5.5). Runs ONLY inside the sandboxed parse worker (and in unit/parity tests).
 * Mozilla pdf.js (pdfjs-dist 6, legacy build for Node) with every optional feature off: no eval (pdf.js
 * 6 removed the font `eval` path that CVE-2024-4367 abused; code generation from strings is also
 * disabled by the worker's Node flags), no font faces, no system fonts, no fetches, no streaming, no
 * XFA, no WebAssembly, no image decoders. Annotations, attachments, JavaScript and embedded files are
 * never read: only `getTextContent()` per page.
 *
 * Text layout: items are grouped by baseline `y` (tolerance 2 units), lines ordered top to bottom and
 * items left to right; items on one line are joined with a single space when the horizontal gap
 * exceeds 0.25 x the font height, else with nothing; trailing spaces are trimmed; pages are joined
 * with `\n`. Registered divergence D2: a different engine than the Python reference (pdfplumber), so
 * parity is claimed only for simple single-column text-layer PDFs.
 */
import { cpLength } from './text.js';
import { ParseRejection } from './types.js';

const Y_TOLERANCE = 2;
const GAP_FACTOR = 0.25;

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

function isTextItem(x: unknown): x is TextItemLike {
  const o = x as Partial<TextItemLike> | null;
  return typeof o?.str === 'string' && Array.isArray(o.transform) && typeof o.width === 'number';
}

/** Build the page's lines from pdf.js text items (pure; unit-tested). */
export function layoutLines(items: readonly TextItemLike[]): string[] {
  const placed = items
    .filter((it) => it.str.trim() !== '')
    .map((it, i) => ({
      str: it.str,
      x: Number(it.transform[4] ?? 0),
      y: Number(it.transform[5] ?? 0),
      w: Number.isFinite(it.width) ? it.width : 0,
      h: Math.abs(Number(it.height)) || Math.hypot(Number(it.transform[2] ?? 0), Number(it.transform[3] ?? 0)) || 1,
      i,
    }));
  placed.sort((a, b) => b.y - a.y || a.i - b.i);
  const lines: (typeof placed)[] = [];
  for (const it of placed) {
    const cur = lines[lines.length - 1];
    const y0 = cur?.[0]?.y;
    if (cur && y0 !== undefined && Math.abs(it.y - y0) <= Y_TOLERANCE) cur.push(it);
    else lines.push([it]);
  }
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x || a.i - b.i);
    let out = '';
    let prev: (typeof line)[number] | null = null;
    for (const it of line) {
      if (prev && it.x - (prev.x + prev.w) > GAP_FACTOR * Math.max(it.h, prev.h)) out += ' ';
      out += it.str;
      prev = it;
    }
    return out.replace(/ +$/u, '');
  });
}

export interface PdfText {
  text: string;
  pageCount: number;
  /** UTF-16 offset in `text` where each page (1-based index - 1) starts. */
  pageStarts: number[];
}

interface PdfjsModule {
  getDocument: (src: Record<string, unknown>) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{ getTextContent: (o?: Record<string, unknown>) => Promise<{ items: unknown[] }>; cleanup: () => void }>;
    }>;
    destroy: () => Promise<void>;
  };
}

let loaded: PdfjsModule | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (loaded) return loaded;
  // Main-thread "fake worker": provide the worker module directly so pdf.js never imports by URL.
  const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.mjs')) as unknown;
  (globalThis as Record<string, unknown>)['pdfjsWorker'] = worker;
  loaded = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule;
  return loaded;
}

/**
 * Extract the text layer. Rejections: encrypted (password) -> encrypted_pdf; more pages than allowed
 * (checked before any page text is read) -> too_many_pages; extracted characters over the cap ->
 * text_too_large; anything else -> malformed_pdf.
 */
export async function pdfToText(bytes: Uint8Array, limits: { pdfPages: number; textChars: number }, deadlineMs?: number): Promise<PdfText> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    enableXfa: false,
    useWasm: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    fontExtraProperties: false,
    verbosity: 0,
    stopAtErrors: false,
  });
  try {
    let doc;
    try {
      doc = await task.promise;
    } catch (e) {
      throw new ParseRejection((e as { name?: string }).name === 'PasswordException' ? 'encrypted_pdf' : 'malformed_pdf');
    }
    if (doc.numPages > limits.pdfPages) throw new ParseRejection('too_many_pages');
    const pages: string[] = [];
    let total = 0;
    for (let n = 1; n <= doc.numPages; n += 1) {
      if (deadlineMs !== undefined && Date.now() > deadlineMs) throw new ParseRejection('parse_timeout');
      let lines: string[];
      try {
        const page = await doc.getPage(n);
        const tc = await page.getTextContent({ includeMarkedContent: false });
        lines = layoutLines(tc.items.filter(isTextItem));
        page.cleanup();
      } catch (e) {
        if (e instanceof ParseRejection) throw e;
        throw new ParseRejection('malformed_pdf');
      }
      const pageText = lines.join('\n');
      total += cpLength(pageText);
      if (total > limits.textChars) throw new ParseRejection('text_too_large');
      pages.push(pageText);
    }
    const pageStarts: number[] = [];
    let offset = 0;
    for (const p of pages) {
      pageStarts.push(offset);
      offset += p.length + 1;
    }
    return { text: pages.join('\n'), pageCount: doc.numPages, pageStarts };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
