import { useCallback, useEffect, useState } from 'react';

/** Colour schemes (theme.css) and light/dark mode. */
export const SCHEMES = ['roz', 'neutru', 'contrast'] as const;
export type SchemeId = (typeof SCHEMES)[number];
export type Mode = 'auto' | 'light' | 'dark';

// Same keys as the inline script in index.html, which applies them before first paint.
const SCHEME_KEY = 'vacation-planner.scheme';
const MODE_KEY = 'vacation-planner.mode';
const DARK = '(prefers-color-scheme: dark)';

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: the choice lasts for this page only
  }
}

function apply(scheme: SchemeId, mode: Mode) {
  const root = document.documentElement;
  root.dataset.scheme = scheme;
  root.dataset.mode = mode === 'auto' ? (window.matchMedia(DARK).matches ? 'dark' : 'light') : mode;
}

/** The chosen scheme and mode, remembered in this browser and applied to <html>. */
export function useTheme() {
  const [scheme, setSchemeState] = useState<SchemeId>(() => read(SCHEME_KEY, SCHEMES, 'roz'));
  const [mode, setModeState] = useState<Mode>(() => read(MODE_KEY, ['auto', 'light', 'dark'] as const, 'auto'));

  useEffect(() => {
    apply(scheme, mode);
    if (mode !== 'auto') return;
    const media = window.matchMedia(DARK);
    const follow = () => apply(scheme, mode);
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, [scheme, mode]);

  // Another tab changed them: follow, so the tabs never disagree (or later save a mix of both).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SCHEME_KEY) setSchemeState(read(SCHEME_KEY, SCHEMES, 'roz'));
      if (e.key === MODE_KEY) setModeState(read(MODE_KEY, ['auto', 'light', 'dark'] as const, 'auto'));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setScheme = useCallback((s: SchemeId) => {
    write(SCHEME_KEY, s);
    setSchemeState(s);
  }, []);
  const setMode = useCallback((m: Mode) => {
    write(MODE_KEY, m);
    setModeState(m);
  }, []);

  return { scheme, setScheme, mode, setMode };
}
