import { hasLocalWins, merge } from '../domain/merge';
import { migrate, toFile } from '../domain/migrate';
import type { PlanDoc } from '../domain/schema';

/**
 * A copy of the plan kept on this device, written synchronously on every change. Saving to
 * Drive takes two requests and a debounce; a reload, a closed tab, a crash or an expired
 * session can cut that short. The copy survives all of them, and the next open merges it back
 * (records are merged by time, so replaying it is always safe).
 */
export interface ReplicaStore {
  read(): PlanDoc | null;
  /** `unsaved`: holds changes that may not be in Drive yet. */
  write(doc: PlanDoc, unsaved: boolean): void;
  hasUnsaved(): boolean;
  clear(): void;
}

interface Stored {
  unsaved: boolean;
  doc: unknown;
}

/** The copy in localStorage, one per Google account, shared by the tabs of this browser. */
export class LocalReplica implements ReplicaStore {
  constructor(
    private readonly key: string,
    private readonly store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = safeLocalStorage(),
  ) {}

  read(): PlanDoc | null {
    return this.stored()?.doc ?? null;
  }

  write(doc: PlanDoc, unsaved: boolean) {
    // Another tab may have written records this one hasn't seen: keep them (merge by time).
    const before = this.stored();
    const merged = before ? merge(doc, before.doc) : doc;
    // Still unsaved if this change is, or if the copy held something (another tab's) that `doc` lacks.
    const stillUnsaved = unsaved || (!!before?.unsaved && hasLocalWins(before.doc, doc));
    try {
      this.store?.setItem(this.key, JSON.stringify({ unsaved: stillUnsaved, doc: toFile(merged) } satisfies Stored));
    } catch {
      // storage full or blocked: Drive is still the copy that counts
    }
  }

  hasUnsaved(): boolean {
    return this.stored()?.unsaved ?? false;
  }

  clear() {
    try {
      this.store?.removeItem(this.key);
    } catch {
      // nothing to clear
    }
  }

  private stored(): { unsaved: boolean; doc: PlanDoc } | null {
    try {
      const raw = this.store?.getItem(this.key);
      if (!raw) return null;
      const value = JSON.parse(raw) as Partial<Stored>;
      return { unsaved: value.unsaved === true, doc: migrate(value.doc) };
    } catch {
      return null; // unreadable: ignore it rather than break the app
    }
  }
}

/** The replica key for a Google account. */
export const replicaKey = (sub: string) => `vacation-planner.replica.${sub}`;

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
