import { useEffect, useState } from 'react';

/**
 * The current time, re-read on every full minute (plus a moment, so it is never read just before the
 * minute turns). Outages start and end on the minute, and the countdowns show hours and minutes, so a
 * second hand would only make the screen redraw for nothing.
 */
export function useMinuteNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => clearTimeout(timer);
  }, []);
  return now;
}
