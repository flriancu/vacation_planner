import { useCallback, useEffect, useRef, useState } from 'react';
import { merge } from '../domain/merge';
import type { PlanDoc } from '../domain/schema';
import { AuthExpiredError } from '../google/auth';
import type { Storage } from '../storage/Storage';

/** `signin`: the Google session expired; changes are kept in memory until the user reconnects. */
export type SaveState = 'saved' | 'saving' | 'error' | 'signin';

const SAVE_DELAY_MS = 1500;
/** Conflict → reload → merge → save again; more rounds than this means something is wrong. */
const MAX_ROUNDS = 3;

interface Opened {
  doc: PlanDoc;
  calendarId: string;
  version: string;
}

/** Opens my own calendar, or creates it on first use. */
async function openOwn(storage: Storage, init: () => PlanDoc): Promise<Opened> {
  const own = (await storage.listCalendars()).find((c) => c.writable);
  if (own) {
    const { doc, version } = await storage.load(own.calendarId);
    return { doc, calendarId: own.calendarId, version };
  }
  const doc = init();
  const { calendarId, version } = await storage.create(doc);
  return { doc, calendarId, version };
}

/**
 * The open plan document, with auto-save (NF-4): saves 1.5 s after the last change, and at
 * once when the page is hidden. Saves never overlap. When another device saved in between,
 * the remote version is merged record by record and saved again (DESIGN §4.3).
 */
export function useDocument(storage: Storage, init: () => PlanDoc) {
  const [doc, setDoc] = useState<PlanDoc | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [loadError, setLoadError] = useState<unknown>(null);

  const opening = useRef<Promise<Opened> | null>(null);
  const current = useRef<PlanDoc | null>(null);
  const saved = useRef<PlanDoc | null>(null);
  const calendarId = useRef('');
  const version = useRef('');
  const chain = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    // StrictMode runs effects twice; the ref makes sure we open (and maybe create) only once.
    opening.current ??= openOwn(storage, init);
    let cancelled = false;
    opening.current.then(
      (o) => {
        if (cancelled) return;
        calendarId.current = o.calendarId;
        version.current = o.version;
        current.current = saved.current = o.doc;
        setDoc(o.doc);
      },
      (e: unknown) => !cancelled && setLoadError(e),
    );
    return () => {
      cancelled = true;
    };
    // `init` is only used for the first open.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [storage]);

  const saveRounds = useCallback(async () => {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const toSave = current.current;
      if (!toSave || toSave === saved.current) return;
      const result = await storage.save(calendarId.current, toSave, version.current);
      if (result.ok) {
        version.current = result.version;
        saved.current = toSave;
        setSaveState(current.current === toSave ? 'saved' : 'saving');
        return;
      }
      // Another device saved first: take its version, keep my newer records, try again.
      const remote = await storage.load(calendarId.current);
      const merged = merge(current.current!, remote.doc);
      version.current = remote.version;
      current.current = merged;
      setDoc(merged);
    }
    throw new Error('save kept conflicting');
  }, [storage]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    chain.current = chain.current.then(() =>
      saveRounds().catch((e: unknown) => setSaveState(e instanceof AuthExpiredError ? 'signin' : 'error')),
    );
    return chain.current;
  }, [saveRounds]);

  const update = useCallback(
    (change: (doc: PlanDoc) => PlanDoc) => {
      if (!current.current) return;
      const next = change(current.current);
      current.current = next;
      setDoc(next);
      setSaveState('saving');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && void flush();
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [flush]);

  return { doc, saveState, loadError, update, flush };
}
