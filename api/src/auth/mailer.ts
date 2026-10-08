/**
 * Mail delivery for password-reset and invite tokens (A7). Only the dev/test outbox exists: real email
 * sending is out of scope, so production refuses MAIL_TRANSPORT=outbox at startup (documented gap) and
 * SesMailer throws NotConfigured.
 */
import type { SystemTx } from '../db/system.js';

export type MailKindName = 'PASSWORD_RESET' | 'INVITE';

export interface MailMessage {
  kind: MailKindName;
  to: string;
  token: string;
  tenantId?: string | null;
}

export interface Mailer {
  /** Deliver inside the caller's system transaction (so a failed request leaves no token behind). */
  send(tx: SystemTx, msg: MailMessage): Promise<void>;
}

export class NotConfiguredError extends Error {
  constructor() {
    super('Mail transport not configured');
    this.name = 'NotConfiguredError';
  }
}

/** Dev/test sink: inserts into mail_outbox (read back via GET /dev/outbox when enabled). */
export class OutboxMailer implements Mailer {
  async send(tx: SystemTx, msg: MailMessage): Promise<void> {
    await tx.mailOutbox.create({
      data: { toEmail: msg.to, kind: msg.kind, token: msg.token, tenantId: msg.tenantId ?? null },
    });
  }
}

/** Placeholder for a real SES transport (not implemented in this step). */
export class SesMailer implements Mailer {
  send(): Promise<void> {
    return Promise.reject(new NotConfiguredError());
  }
}

/** Raised (inside the caller's transaction, so it rolls back) when a mail transport fails to deliver. */
export class MailDeliveryError extends Error {
  constructor() {
    super('mail delivery failed');
    this.name = 'MailDeliveryError';
  }
}

/** Send through the configured mailer; any transport failure becomes a MailDeliveryError (no details). */
export async function deliverMail(mailer: Mailer, tx: SystemTx, msg: MailMessage): Promise<void> {
  try {
    await mailer.send(tx, msg);
  } catch {
    throw new MailDeliveryError();
  }
}
