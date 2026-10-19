/**
 * Local file downloads for the public app. A Blob object URL is created, clicked and revoked; nothing is
 * stored in the browser and nothing leaves it. (blob: URLs are not covered by the page CSP's connect-src.)
 */

const FILENAME_SAFE = /[^A-Za-z0-9._-]+/gu;

/** A filename made of safe characters only, with the given extension. */
export function safeFilename(stem: string, extension: string): string {
  const cleaned = stem.replace(FILENAME_SAFE, '-').replace(/^-+|-+$/gu, '').slice(0, 60) || 'scoup';
  return `${cleaned}.${extension}`;
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before the URL is revoked.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Lower-case hex SHA-256 of a UTF-8 string (WebCrypto; empty string when the API is unavailable). */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return '';
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `YYYY-MM-DD` of an instant in UTC. */
export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}