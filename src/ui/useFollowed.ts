import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Storage } from '../storage/Storage';
import { FollowedPlans, type FollowedPlan } from '../sync/Followed';

const NONE: readonly FollowedPlan[] = [];

/**
 * The plans I follow (PPL-3), loaded read-only from `storage` and kept current: reloaded when
 * the page comes back into view. Only signed in: the demo follows nobody.
 */
export function useFollowed(storage: Storage, calendarIds: readonly string[]): readonly FollowedPlan[] {
  const plans = useMemo(() => (storage.kind === 'drive' ? new FollowedPlans(storage) : null), [storage]);
  const key = calendarIds.join('\n');
  const snapshot = useSyncExternalStore(plans?.subscribe ?? noSubscribe, plans?.getSnapshot ?? noSnapshot);

  useEffect(() => {
    void plans?.set(key ? key.split('\n') : []);
  }, [plans, key]);

  useEffect(() => {
    if (!plans) return;
    const onVisible = () => document.visibilityState === 'visible' && void plans.refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [plans]);

  return snapshot;
}

const noSubscribe = () => () => {};
const noSnapshot = () => NONE;
