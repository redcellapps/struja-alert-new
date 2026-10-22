import { useEffect, useState } from 'react';

/** The current time, re-read every `intervalMs` (1 s for a running countdown, 30 s elsewhere). */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
