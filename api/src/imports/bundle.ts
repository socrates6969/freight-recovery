/**
 * ExtractedBundle assembly (A5.4 / Part F): turns the EFFECTIVE field values of accepted documents into
 * the TypeScript mirror of the Python `ExtractedBundle` (input of the step-5 rules engine), mirroring
 * `freight_recovery.extraction.service.extract_bundle`: the first document of each type wins, later
 * ones produce a duplicate warning, unrecognised documents are skipped with a warning, and disagreeing
 * load numbers are reported.
 */
import {
  emptyBillOfLading,
  emptyInvoice,
  emptyRateConfirmation,
  type ExtractedBundle,
  type ImportDocType,
  type WarningCode,
} from '@fr/shared';

import type { TenantTx } from '../db/tenant.js';

/** Python-style messages for warning codes (for bundle warnings; messages are informational). */
const WARNING_MESSAGES: Readonly<Record<WarningCode, string>> = {
  CHARGE_AMOUNT_UNREADABLE: 'A charge line was ignored because its amount could not be read.',
  CSV_ROW_TOO_SHORT: 'CSV row not understood (too few columns).',
  CSV_ROW_LENGTH_MISMATCH: 'CSV data row length differs from the header; extra/missing cells were ignored.',
  DECODE_REPLACEMENTS: 'Invalid UTF-8 bytes were replaced.',
  UNRECOGNISED_DOCUMENT: 'unrecognised document type; skipped',
  FIELDS_TRUNCATED: 'Too many fields; the excess was dropped.',
};

/** Where a field was read (stored pointer and excerpt); used for packet citations (step 5). */
export interface FieldRef {
  page: number | null;
  line: number | null;
  excerpt: string | null;
}

export interface BundleField {
  key: string;
  groupIndex: number | null;
  /** correctedValue if CORRECTED, null if REJECTED, else value. */
  effectiveValue: string | null;
  /** Step 5: the field's pointer/excerpt (absent where provenance is not needed). */
  ref?: FieldRef;
}

export interface BundleDocument {
  displayName: string;
  docType: ImportDocType;
  fields: readonly BundleField[];
  warnings: readonly WarningCode[];
}

