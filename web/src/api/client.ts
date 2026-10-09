/**
 * Typed API client. Same-origin only (`/api/...`), JSON only, Bearer token from memory, CSRF header on
 * unsafe methods, single-flight refresh on 401 (serialized across tabs with the Web Locks API when
 * available), and Zod parsing of EVERY response (a parse failure never renders raw data).
 */
import { CsrfResponse, ErrorBody, ImportDocumentDetail, RefreshResponse, type ImportDocumentDetailDto } from '@fr/shared';
import type { z } from 'zod';

import type { SessionStore } from '../auth/session-store';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const GENERIC = 'Something went wrong. Please try again.';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface RequestOptions<S extends z.ZodType | undefined> {
  body?: unknown;
  schema?: S;
  /** Attach the Bearer token and retry once after a refresh on 401 (default true). */
  auth?: boolean;
}

type Result<S> = S extends z.ZodType ? z.output<S> : undefined;

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export interface UploadOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

interface RawResult {
  status: number;
  body: string;
  retryAfter: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** Only our own export/download names are honored from Content-Disposition. */
const SAFE_DOWNLOAD_NAME = /^attachment; filename="((?:freight-recovery-[a-z]+-\d{8}T\d{6}Z|document-[0-9a-f]{8})\.(?:csv|xlsx|pdf|png|jpg|txt))"$/u;

export class ApiClient {
  private csrfFallback: string | null = null;
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly session: SessionStore,
    private readonly onAuthLost: () => void,
    private readonly xhrImpl: typeof XMLHttpRequest | undefined = typeof XMLHttpRequest === 'undefined' ? undefined : XMLHttpRequest,
  ) {}

