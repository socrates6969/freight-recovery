/**
 * Lockout math (C5): after `threshold` consecutive failures for one normalized email, the email is
 * locked for min(base * 2^(failures - threshold), max) seconds. Pure functions, unit-tested.
 */
export interface LockoutPolicy {
  threshold: number;
  baseSeconds: number;
  maxSeconds: number;
}

/** Lock duration in seconds after `failures` consecutive failures (0 = no lock). */
export function lockDurationSeconds(failures: number, p: LockoutPolicy): number {
  if (!Number.isInteger(failures) || failures < p.threshold) return 0;
  const exp = failures - p.threshold;
  // 2^exp overflows quickly; cap the exponent so the multiplication stays finite.
  if (exp >= 52) return p.maxSeconds;
  return Math.min(p.baseSeconds * 2 ** exp, p.maxSeconds);
}

/** Integer seconds until `lockedUntil` (rounded up, at least 1) for Retry-After. */
export function retryAfterSeconds(lockedUntil: Date, now: Date): number {
  return Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
}

export function isLocked(lockedUntil: Date | null | undefined, now: Date): lockedUntil is Date {
  return lockedUntil instanceof Date && lockedUntil.getTime() > now.getTime();
}
