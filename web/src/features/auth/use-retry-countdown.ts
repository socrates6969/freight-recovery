import { useEffect, useState } from 'react';

export interface RetryWindow {
  /** Retry-After value in whole seconds, as sent by the server. */
  seconds: number;
  /** Epoch ms when the response was received. */
  startedAt: number;
}

/** Remaining whole seconds of a retry window: starts at exactly `seconds`, ticks once per second, ends at 0. */
export function remainingSeconds(w: RetryWindow | null, now: number): number {
  if (w === null) return 0;
  const elapsed = Math.floor(Math.max(0, now - w.startedAt) / 1000);
  return Math.max(0, w.seconds - elapsed);
}

export function useRetryCountdown(w: RetryWindow | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (w === null) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [w]);
  // `now` may predate the window on the first render after it opens; never count time before it.
  return remainingSeconds(w, w === null ? now : Math.max(now, w.startedAt));
}
