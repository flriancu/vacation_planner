import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { DocumentSync, type SyncOptions } from '../sync/DocumentSync';

export type { SaveState, SyncNotice } from '../sync/DocumentSync';

/**
 * The open plan document (NF-4), backed by a DocumentSync for `options.storage`. This hook only
 * connects it to React and to the page: save when the page is hidden or left, pick up other
 * devices' changes when it comes back, retry when the network returns, and ask before closing
 * the tab while a change isn't saved yet.
 */
export function useDocument(options: SyncOptions) {
  // One sync per storage (a new account means a new App); the other options are read once.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const sync = useMemo(() => new DocumentSync(options), [options.storage]);
  const snapshot = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  const persistent = options.storage.kind === 'drive';

  useEffect(() => {
    void sync.open();
    return () => void sync.close();
  }, [sync]);

  useEffect(() => {
    const onVisibility = () => void (document.visibilityState === 'hidden' ? sync.flush() : sync.refresh());
    const onLeave = () => void sync.flush();
    const onOnline = () => void sync.flush().then(sync.refresh);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // The demo saves nothing by design (AUTH-3): no question there.
      if (!sync.dirty || !persistent) return;
      void sync.flush();
      e.preventDefault(); // the browser asks "leave the page?"; the device's copy keeps the change either way
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('online', onOnline);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [sync, persistent]);

  return { ...snapshot, sync };
}
