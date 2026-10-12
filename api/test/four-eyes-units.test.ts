/**
 * Four-eyes (REQ-20261009-four-eyes) units: error contract, DB-guard error mapping (exact SQLSTATE +
 * message, bounded chain walk), policy constants, document-editor predicate, audit metadata allow-list.
 */
import { AUDIT_ACTIONS, FOUR_EYES_ERROR_CODE } from '@fr/shared';
import { describe, expect, it } from 'vitest';

import { isFourEyesDbError, toHttpError } from '../src/app.js';
import { sanitizeMetadata } from '../src/audit/chain.js';
import { FOUR_EYES_GUARDED_TRANSITIONS } from '../src/claims/service.js';
import { ERROR_MESSAGES, FourEyesRefusal, HttpError, errors } from '../src/http/errors.js';
import { EDITOR_DECISIONS, isDocumentEditor } from '../src/imports/dto.js';

/** The shape observed with Prisma 7.10 + @prisma/adapter-pg on PostgreSQL 16 for a trigger RAISE. */
function prismaTriggerError(code: string, message: string): Error {
  const driverAdapterError = Object.assign(new Error(message), {
    name: 'DriverAdapterError',
    cause: { originalCode: code, originalMessage: message, kind: 'postgres', code, severity: 'ERROR', message },
  });
  return Object.assign(new Error(`Database error. Code: \`${code}\`. Message: \`${message}\``), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2039',
    meta: { modelName: 'Approval', driverAdapterError },
  });
}

describe('four-eyes error contract', () => {
  it('has the fixed 403 message and a refusal carrying its audit context', () => {
    expect(ERROR_MESSAGES.four_eyes_required).toBe('A different person must make this decision.');
    expect(FOUR_EYES_ERROR_CODE).toBe('four_eyes_required');
    const audit = { tenantId: 't', targetType: 'claim' as const, targetId: 'c', metadata: { basis: 'revision_author' } };
    const e = errors.fourEyes(audit);
    expect(e).toBeInstanceOf(FourEyesRefusal);
    expect(e).toBeInstanceOf(HttpError);
    expect([e.statusCode, e.code, e.message, e.details]).toEqual([403, 'four_eyes_required', 'A different person must make this decision.', undefined]);
    expect(e.audit).toBe(audit);
    expect(toHttpError(e)).toBe(e);
  });

  it('appends authz.four_eyes_denied after the step-4 actions (step 5 appends after it)', () => {
    // Append-only list: four-eyes was appended last in its step; step 5 adds exactly two actions after it.
    expect(AUDIT_ACTIONS.slice(-22, -17)).toEqual(['authz.four_eyes_denied', 'claim.analyzed', 'claim.bulk_analyzed', 'charge_label.set', 'charge_label.deleted']);
    // Step 7 (REQ-20261011-fuel-outlook) appends six actions after charge_label.deleted, in F13 order.
    expect(AUDIT_ACTIONS.slice(-17, -11)).toEqual(['fsc_table.created', 'fsc_table.updated', 'fsc_table.archived', 'claim.fuel_inputs_set', 'claim.fuel_inputs_cleared', 'price_data.imported']);
    // Hardening (REQ-20261012-hardening, C9 and C15) appends three actions after the step-8 list.
    expect(AUDIT_ACTIONS.slice(-3)).toEqual(['claim.analysis_failed', 'auth.password.change_failed', 'invite.existing_account']);
    // Step 8 (REQ-20261011-ocean-dd) appends eight D&D actions after price_data.imported, in C15 order.
    expect(AUDIT_ACTIONS.slice(-11, -3)).toEqual([
      'dd_tariff.created',
      'dd_tariff.updated',
      'dd_calendar.created',
      'dd_calendar.updated',
      'dd_invoice.created',
      'dd_invoice.updated',
      'dd_invoice.deleted',
      'dd_invoice.audited',
    ]);
  });

  it('keeps the basis code in audit metadata', () => {
    expect(sanitizeMetadata({ basis: 'field_editor', documentId: 'd', action: 'ACCEPT', value: 'secret' })).toEqual({
      basis: 'field_editor',
      documentId: 'd',
      action: 'ACCEPT',
    });
  });
});

