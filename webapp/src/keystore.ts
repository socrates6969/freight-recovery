/**
 * API-key holder. The key lives ONLY in this module's memory: never localStorage,
 * sessionStorage, IndexedDB, cookies or the URL. A page reload forgets it, by design.
 */
let current: string | null = null;
const listeners = new Set<() => void>();

export const keystore = {
  set(key: string): void {
    current = key.trim() || null;
    listeners.forEach((l) => l());
  },
  clear(): void {
    current = null;
    listeners.forEach((l) => l());
  },
  get(): string | null {
    return current;
  },
  has(): boolean {
    return current !== null;
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Shape check only (frk_<8 hex>_<secret>); the server is the authority. */
export function looksLikeKey(k: string): boolean {
  return /^frk_[0-9a-f]{8}_[A-Za-z0-9_-]{20,}$/.test(k.trim());
}
