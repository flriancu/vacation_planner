import { UnsupportedPlanError } from '../domain/migrate';
import { live, type PlanDoc } from '../domain/schema';
import { isRetryable, needsSignIn, type Storage } from '../storage/Storage';
import { retryDelay } from './retry';

/**
 * Where a plan I follow stands:
 * - `ready`: loaded and current as of the last look;
 * - `stale`: loaded earlier, but the last look failed for a passing reason (offline, Google
 *   busy); what was loaded is still shown, and it is tried again;
 * - `waiting`: never loaded yet, for a passing reason; tried again;
 * - `signIn`: the Google session ended; nothing is shown until I sign in again;
 * - `gone`: no longer shared with me, or deleted;
 * - `unsupported`: not a plan this version can read (another file, a newer version, too big).
 */
export type FollowedState = 'loading' | 'ready' | 'stale' | 'waiting' | 'signIn' | 'gone' | 'unsupported';

/** One plan I follow (PPL-3): someone else's, read-only. */
export interface FollowedPlan {
  calendarId: string;
  state: FollowedState;
  /** Only while `ready` or `stale`: what may be drawn. */
  doc?: PlanDoc;
  /** When `doc` was read (ms since 1970), to say how old a stale one is. */
  loadedAt?: number;
  error?: unknown;
}

/**
 * A plan with more records than this is not drawn: real plans have a few hundred, and a
 * larger one (a broken or hostile file) would make every redraw of my calendar slow.
 */
export const MAX_FOLLOWED_RECORDS = 5000;

/**
 * The plans I follow, read-only: each loaded on its own, so one that can't be read never
 * hides the others; `refresh` reloads only those whose version changed (a tab coming back
 * into view). Passing failures are retried with backoff, and at once when the browser comes
 * back online. No React and no DOM, like DocumentSync.
 */
export class FollowedPlans {
  private plans = new Map<string, FollowedPlan & { version?: string; attempt?: number; timer?: ReturnType<typeof setTimeout> }>();
  private snapshot: readonly FollowedPlan[] = [];
  private readonly listeners = new Set<() => void>();
  private ids: string[] = [];

  constructor(
    private readonly storage: Storage,
    private readonly now: () => number = Date.now,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  /** Follows exactly these calendars: new ones load, dropped ones go. */
  async set(calendarIds: readonly string[]) {
    this.ids = [...new Set(calendarIds)];
    for (const [id, plan] of this.plans) {
      if (this.ids.includes(id)) continue;
      clearTimeout(plan.timer);
      this.plans.delete(id);
    }
    this.emit();
    await Promise.all(this.ids.filter((id) => !this.plans.has(id)).map((id) => this.load(id)));
  }

  /** Reloads the plans that changed since they were read, and retries the ones that failed. */
  refresh = () =>
    Promise.all(
      this.ids.map(async (id) => {
        const plan = this.plans.get(id);
        if (plan?.state === 'loading') return;
        try {
          if (plan?.state === 'ready' && plan.version && (await this.storage.version(id)) === plan.version) return;
        } catch (e) {
          this.failed(id, e);
          return;
        }
        await this.load(id);
      }),
    );

  /** Stops every pending retry (the page or the account is going away). */
  dispose() {
    for (const plan of this.plans.values()) clearTimeout(plan.timer);
    this.ids = [];
    this.plans.clear();
  }

  private async load(id: string) {
    const before = this.plans.get(id);
    clearTimeout(before?.timer);
    if (!before) {
      this.plans.set(id, { calendarId: id, state: 'loading' });
      this.emit();
    }
    try {
      const { doc, version } = await this.storage.load(id);
      if (!this.ids.includes(id)) return; // unfollowed meanwhile
      if (records(doc) > MAX_FOLLOWED_RECORDS) throw new UnsupportedPlanError(`The plan has more than ${MAX_FOLLOWED_RECORDS} records`);
      this.plans.set(id, { calendarId: id, state: 'ready', doc, version, loadedAt: this.now() });
      this.emit();
    } catch (e) {
      if (this.ids.includes(id)) this.failed(id, e);
    }
  }

  private failed(id: string, e: unknown) {
    const before = this.plans.get(id);
    clearTimeout(before?.timer);
    const passing = isRetryable(e);
    const state: FollowedState = needsSignIn(e)
      ? 'signIn'
      : passing
        ? before?.doc
          ? 'stale'
          : 'waiting'
        : e instanceof UnsupportedPlanError
          ? 'unsupported'
          : 'gone';
    const keep = state === 'stale' ? { doc: before!.doc, loadedAt: before!.loadedAt } : {};
    const attempt = passing ? (before?.attempt ?? -1) + 1 : undefined;
    const timer = attempt === undefined ? undefined : setTimeout(() => void this.load(id), retryDelay(attempt));
    this.plans.set(id, { calendarId: id, state, error: e, ...keep, ...(attempt !== undefined && { attempt, timer }) });
    this.emit();
  }

  private emit() {
    this.snapshot = this.ids.map((id) => {
      const { version: _v, attempt: _a, timer: _t, ...plan } = this.plans.get(id) ?? { calendarId: id, state: 'loading' as const };
      return plan;
    });
    for (const listener of this.listeners) listener();
  }
}

function records(doc: PlanDoc): number {
  return Object.keys(doc.blocks).length + Object.keys(doc.people).length + Object.keys(doc.leaveTypes).length + live(doc.following).length;
}
