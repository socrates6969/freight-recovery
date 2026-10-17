/* eslint-disable */
// Step-3 UI test doubles: fake XMLHttpRequest (upload progress) and import/review DTO builders.
import { json } from './stub.js';

export class FakeXHR {
  static instances: FakeXHR[] = [];
  static reset() { FakeXHR.instances = []; }
  method = ''; url = ''; headers: Record<string, string> = {}; body: any = null;
  status = 0; responseText = ''; response: any = null; readyState = 0; responseType = '';
  onload: any = null; onerror: any = null; onprogress: any = null; onreadystatechange: any = null; onabort: any = null; ontimeout: any = null;
  listeners: Record<string, Function[]> = {};
  upload: any = { onprogress: null, listeners: {} as Record<string, Function[]>, addEventListener(t: string, f: Function) { (this.listeners[t] ??= []).push(f); }, removeEventListener() {} };
  withCredentials = false;
  constructor() { FakeXHR.instances.push(this); }
  open(m: string, u: string) { this.method = m; this.url = u; this.readyState = 1; }
  setRequestHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }
  getResponseHeader(k: string) { return this.respHeaders?.[k.toLowerCase()] ?? null; }
  getAllResponseHeaders() { return Object.entries(this.respHeaders ?? {}).map(([k, v]) => `${k}: ${v}`).join('\r\n'); }
  respHeaders: Record<string, string> | undefined;
  addEventListener(t: string, f: Function) { (this.listeners[t] ??= []).push(f); }
  removeEventListener() {}
  send(b: any) { this.body = b; }
  abort() { this.fire('abort', {}); }
  private fire(t: string, ev: any) { (this as any)['on' + t]?.(ev); for (const f of this.listeners[t] ?? []) f(ev); }
  progress(loaded: number, total: number) { const ev = { lengthComputable: true, loaded, total }; this.upload.onprogress?.(ev); for (const f of this.upload.listeners.progress ?? []) f(ev); }
  respond(status: number, body: unknown, headers: Record<string, string> = {}) {
    this.status = status; this.readyState = 4; this.respHeaders = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body); this.response = this.responseText;
    this.onreadystatechange?.({}); this.fire('load', {}); this.fire('loadend', {});
  }
}
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(900000 + ++n).padStart(12, '0')}`;
export const mkField = (key: string, value: string | null, o: Record<string, any> = {}) => ({
  id: id(), key, groupIndex: null, kind: 'STRING', value, correctedValue: null, effectiveValue: value, rawValue: value ?? '', confidence: 0.95,
  needsReview: false, reviewReasons: [] as string[], status: 'PROPOSED', origin: 'EXTRACTED',
  source: { page: null, line: 2, start: 13, end: 20, row: null, excerpt: `Load Number: ${value}` }, resolvedBy: null, resolvedAt: null, ...o,
});
export const mkDoc = (o: Record<string, any> = {}) => {
  const fields = o.fields ?? [mkField('rate_confirmation.load_number', 'LD-9001')];
  return {
    id: id(), batchId: o.batchId ?? '00000000-0000-4000-8000-0000000b0001', displayName: 'rc.txt', detectedType: 'TXT', sizeBytes: 100, sha256: 'a'.repeat(64), docType: 'RATE_CONFIRMATION', docTypeBasis: 'HEADER',
    status: 'ACCEPTED', rejectReason: null, reviewReasons: [], fieldCount: fields.length, flaggedFieldCount: fields.filter((f: any) => f.needsReview).length,
    unresolvedFlaggedCount: fields.filter((f: any) => f.needsReview && f.status === 'PROPOSED').length, minConfidence: 0.95, loadNumber: 'LD-9001', pageCount: null,
    createdAt: '2026-10-08T10:00:00.000Z', updatedAt: '2026-10-08T10:00:00.000Z', reviewThreshold: 0.9, warnings: [], providerName: 'deterministic', providerVersion: '1', decisions: [], ...o, fields,
  };
};
export const mkBatch = (o: Record<string, any> = {}) => ({ id: '00000000-0000-4000-8000-0000000b0001', label: null, source: 'UPLOAD', documentCount: 0, createdBy: { id: '00000000-0000-4000-8000-0000000000e1', name: 'Test' }, createdAt: '2026-10-08T10:00:00.000Z', ...o });
export const err = (status: number, code: string, message = 'SECRET-LEAK message') => json(status, { error: { code, message, requestId: 'r' } });
export const mkFile = (name: string, bytes = 10, type = 'application/pdf') => new File([new Uint8Array(bytes)], name, { type });
export { json };
