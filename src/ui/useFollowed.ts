import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Storage } from '../storage/Storage';
import { FollowedPlans, type FollowedPlan } from '../sync/Followed';

const NONE: readonly FollowedPlan[] = [];

/**
 * The plans I follow (PPL-3), loaded read-only from `storage` and kept current: reloaded when
 * the page comes back into view, retried when the browser comes back online. Only signed in:
 * the demo follows nobody. Only the plans the calendar draws are loaded, so a long list of
 * hidden people costs nothing.
 */
export function useFollowed(storage: Storage, calendarIds: readonly string[]): readonly FollowedPlan[] {
  const plans = useMemo(() => (storage.kind === 'drive' ? new FollowedPlans(storage) : null), [storage]);
  const key = JSON.stringify(calendarIds);
  const snapshot = useSyncExternalStore(plans?.subscribe ?? noSubscribe, plans?.getSnapshot ?? noSnapshot);

  useEffect(() => {
    void plans?.set(JSON.parse(key) as string[]);
  }, [plans, key]);

  useEffect(() => {
    if (!plans) return;
    const onVisible = () => document.visibilityState === 'visible' && void plans.refresh();
    const onOnline = () => void plans.refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      plans.dispose();
    };
  }, [plans]);

  return snapshot;
}

const noSubscribe = () => () => {};
const noSnapshot = () => NONE;
