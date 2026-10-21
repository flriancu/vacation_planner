import { useCallback, useEffect, useRef, useState } from 'react';

/** Width classes (Material 3 window size classes, rounded): compact < 600 px ≤ medium < 1000 px ≤ expanded. */
export type WidthClass = 'compact' | 'medium' | 'expanded';

const QUERIES: [WidthClass, string][] = [
  ['expanded', '(min-width: 1000px)'],
  ['medium', '(min-width: 600px)'],
];

function current(): WidthClass {
  return QUERIES.find(([, q]) => window.matchMedia(q).matches)?.[0] ?? 'compact';
}

export function useWidthClass(): WidthClass {
  const [width, setWidth] = useState<WidthClass>(current);
  useEffect(() => {
    const lists = QUERIES.map(([, q]) => window.matchMedia(q));
    const update = () => setWidth(current());
    for (const l of lists) l.addEventListener('change', update);
    return () => lists.forEach((l) => l.removeEventListener('change', update));
  }, []);
  return width;
}

/**
 * A header that hides while scrolling down and comes back on scroll up (NN/g "partially
 * persistent" header). Returns a ref for the header, whether it is hidden, and its height,
 * so sticky things below it (the weekday row, the side pane) can sit just under it.
 * `hold(ms)` keeps it shown during scrolls the app makes itself (e.g. jumping to today).
 */
export function useHideOnScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [hidden, setHidden] = useState(false);
  const [height, setHeight] = useState(0);
  const holdUntil = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Date.now() < holdUntil.current) {
        last = y;
        setHidden(false);
        return;
      }
      if (Math.abs(y - last) < 8) return; // ignore jitter
      setHidden(y > last && y > 80);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const hold = useCallback((ms: number) => {
    holdUntil.current = Date.now() + ms;
    setHidden(false);
  }, []);

  return { ref, hidden, height, hold };
}

/** A one-time tip or notice the user can close; remembered in this browser. */
export function useDismissed(key: string): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(key, '1');
    } catch {
      // private mode: it comes back next visit
    }
  };
  return [dismissed, dismiss];
}
