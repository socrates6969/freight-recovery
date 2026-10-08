/**
 * Canonical JSON: recursively key-sorted, no insignificant whitespace. Used for the audit hash chain and
 * packet content hashes, so the same logical value always serializes to the same bytes.
 * - Object keys sorted by UTF-16 code unit order (JS default sort); `undefined` members are omitted.
 * - Arrays keep order; `undefined` array items serialize as `null` (as JSON.stringify does).
 * - Only finite numbers are allowed; bigint, functions, symbols and non-plain objects are rejected
 *   (Date must be converted to an ISO string by the caller).
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, new Set());
}

function serialize(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
  const obj = value as object;
  if (seen.has(obj)) throw new TypeError('canonicalJson: cyclic structure');
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      return `[${obj.map((v) => (v === undefined ? 'null' : serialize(v, seen))).join(',')}]`;
    }
    const proto = Object.getPrototypeOf(obj) as unknown;
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError('canonicalJson: only plain objects are supported');
    }
    const record = obj as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize(record[k], seen)}`).join(',')}}`;
  } finally {
    seen.delete(obj);
  }
}
