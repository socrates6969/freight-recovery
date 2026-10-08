/**
 * Strict parser for the `next` redirect parameter: only same-origin relative paths are accepted
 * (open-redirect prevention). Returns a fallback for anything else.
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/claims'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  // Reject backslashes and control characters (the whole point of this check).
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001F\u007F]/u.test(raw)) return fallback;
  let url: URL;
  try {
    url = new URL(raw, 'https://app.invalid');
  } catch {
    return fallback;
  }
  if (url.origin !== 'https://app.invalid') return fallback;
  if (url.pathname.startsWith('/login')) return fallback;
  return `${url.pathname}${url.search}`;
}

/** Read the opaque token from a URL fragment like `#token=...` (never sent to any server). */
export function tokenFromHash(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(h);
  const t = params.get('token');
  if (!t || t.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(t)) return null;
  return t;
}
