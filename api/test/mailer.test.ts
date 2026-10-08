import { describe, expect, it } from 'vitest';

import { MailDeliveryError, NotConfiguredError, SesMailer, deliverMail, type Mailer } from '../src/auth/mailer.js';

describe('mail delivery wrapper', () => {
  it('turns any transport failure into a detail-free MailDeliveryError', async () => {
    const failing: Mailer = {
      send: () => Promise.reject(new Error('smtp 550 user@example.com rejected')),
    };
    const err = await deliverMail(failing, {} as never, { kind: 'INVITE', to: 'a@b.test', token: 't' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailDeliveryError);
    expect(String((err as Error).message)).toBe('mail delivery failed');
  });

  it('the SES stub is not implemented (and maps to MailDeliveryError)', async () => {
    await expect(new SesMailer().send()).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(deliverMail(new SesMailer(), {} as never, { kind: 'PASSWORD_RESET', to: 'a@b.test', token: 't' })).rejects.toBeInstanceOf(
      MailDeliveryError,
    );
  });

  it('passes successful sends through', async () => {
    const sent: string[] = [];
    const ok: Mailer = {
      send: async (_tx, msg) => {
        sent.push(msg.to);
      },
    };
    await deliverMail(ok, {} as never, { kind: 'INVITE', to: 'x@y.test', token: 't' });
    expect(sent).toEqual(['x@y.test']);
  });
});
