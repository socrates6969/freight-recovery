import { useEffect, useState } from 'react';

/** Seconds remaining until `until` (epoch ms), ticking once per second; 0 when done or unset. */
export function useRetryCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  if (until === null) return 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}
