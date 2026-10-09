/**
 * Request -> API key attribution (Q13): while a key-authenticated request is in flight its request id
 * maps to the key's public id, so every audit event that request writes (with actor role API_KEY) gets
 * `metadata.viaApiKey` without each call site having to pass it. Bounded; entries are released when the
 * response is sent or the request is aborted.
 */
const MAX_IN_FLIGHT = 10_000;
const inFlight = new Map<string, string>();

export function registerApiKeyRequest(requestId: string, keyId: string): void {
  if (inFlight.size >= MAX_IN_FLIGHT) {
    const oldest = inFlight.keys().next();
    if (!oldest.done) inFlight.delete(oldest.value);
  }
  inFlight.set(requestId, keyId);
}

export function releaseApiKeyRequest(requestId: string): void {
  inFlight.delete(requestId);
}

export function apiKeyFor(requestId: string | null | undefined): string | undefined {
  return requestId ? inFlight.get(requestId) : undefined;
}
