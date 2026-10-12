/**
 * Four-eyes (REQ-20261009-four-eyes): separation of duties between the author of a claim revision or
 * an imported document and the person who approves, rejects or accepts it. Shared so the API error code
 * and the UI copy cannot drift apart.
 */

/** API error code for a refused approve/reject/accept by an author or editor (HTTP 403). */
export const FOUR_EYES_ERROR_CODE = 'four_eyes_required' as const;

/** Shown instead of Approve/Reject to a revision author of the claim. */
export const FOUR_EYES_CLAIM_TEXT = 'You edited this revision. Another approver must approve it.';

/** Shown instead of Accept document to the uploader or a CORRECT/ADD editor of the document. */
export const FOUR_EYES_DOCUMENT_TEXT = 'You uploaded or edited this document. Another reviewer must accept it.';

/**
 * Hardening (REQ-20261012-hardening, C1): the refusal bases of approve/reject, in evaluation order. The first
 * basis that applies is reported (audit `basis`, approval queue `selfAuthoredBasis`).
 */
export const FOUR_EYES_CLAIM_BASES = ['revision_author', 'dd_invoice_editor', 'label_author'] as const;
export type FourEyesClaimBasis = (typeof FOUR_EYES_CLAIM_BASES)[number];
