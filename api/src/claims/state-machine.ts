/**
 * Review state machine (A11). Packet revision status; claim.status mirrors the latest revision.
 *   PENDING_REVIEW --approve--> APPROVED
 *   PENDING_REVIEW --reject-->  REJECTED
 *   APPROVED       --send-->    SEND_READY (terminal)
 *   edit (new revision, PENDING_REVIEW) from PENDING_REVIEW | APPROVED | REJECTED; previous -> SUPERSEDED
 */
export type LiveStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SEND_READY';
export type Transition = 'approve' | 'reject' | 'send' | 'edit';

const FROM: Record<Transition, readonly LiveStatus[]> = {
  approve: ['PENDING_REVIEW'],
  reject: ['PENDING_REVIEW'],
  send: ['APPROVED'],
  edit: ['PENDING_REVIEW', 'APPROVED', 'REJECTED'],
};

const TO: Record<Exclude<Transition, 'edit'>, LiveStatus> = {
  approve: 'APPROVED',
  reject: 'REJECTED',
  send: 'SEND_READY',
};

export function canTransition(t: Transition, from: LiveStatus): boolean {
  return FROM[t].includes(from);
}

export function targetStatus(t: Exclude<Transition, 'edit'>): LiveStatus {
  return TO[t];
}

export const ACTION_FOR: Record<Transition, 'APPROVE' | 'REJECT' | 'SEND_READY' | 'EDIT'> = {
  approve: 'APPROVE',
  reject: 'REJECT',
  send: 'SEND_READY',
  edit: 'EDIT',
};

export const AUDIT_FOR: Record<Transition, 'approval.approved' | 'approval.rejected' | 'approval.send_ready' | 'packet.revision_created'> = {
  approve: 'approval.approved',
  reject: 'approval.rejected',
  send: 'approval.send_ready',
  edit: 'packet.revision_created',
};