describe('four-eyes DB guard mapping', () => {
  it('maps the Prisma driver-adapter trigger error to a plain 403 four_eyes_required', () => {
    const err = prismaTriggerError('P0001', 'four_eyes_required');
    expect(isFourEyesDbError(err)).toBe(true);
    const mapped = toHttpError(err);
    expect(mapped).not.toBeInstanceOf(FourEyesRefusal);
    expect([mapped.statusCode, mapped.code, mapped.message]).toEqual([403, 'four_eyes_required', ERROR_MESSAGES.four_eyes_required]);
  });

  it('maps a raw pg DatabaseError and a wrapped cause', () => {
    const pgErr = Object.assign(new Error('four_eyes_required'), { code: 'P0001', severity: 'ERROR' });
    expect(toHttpError(pgErr).code).toBe('four_eyes_required');
    expect(toHttpError(new Error('wrapper', { cause: pgErr })).code).toBe('four_eyes_required');
  });

  it('never matches on substrings, other SQLSTATEs or other guard messages', () => {
    for (const err of [
      prismaTriggerError('P0001', 'four_eyes_required: extra'),
      prismaTriggerError('P0001', 'packet_immutable'),
      prismaTriggerError('23514', 'four_eyes_required'),
      Object.assign(new Error('x four_eyes_required'), { code: 'P0001' }),
      new Error('four_eyes_required'),
      { code: 'P0001' },
      null,
      'four_eyes_required',
    ]) {
      expect(isFourEyesDbError(err)).toBe(false);
      if (typeof err === 'object' && err !== null) expect(toHttpError(err).statusCode).toBe(500);
    }
  });

  it('bounds the chain walk (depth 5) and survives cycles', () => {
    const leaf = { code: 'P0001', message: 'four_eyes_required' };
    const chain = (depth: number) => {
      let v: unknown = leaf;
      for (let i = 0; i < depth; i += 1) v = { cause: v };
      return v;
    };
    expect(isFourEyesDbError(chain(5))).toBe(true);
    expect(isFourEyesDbError(chain(6))).toBe(false);
    const a: Record<string, unknown> = {};
    a['cause'] = a;
    expect(isFourEyesDbError(a)).toBe(false);
  });
});

describe('four-eyes policy constants', () => {
  it('guards approve and reject but not send (D1, D2)', () => {
    expect([...FOUR_EYES_GUARDED_TRANSITIONS].sort()).toEqual(['approve', 'reject']);
  });

  it('counts only CORRECT and ADD as document edits (D3)', () => {
    expect([...EDITOR_DECISIONS].sort()).toEqual(['ADD', 'CORRECT']);
  });

  it('isDocumentEditor: uploader, CORRECT/ADD actors; never CONFIRM/REJECT/SET_TYPE; null viewer or uploader excludes nobody', () => {
    const d = (action: 'CONFIRM' | 'CORRECT' | 'REJECT' | 'ADD' | 'SET_TYPE' | 'ACCEPT' | 'REJECT_DOC', actorId: string) => ({ action, actorId });
    expect(isDocumentEditor('u1', [], 'u1')).toBe(true);
    expect(isDocumentEditor('u1', [], 'u2')).toBe(false);
    expect(isDocumentEditor(null, [], 'u2')).toBe(false);
    expect(isDocumentEditor(null, [d('CORRECT', 'u2')], 'u2')).toBe(true);
    expect(isDocumentEditor('u1', [d('ADD', 'u2')], 'u2')).toBe(true);
    expect(isDocumentEditor('u1', [d('CONFIRM', 'u2'), d('REJECT', 'u2'), d('SET_TYPE', 'u2'), d('REJECT_DOC', 'u2')], 'u2')).toBe(false);
    expect(isDocumentEditor('u1', [d('CORRECT', 'u3')], 'u2')).toBe(false);
    expect(isDocumentEditor('u1', [d('CORRECT', 'u1')], null)).toBe(false);
  });
});
