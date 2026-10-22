import type { PlanDoc } from '../domain/schema';
import type { Storage } from '../storage/Storage';

/** One plan I follow (PPL-3): someone else's, read-only. */
export interface FollowedPlan {
  calendarId: string;
  /** Present once it has loaded; kept through later failed refreshes. */
  doc?: PlanDoc;
  /** Why it couldn't be read the last time (sharing stopped, file deleted, offline). */
  error?: unknown;
}

/**
 * The plans I follow, read-only: each loaded on its own, so one that can't be read never
 * hides the others; `refresh` reloads only those whose version changed (a tab coming back
 * into view). No React and no DOM, like DocumentSync.
 */
export class FollowedPlans {
  private plans = new Map<string, FollowedPlan & { version?: string }>();
  private snapshot: readonly FollowedPlan[] = [];
  private readonly listeners = new Set<() => void>();
  private ids: string[] = [];

  constructor(private readonly storage: Storage) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  /** Follows exactly these calendars: new ones load, dropped ones go. */
  async set(calendarIds: readonly string[]) {
    this.ids = [...new Set(calendarIds)];
    for (const id of this.plans.keys()) if (!this.ids.includes(id)) this.plans.delete(id);
    this.emit();
    await Promise.all(this.ids.filter((id) => !this.plans.has(id)).map((id) => this.load(id)));
  }

  /** Reloads the plans that changed since they were read. */
  refresh = () =>
    Promise.all(
      this.ids.map(async (id) => {
        const plan = this.plans.get(id);
        try {
          if (plan?.version && (await this.storage.version(id)) === plan.version) return;
        } catch (e) {
          this.plans.set(id, { ...plan, calendarId: id, error: e });
          this.emit();
          return;
        }
        await this.load(id);
      }),
    );

  private async load(id: string) {
    try {
      const { doc, version } = await this.storage.load(id);
      if (!this.ids.includes(id)) return; // unfollowed meanwhile
      this.plans.set(id, { calendarId: id, doc, version });
    } catch (e) {
      if (!this.ids.includes(id)) return;
      this.plans.set(id, { ...this.plans.get(id), calendarId: id, error: e });
    }
    this.emit();
  }

  private emit() {
    this.snapshot = this.ids.map((id) => {
      const { version: _version, ...plan } = this.plans.get(id) ?? { calendarId: id };
      return plan;
    });
    for (const listener of this.listeners) listener();
  }
}