/** Python `repr()` of a str (single quotes unless the text contains `'` and no `"`). */
export function pyRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (c < 0x20 || c === 0x7f) out += `\\x${c.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return `${quote}${out}${quote}`;
}

function pickField(fields: readonly BundleField[], key: string): BundleField | undefined {
  return fields.find((x) => x.key === key && x.effectiveValue !== null);
}

/**
 * Provenance of one bundle slot (step 5): the index in `docs` of the document that filled it, the ref of
 * every scalar field the bundle took (by field key), and per pushed invoice line (same order as
 * `invoice.lines`) the refs of its description and amount fields. A ref is null when the field carried none.
 */
export interface SlotProvenance {
  docIndex: number;
  fields: Record<string, FieldRef | null>;
  lines: { description: FieldRef | null; amount: FieldRef | null }[];
}

export interface BundleProvenance {
  invoice: SlotProvenance | null;
  rate_confirmation: SlotProvenance | null;
  bol: SlotProvenance | null;
}

function stringList(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function assembleBundle(docs: readonly BundleDocument[]): ExtractedBundle {
  return assembleBundleWithProvenance(docs).bundle;
}

/** assembleBundle plus, per filled slot, which document and which fields the values came from. */
export function assembleBundleWithProvenance(docs: readonly BundleDocument[]): { bundle: ExtractedBundle; provenance: BundleProvenance } {
  const bundle: ExtractedBundle = { invoice: null, rate_confirmation: null, bol: null, warnings: [] };
  const provenance: BundleProvenance = { invoice: null, rate_confirmation: null, bol: null };
  for (const [docIndex, doc] of docs.entries()) {
    const prefix = `${doc.displayName}: `;
    const extractionWarnings = doc.warnings.filter((w) => w === 'CHARGE_AMOUNT_UNREADABLE').map((w) => WARNING_MESSAGES[w]);
    for (const w of doc.warnings) if (w !== 'CHARGE_AMOUNT_UNREADABLE') bundle.warnings.push(prefix + WARNING_MESSAGES[w]);
    const f = doc.fields;
    if (doc.docType === 'OTHER') {
      bundle.warnings.push(prefix + WARNING_MESSAGES.UNRECOGNISED_DOCUMENT);
      continue;
    }
    const slot = doc.docType === 'INVOICE' ? 'invoice' : doc.docType === 'RATE_CONFIRMATION' ? 'rate_confirmation' : 'bol';
    if (bundle[slot] !== null) {
      bundle.warnings.push(`${prefix}duplicate ${slot}; ignored`);
      continue;
    }
    const prov: SlotProvenance = { docIndex, fields: {}, lines: [] };
    provenance[slot] = prov;
    const value = (fields: readonly BundleField[], key: string): string | null => {
      const picked = pickField(fields, key);
      if (!picked) return null;
      prov.fields[key] = picked.ref ?? null;
      return picked.effectiveValue;
    };
    if (doc.docType === 'INVOICE') {
      const inv = emptyInvoice();
      inv.invoice_number = value(f, 'invoice.invoice_number');
      inv.load_number = value(f, 'invoice.load_number');
      inv.carrier = value(f, 'invoice.carrier');
      inv.shipper = value(f, 'invoice.shipper');
      inv.invoice_date = value(f, 'invoice.invoice_date');
      inv.total = value(f, 'invoice.total');
      const groups = [...new Set(f.filter((x) => x.groupIndex !== null).map((x) => x.groupIndex ?? 0))].sort((a, b) => a - b);
      for (const g of groups) {
        const descField = f.find((x) => x.key === 'invoice.charge.description' && x.groupIndex === g && x.effectiveValue !== null);
        const amountField = f.find((x) => x.key === 'invoice.charge.amount' && x.groupIndex === g && x.effectiveValue !== null);
        const desc = descField?.effectiveValue;
        const amount = amountField?.effectiveValue;
        if (desc && amount) {
          inv.lines.push({ description: desc, amount });
          prov.lines.push({ description: descField?.ref ?? null, amount: amountField?.ref ?? null });
        }
      }
      inv.extraction_warnings = extractionWarnings;
      bundle.invoice = inv;
    } else if (doc.docType === 'RATE_CONFIRMATION') {
      const rc = emptyRateConfirmation();
      rc.load_number = value(f, 'rate_confirmation.load_number');
      rc.carrier = value(f, 'rate_confirmation.carrier');
      rc.linehaul_rate = value(f, 'rate_confirmation.linehaul_rate');
      rc.fuel_surcharge = value(f, 'rate_confirmation.fuel_surcharge');
      rc.detention_free_hours = value(f, 'rate_confirmation.detention_free_hours');
      rc.detention_rate_per_hour = value(f, 'rate_confirmation.detention_rate_per_hour');
      rc.detention_max_hours = value(f, 'rate_confirmation.detention_max_hours');
      rc.authorized_accessorials = stringList(value(f, 'rate_confirmation.authorized_accessorials'));
      rc.extraction_warnings = extractionWarnings;
      bundle.rate_confirmation = rc;
    } else {
      const bol = emptyBillOfLading();
      bol.load_number = value(f, 'bol.load_number');
      bol.facility = value(f, 'bol.facility');
      bol.appointment_time = value(f, 'bol.appointment_time');
      bol.arrival_time = value(f, 'bol.arrival_time');
      bol.departure_time = value(f, 'bol.departure_time');
      bol.extraction_warnings = extractionWarnings;
      bundle.bol = bol;
    }
    bundle.warnings.push(...extractionWarnings.map((w) => prefix + w));
  }
  const loads = new Set<string>();
  for (const x of [bundle.invoice, bundle.rate_confirmation, bundle.bol]) if (x?.load_number) loads.add(x.load_number);
  if (loads.size > 1) {
    const sorted = [...loads].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    bundle.warnings.push(`Load numbers disagree across documents: [${sorted.map(pyRepr).join(', ')}]`);
  }
  return { bundle, provenance };
}

/** Citation locator (`file:L5`, PDF `file:p2:L5`), the convention already used by the seed. */
export function pointerToLocator(displayName: string, pointer: { page: number | null; line: number }): string {
  return pointer.page === null ? `${displayName}:L${pointer.line}` : `${displayName}:p${pointer.page}:L${pointer.line}`;
}

// ---------------------------------------------------------------------------------------------
// Loader for the step-5 rules engine (Part F)
// ---------------------------------------------------------------------------------------------

export interface BundleSource {
  documentId: string;
  displayName: string;
  sha256: string;
  docType: ImportDocType;
}

/** A source with the stored original's size (packet sources, step 5). */
export interface AnalysisSource extends BundleSource {
  sizeBytes: number;
}

/** Effective value of a stored field (correctedValue if CORRECTED, null if REJECTED, else value). */
function effectiveValue(f: { status: string; value: string | null; correctedValue: string | null }): string | null {
  return f.status === 'CORRECTED' ? f.correctedValue : f.status === 'REJECTED' ? null : f.value;
}

/**
 * The input of the step-5 analysis: the ExtractedBundle of a claim from its linked ACCEPTED documents
 * (oldest link first; ties by link id), the provenance of every value and the packet sources
 * (`sources[i]` describes the document with provenance `docIndex` i). Runs in the caller's tenant
 * transaction.
 */
export async function loadAnalysisInput(
  tx: TenantTx,
  claimId: string,
): Promise<{ bundle: ExtractedBundle; provenance: BundleProvenance; sources: AnalysisSource[] }> {
  const links = await tx.claimDocument.findMany({ where: { claimId }, orderBy: [{ linkedAt: 'asc' }, { id: 'asc' }], select: { documentId: true } });
  const docs = await tx.importDocument.findMany({
    where: { id: { in: links.map((l) => l.documentId) }, status: 'ACCEPTED' },
    select: { id: true, displayName: true, sha256: true, docType: true, warnings: true, sizeBytes: true },
  });
  const order = new Map(links.map((l, i) => [l.documentId, i]));
  docs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const fields = await tx.extractedField.findMany({
    where: { documentId: { in: docs.map((d) => d.id) } },
    orderBy: [{ ordinal: 'asc' }, { id: 'asc' }],
    select: { documentId: true, key: true, groupIndex: true, status: true, value: true, correctedValue: true, page: true, line: true, excerpt: true },
  });
  const { bundle, provenance } = assembleBundleWithProvenance(
    docs.map((d) => ({
      displayName: d.displayName,
      docType: d.docType,
      warnings: d.warnings as WarningCode[],
      fields: fields
        .filter((f) => f.documentId === d.id)
        .map((f) => ({ key: f.key, groupIndex: f.groupIndex, effectiveValue: effectiveValue(f), ref: { page: f.page, line: f.line, excerpt: f.excerpt } })),
    })),
  );
  return {
    bundle,
    provenance,
    sources: docs.map((d) => ({ documentId: d.id, displayName: d.displayName, sha256: d.sha256, docType: d.docType, sizeBytes: d.sizeBytes })),
  };
}

/**
 * The ExtractedBundle of a claim from its linked ACCEPTED documents (oldest link first), with the
 * sources a packet must cite. Runs in the caller's tenant transaction.
 */
export async function loadBundleForClaim(tx: TenantTx, claimId: string): Promise<{ bundle: ExtractedBundle; sources: BundleSource[] }> {
  const { bundle, sources } = await loadAnalysisInput(tx, claimId);
  return { bundle, sources: sources.map(({ documentId, displayName, sha256, docType }) => ({ documentId, displayName, sha256, docType })) };
}
