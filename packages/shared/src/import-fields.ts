/**
 * Import/extraction vocabulary (N6/N7): allow-listed field keys and kinds, reason codes, warning codes,
 * field labels for the UI, and the confidence level function. Plain data, no dependencies (also loaded
 * by the sandboxed parse worker).
 */

export const DETECTED_TYPES = ['PDF', 'PNG', 'JPEG', 'CSV', 'TXT'] as const;
export type DetectedType = (typeof DETECTED_TYPES)[number];

export const IMPORT_DOC_STATUSES = ['RECEIVED', 'NEEDS_REVIEW', 'ACCEPTED', 'REJECTED', 'FAILED'] as const;
export type ImportDocStatus = (typeof IMPORT_DOC_STATUSES)[number];

export const DOC_TYPE_BASES = ['HEADER', 'KEYS', 'FILENAME', 'MANUAL', 'NONE'] as const;
export type DocTypeBasis = (typeof DOC_TYPE_BASES)[number];

export const FIELD_KINDS = ['STRING', 'DECIMAL', 'DATETIME', 'STRING_LIST'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const FIELD_STATUSES = ['PROPOSED', 'CONFIRMED', 'CORRECTED', 'REJECTED'] as const;
export type FieldStatus = (typeof FIELD_STATUSES)[number];

export const FIELD_ORIGINS = ['EXTRACTED', 'MANUAL'] as const;
export type FieldOrigin = (typeof FIELD_ORIGINS)[number];

export const REVIEW_ACTIONS = ['CONFIRM', 'CORRECT', 'REJECT', 'ADD', 'SET_TYPE', 'ACCEPT', 'REJECT_DOC'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const IMPORT_SOURCES = ['UPLOAD', 'EMAIL'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

/** Document types an import document can have (the existing DocType enum). */
export const IMPORT_DOC_TYPES = ['INVOICE', 'RATE_CONFIRMATION', 'BILL_OF_LADING', 'OTHER'] as const;
export type ImportDocType = (typeof IMPORT_DOC_TYPES)[number];
export const KNOWN_DOC_TYPES = ['INVOICE', 'RATE_CONFIRMATION', 'BILL_OF_LADING'] as const;
export type KnownDocType = (typeof KNOWN_DOC_TYPES)[number];

/** Pre-store rejection reasons (HTTP 413/415; no document row). */
export const PRESTORE_REJECT_REASONS = ['too_large', 'unsupported_type', 'type_mismatch', 'binary_content', 'empty_file', 'markup_content'] as const;
export type PrestoreRejectReason = (typeof PRESTORE_REJECT_REASONS)[number];

/** Post-store rejection reasons (status REJECTED, `rejectReason`). */
export const POSTSTORE_REJECT_REASONS = [
  'malformed_pdf',
  'encrypted_pdf',
  'too_many_pages',
  'text_too_large',
  'malformed_csv',
  'malformed_image',
  'image_too_large',
  'trailing_data',
  'parse_timeout',
  'parse_memory',
  'parse_failed',
  'reviewer_rejected',
] as const;
export type PoststoreRejectReason = (typeof POSTSTORE_REJECT_REASONS)[number];

/** Rejections the parser itself can produce (a subset of the post-store reasons). */
export const PARSE_REJECT_REASONS = [
  'malformed_pdf',
  'encrypted_pdf',
  'too_many_pages',
  'text_too_large',
  'malformed_csv',
  'malformed_image',
  'image_too_large',
  'trailing_data',
  // Cooperative deadline inside the worker (the parent also enforces the wall clock).
  'parse_timeout',
] as const;
export type ParseRejectReason = (typeof PARSE_REJECT_REASONS)[number];

/** Document review reasons, in their fixed reporting order. */
export const DOC_REVIEW_REASONS = [
  'UNKNOWN_DOC_TYPE',
  'NO_FIELDS',
  'MISSING_LOAD_NUMBER',
  'IMAGE_NO_TEXT_LAYER',
  'DECODE_REPLACEMENTS',
  'IGNORED_CONTENT',
  'FLAGGED_FIELDS',
  'DUPLICATE_OF_EARLIER',
  'TRUNCATED_FIELDS',
] as const;
export type DocReviewReason = (typeof DOC_REVIEW_REASONS)[number];

/** Field review reasons, in their fixed reporting order. */
export const FIELD_REVIEW_REASONS = ['LOW_CONFIDENCE', 'UNPARSEABLE_VALUE', 'CONFLICTING_VALUES', 'SANITIZED_VALUE'] as const;
export type FieldReviewReason = (typeof FIELD_REVIEW_REASONS)[number];

export const WARNING_CODES = [
  'CSV_ROW_TOO_SHORT',
  'CSV_ROW_LENGTH_MISMATCH',
  'CHARGE_AMOUNT_UNREADABLE',
  'DECODE_REPLACEMENTS',
  'UNRECOGNISED_DOCUMENT',
  'FIELDS_TRUNCATED',
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

export interface FieldSpec {
  key: string;
  docType: KnownDocType;
  kind: FieldKind;
  label: string;
  /** Money-valued DECIMAL (formatted as USD in the UI); other DECIMALs are hours/rates. */
  money: boolean;
}

/** Allow-listed field keys in their fixed (N7) order per document type. */
export const FIELD_SPECS: readonly FieldSpec[] = Object.freeze([
  { key: 'invoice.invoice_number', docType: 'INVOICE', kind: 'STRING', label: 'Invoice number', money: false },
  { key: 'invoice.load_number', docType: 'INVOICE', kind: 'STRING', label: 'Load number', money: false },
  { key: 'invoice.carrier', docType: 'INVOICE', kind: 'STRING', label: 'Carrier', money: false },
  { key: 'invoice.shipper', docType: 'INVOICE', kind: 'STRING', label: 'Shipper', money: false },
  { key: 'invoice.invoice_date', docType: 'INVOICE', kind: 'STRING', label: 'Invoice date', money: false },
  { key: 'invoice.total', docType: 'INVOICE', kind: 'DECIMAL', label: 'Total', money: true },
  { key: 'invoice.charge.description', docType: 'INVOICE', kind: 'STRING', label: 'Charge description', money: false },
  { key: 'invoice.charge.amount', docType: 'INVOICE', kind: 'DECIMAL', label: 'Charge amount', money: true },
  { key: 'rate_confirmation.load_number', docType: 'RATE_CONFIRMATION', kind: 'STRING', label: 'Load number', money: false },
  { key: 'rate_confirmation.carrier', docType: 'RATE_CONFIRMATION', kind: 'STRING', label: 'Carrier', money: false },
  { key: 'rate_confirmation.linehaul_rate', docType: 'RATE_CONFIRMATION', kind: 'DECIMAL', label: 'Linehaul rate', money: true },
  { key: 'rate_confirmation.fuel_surcharge', docType: 'RATE_CONFIRMATION', kind: 'DECIMAL', label: 'Fuel surcharge', money: true },
  { key: 'rate_confirmation.detention_free_hours', docType: 'RATE_CONFIRMATION', kind: 'DECIMAL', label: 'Detention free hours', money: false },
  { key: 'rate_confirmation.detention_rate_per_hour', docType: 'RATE_CONFIRMATION', kind: 'DECIMAL', label: 'Detention rate per hour', money: true },
  { key: 'rate_confirmation.detention_max_hours', docType: 'RATE_CONFIRMATION', kind: 'DECIMAL', label: 'Detention max hours', money: false },
  { key: 'rate_confirmation.authorized_accessorials', docType: 'RATE_CONFIRMATION', kind: 'STRING_LIST', label: 'Authorized accessorials', money: false },
  { key: 'bol.load_number', docType: 'BILL_OF_LADING', kind: 'STRING', label: 'Load number', money: false },
  { key: 'bol.facility', docType: 'BILL_OF_LADING', kind: 'STRING', label: 'Facility', money: false },
  { key: 'bol.appointment_time', docType: 'BILL_OF_LADING', kind: 'DATETIME', label: 'Appointment time', money: false },
  { key: 'bol.arrival_time', docType: 'BILL_OF_LADING', kind: 'DATETIME', label: 'Arrival time', money: false },
  { key: 'bol.departure_time', docType: 'BILL_OF_LADING', kind: 'DATETIME', label: 'Departure time', money: false },
] satisfies FieldSpec[]);

export const FIELD_KEYS: readonly string[] = Object.freeze(FIELD_SPECS.map((f) => f.key));

const SPEC_BY_KEY: ReadonlyMap<string, FieldSpec> = new Map(FIELD_SPECS.map((f) => [f.key, f]));

export function fieldSpec(key: string): FieldSpec | undefined {
  return SPEC_BY_KEY.get(key);
}

/** Field keys of one document type in N7 order. */
export function fieldKeysFor(docType: KnownDocType): readonly string[] {
  return FIELD_SPECS.filter((f) => f.docType === docType).map((f) => f.key);
}

/** Key -> UI label (N12). */
export const FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(FIELD_SPECS.map((f) => [f.key, f.label])));

/** The load-number field of a document type. */
export const LOAD_NUMBER_KEYS: Readonly<Record<KnownDocType, string>> = Object.freeze({
  INVOICE: 'invoice.load_number',
  RATE_CONFIRMATION: 'rate_confirmation.load_number',
  BILL_OF_LADING: 'bol.load_number',
});

/** Charge pair keys (share one groupIndex). */
export const CHARGE_KEYS = ['invoice.charge.description', 'invoice.charge.amount'] as const;

export function isGroupedKey(key: string): boolean {
  return (CHARGE_KEYS as readonly string[]).includes(key);
}

/** Default review threshold (N3). */
export const DEFAULT_REVIEW_THRESHOLD = 0.9;

/** UI level word for a confidence (N12): High >= 90%, Medium >= 70%, else Low. */
export function confidenceLevel(confidence: number): 'High' | 'Medium' | 'Low' {
  if (confidence >= 0.9) return 'High';
  if (confidence >= 0.7) return 'Medium';
  return 'Low';
}

/** Allowed upload file extensions (last extension, case-insensitive). */
export const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.csv', '.txt'] as const;
/** Client-side mirror of the server default IMPORT_MAX_FILE_BYTES (UX pre-filter only). */
export const DEFAULT_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Client-side mirror of IMPORT_MAX_FILES_PER_BATCH. */
export const DEFAULT_IMPORT_MAX_FILES_PER_BATCH = 10;
