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

/** Whose copy it is, so a signed-out page can say which account has changes waiting. */
export interface ReplicaAccount {
  sub: string;
  email: string;
  name: string;
}

interface Stored {
  unsaved: boolean;
  doc: unknown;
  account?: ReplicaAccount;
}

const PREFIX = 'vacation-planner.replica.';

/** The copy in localStorage, one per Google account, shared by the tabs of this browser. */
export class LocalReplica implements ReplicaStore {
  constructor(
    private readonly key: string,
    private readonly account?: ReplicaAccount,
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
      const stored: Stored = { unsaved: stillUnsaved, doc: toFile(merged), ...(this.account && { account: this.account }) };
      this.store?.setItem(this.key, JSON.stringify(stored));
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
export const replicaKey = (sub: string) => `${PREFIX}${sub}`;

/**
 * Every account with changes on this device that haven't reached Drive (a shared computer can
 * hold more than one): signed out, the page offers to sign in as them, so nothing is orphaned.
 */
export function unsavedCopies(store: globalThis.Storage | null = safeLocalStorage()): ReplicaAccount[] {
  const out: ReplicaAccount[] = [];
  if (!store) return out;
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const value = JSON.parse(store.getItem(key) ?? 'null') as Partial<Stored> | null;
      const a = value?.account;
      if (value?.unsaved === true && a && typeof a.email === 'string' && typeof a.name === 'string') {
        out.push({ sub: key.slice(PREFIX.length), email: a.email, name: a.name });
      }
    }
  } catch {
    // unreadable storage: nothing to offer
  }
  return out;
}

/** Deletes the copies that hold nothing unsaved (a sign-out from the error screen). */
export function forgetSavedCopies(store: globalThis.Storage | null = safeLocalStorage()) {
  try {
    const keys = Array.from({ length: store?.length ?? 0 }, (_, i) => store!.key(i)).filter((k): k is string => !!k?.startsWith(PREFIX));
    for (const key of keys) {
      const value = JSON.parse(store!.getItem(key) ?? 'null') as Partial<Stored> | null;
      if (value?.unsaved !== true) store!.removeItem(key);
    }
  } catch {
    // nothing to forget
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
