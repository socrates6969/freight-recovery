/**
 * HTTP errors with fixed, human-readable messages (C1). Unknown errors never forward their message.
 */

export const ERROR_MESSAGES = {
  validation_error: 'Request validation failed.',
  unauthenticated: 'Authentication required.',
  invalid_credentials: 'Invalid email or password.',
  invalid_code: 'Invalid authentication code.',
  invalid_token: 'Invalid or expired token.',
  weak_password: 'Password does not meet the password policy.',
  forbidden: 'You do not have permission to perform this action.',
  csrf_failed: 'CSRF validation failed.',
  origin_not_allowed: 'Origin not allowed.',
  not_found: 'Not found.',
  conflict: 'The request conflicts with the current state.',
  stale_revision: 'This item changed. Reload to continue.',
  invalid_state: 'This action is not allowed in the current state.',
  payload_too_large: 'Request body is too large.',
  unsupported_media_type: 'Content-Type must be application/json.',
  unprocessable: 'The request could not be processed.',
  rate_limited: 'Too many requests. Try again later.',
  account_locked: 'Too many failed attempts. Try again later.',
  service_unavailable: 'Service unavailable.',
  internal_error: 'Internal server error.',
  // Step 3 (N1)
  request_timeout: 'The request body was not received in time.',
  batch_full: 'This import batch is full.',
  unresolved_fields: 'Some flagged fields are still unresolved.',
  quota_exceeded: 'Storage quota reached.',
  export_too_large: 'Too many rows to export. Narrow your filters.',
  parser_busy: 'The parser is busy. Try again shortly.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export interface ErrorDetail {
  path: string;
  code: string;
}

export class HttpError extends Error {
  readonly retryAfterSeconds: number | undefined;

  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    opts: { message?: string; details?: ErrorDetail[]; retryAfterSeconds?: number } = {},
  ) {
    super(opts.message ?? ERROR_MESSAGES[code]);
    this.name = 'HttpError';
    this.details = opts.details;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }

  readonly details: ErrorDetail[] | undefined;
}

export const errors = {
  validation: (details: ErrorDetail[]) => new HttpError(400, 'validation_error', { details }),
  unauthenticated: () => new HttpError(401, 'unauthenticated'),
  invalidCredentials: () => new HttpError(401, 'invalid_credentials'),
  invalidCode: () => new HttpError(401, 'invalid_code'),
  invalidToken401: () => new HttpError(401, 'invalid_token'),
  invalidToken400: () => new HttpError(400, 'invalid_token'),
  weakPassword: () => new HttpError(400, 'weak_password'),
  forbidden: () => new HttpError(403, 'forbidden'),
  csrf: () => new HttpError(403, 'csrf_failed'),
  origin: () => new HttpError(403, 'origin_not_allowed'),
  notFound: () => new HttpError(404, 'not_found'),
  conflict: () => new HttpError(409, 'conflict'),
  staleRevision: () => new HttpError(409, 'stale_revision'),
  invalidState: () => new HttpError(409, 'invalid_state'),
  unprocessable: (message?: string) => new HttpError(422, 'unprocessable', message ? { message } : {}),
  rateLimited: (retryAfterSeconds: number) => new HttpError(429, 'rate_limited', { retryAfterSeconds }),
  requestTimeout: () => new HttpError(408, 'request_timeout'),
  payloadTooLarge: () => new HttpError(413, 'payload_too_large'),
  /** 415 for upload content problems: fixed message, reason code in details. */
  unsupportedFile: (reason: string) =>
    new HttpError(415, 'unsupported_media_type', { message: 'File type not supported.', details: [{ path: 'file', code: reason }] }),
  uploadMediaType: () => new HttpError(415, 'unsupported_media_type', { message: 'Content-Type must be application/octet-stream.' }),
  batchFull: () => new HttpError(409, 'batch_full'),
  unresolvedFields: () => new HttpError(409, 'unresolved_fields'),
  quotaExceeded: () => new HttpError(422, 'quota_exceeded'),
  exportTooLarge: () => new HttpError(422, 'export_too_large'),
  parserBusy: () => new HttpError(503, 'parser_busy', { retryAfterSeconds: 5 }),
  accountLocked: (retryAfterSeconds: number) => new HttpError(429, 'account_locked', { retryAfterSeconds }),
};

/** Fixed 422 messages shown verbatim by the web app. */
export const UNPROCESSABLE = {
  acknowledgePending: 'This revision has findings pending human review. Acknowledge them to approve.',
  assignee: 'The assignee must be an active user of this organization.',
} as const;
