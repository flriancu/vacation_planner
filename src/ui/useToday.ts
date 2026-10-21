import { useEffect, useState } from 'react';
import type { ISODate } from '../domain/dates';

/** Today in the viewer's time zone, as a whole day. */
export function localToday(): ISODate {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Today, kept current: re-read just after local midnight and whenever the page comes back into
 * view (a tab left open overnight, or a laptop waking up, would otherwise keep yesterday).
 */
export function useToday(): ISODate {
  const [today, setToday] = useState(localToday);

  useEffect(() => {
    const check = () => setToday(localToday());
    let timer: number | undefined;
    const atMidnight = () => {
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
      timer = window.setTimeout(() => {
        check();
        atMidnight();
      }, midnight.getTime() - now.getTime());
    };
    atMidnight();
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, []);

  return today;
}