  /** Ensure a CSRF token exists (cookie set by the server); returns the value to echo. */
  async csrfToken(): Promise<string> {
    const cookie = readCookie('fr_csrf');
    if (cookie) return cookie;
    if (this.csrfFallback) return this.csrfFallback;
    const res = await this.fetchImpl('/api/v1/auth/csrf', { method: 'GET', credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!res.ok) throw new ApiError(res.status, 'csrf_unavailable', GENERIC);
    const parsed = CsrfResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new ApiError(0, 'bad_response', GENERIC);
    this.csrfFallback = parsed.data.csrfToken;
    return parsed.data.csrfToken;
  }

  private async send(method: string, path: string, body: unknown, withAuth: boolean): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const token = this.session.getState().accessToken;
    if (withAuth && token) headers['authorization'] = `Bearer ${token}`;
    if (UNSAFE.has(method)) headers['x-csrf-token'] = await this.csrfToken();
    return this.fetchImpl(path, {
      method,
      credentials: 'same-origin',
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  private static async toError(res: Response): Promise<ApiError> {
    const retry = res.headers.get('retry-after');
    const retryAfter = retry && /^\d+$/u.test(retry) ? Number(retry) : null;
    const parsed = ErrorBody.safeParse(await res.json().catch(() => null));
    if (parsed.success) return new ApiError(res.status, parsed.data.error.code, parsed.data.error.message, retryAfter);
    return new ApiError(res.status, 'http_error', GENERIC, retryAfter);
  }

  async request<S extends z.ZodType | undefined = undefined>(method: string, path: string, opts: RequestOptions<S> = {}): Promise<Result<S>> {
    if (!path.startsWith('/api/')) throw new Error('same-origin API paths only');
    const auth = opts.auth ?? true;
    let res = await this.send(method, path, opts.body, auth);
    if (res.status === 401 && auth && !path.startsWith('/api/v1/auth/')) {
      const refreshed = await this.refresh();
      if (!refreshed) {
        this.onAuthLost();
        throw await ApiClient.toError(res);
      }
      res = await this.send(method, path, opts.body, auth);
      if (res.status === 401) {
        this.onAuthLost();
        throw await ApiClient.toError(res);
      }
    }
    if (!res.ok) {
      if (res.status === 403) {
        // A rotated CSRF cookie may be newer than our fallback; drop it so the next call re-reads.
        this.csrfFallback = null;
      }
      throw await ApiClient.toError(res);
    }
    if (res.status === 204 || !opts.schema) return undefined as Result<S>;
    const json: unknown = await res.json().catch(() => null);
    const parsed = opts.schema.safeParse(json);
    if (!parsed.success) throw new ApiError(0, 'bad_response', GENERIC);
    return parsed.data as Result<S>;
  }

  get<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
    return this.request('GET', path, { schema }) as Promise<z.output<S>>;
  }

  post<S extends z.ZodType | undefined = undefined>(path: string, body: unknown, schema?: S, auth = true): Promise<Result<S>> {
    return this.request('POST', path, { body, ...(schema ? { schema } : {}), auth } as RequestOptions<S>);
  }

  private static errorFrom(status: number, body: string, retryAfter: string | null): ApiError {
    const retry = retryAfter && /^\d+$/u.test(retryAfter) ? Number(retryAfter) : null;
    let json: unknown = null;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    const parsed = ErrorBody.safeParse(json);
    if (parsed.success) return new ApiError(status, parsed.data.error.code, parsed.data.error.message, retry);
    return new ApiError(status, 'http_error', GENERIC, retry);
  }

  /**
   * Upload one file's raw bytes (R43) with XMLHttpRequest so upload progress events exist. Same-origin
   * only; Bearer + CSRF headers; `Content-Type: application/octet-stream`; single-flight refresh and one
   * retry on 401; the response is parsed with the shared schema (callers map statuses to fixed texts).
   */
  async upload(batchId: string, file: Blob, filename: string, opts: UploadOptions = {}): Promise<ImportDocumentDetailDto> {
    if (!UUID_RE.test(batchId)) throw new Error('invalid batch id');
    const Xhr = this.xhrImpl;
    if (!Xhr) throw new ApiError(0, 'unsupported', GENERIC);
    const url = `/api/v1/imports/${batchId}/documents?filename=${encodeURIComponent(filename)}`;
    const send = async (): Promise<RawResult> => {
      const token = this.session.getState().accessToken;
      const csrf = await this.csrfToken();
      return new Promise<RawResult>((resolve, reject) => {
        const xhr = new Xhr();
        xhr.open('POST', url);
        xhr.setRequestHeader('accept', 'application/json');
        xhr.setRequestHeader('content-type', 'application/octet-stream');
        xhr.setRequestHeader('x-csrf-token', csrf);
        if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
        xhr.upload.onprogress = (e: ProgressEvent) => {
          if (e.lengthComputable && e.total > 0) opts.onProgress?.(Math.min(100, Math.round((e.loaded / e.total) * 100)));
        };
        xhr.onload = () => resolve({ status: xhr.status, body: String(xhr.responseText ?? ''), retryAfter: xhr.getResponseHeader('retry-after') });
        xhr.onerror = () => reject(new ApiError(0, 'network', GENERIC));
        xhr.onabort = () => reject(new ApiError(0, 'aborted', GENERIC));
        opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
        xhr.send(file);
      });
    };
    let res = await send();
    if (res.status === 401) {
      if (!(await this.refresh())) {
        this.onAuthLost();
        throw ApiClient.errorFrom(res.status, res.body, res.retryAfter);
      }
      res = await send();
      if (res.status === 401) {
        this.onAuthLost();
        throw ApiClient.errorFrom(res.status, res.body, res.retryAfter);
      }
    }
    if (res.status < 200 || res.status >= 300) throw ApiClient.errorFrom(res.status, res.body, res.retryAfter);
    let json: unknown = null;
    try {
      json = JSON.parse(res.body);
    } catch {
      json = null;
    }
    const parsed = ImportDocumentDetail.safeParse(json);
    if (!parsed.success) throw new ApiError(0, 'bad_response', GENERIC);
    return parsed.data;
  }

  /**
   * Download a file response (exports, originals): fetch with the Bearer token, then save it through a
   * temporary object URL and an anchor with `download`. The URL is revoked immediately afterwards.
   */
  async download(path: string, fallbackName: string): Promise<void> {
    if (!path.startsWith('/api/')) throw new Error('same-origin API paths only');
    const get = () => {
      const token = this.session.getState().accessToken;
      return this.fetchImpl(path, { method: 'GET', credentials: 'same-origin', headers: token ? { authorization: `Bearer ${token}` } : {} });
    };
    let res = await get();
    if (res.status === 401) {
      if (!(await this.refresh())) {
        this.onAuthLost();
        throw await ApiClient.toError(res);
      }
      res = await get();
    }
    if (!res.ok) throw await ApiClient.toError(res);
    const blob = await res.blob();
    const name = SAFE_DOWNLOAD_NAME.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
    const href = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      a.rel = 'noopener';
      document.body.append(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(href);
    }
  }

  /** Single-flight refresh shared by concurrent callers; serialized across tabs via Web Locks. */
  refresh(): Promise<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const run = () => this.doRefresh();
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    const p = (locks ? (locks.request('fr-session-refresh', run) as unknown as Promise<boolean>) : run()).finally(() => {
      this.refreshInFlight = null;
    });
    this.refreshInFlight = p;
    return p;
  }

  private async doRefresh(): Promise<boolean> {
    try {
      const res = await this.send('POST', '/api/v1/auth/refresh', {}, false);
      if (!res.ok) return false;
      const parsed = RefreshResponse.safeParse(await res.json().catch(() => null));
      if (!parsed.success) return false;
      this.session.getState().setSession(parsed.data.accessToken, parsed.data.user);
      this.csrfFallback = null;
      return true;
    } catch {
      return false;
    }
  }
}
