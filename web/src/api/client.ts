/**
 * Typed API client. Same-origin only (`/api/...`), JSON only, Bearer token from memory, CSRF header on
 * unsafe methods, single-flight refresh on 401 (serialized across tabs with the Web Locks API when
 * available), and Zod parsing of EVERY response (a parse failure never renders raw data).
 */
import { CsrfResponse, ErrorBody, RefreshResponse } from '@fr/shared';
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

export class ApiClient {
  private csrfFallback: string | null = null;
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly session: SessionStore,
    private readonly onAuthLost: () => void,
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
