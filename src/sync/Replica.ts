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
  /** The copy, and the storage calendar (Drive file) it was a copy of. */
  read(): { doc: PlanDoc; calendarId?: string } | null;
  /** `unsaved`: holds changes that may not be in Drive yet. */
  write(doc: PlanDoc, unsaved: boolean, calendarId?: string): void;
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
  calendarId?: string;
}

const PREFIX = 'vacation-planner.replica.';

/** The copy in localStorage, one per Google account, shared by the tabs of this browser. */
export class LocalReplica implements ReplicaStore {
  constructor(
    private readonly key: string,
    private readonly account?: ReplicaAccount,
    private readonly store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = safeLocalStorage(),
  ) {}

  read(): { doc: PlanDoc; calendarId?: string } | null {
    const s = this.stored();
    return s ? { doc: s.doc, ...(s.calendarId && { calendarId: s.calendarId }) } : null;
  }

  write(doc: PlanDoc, unsaved: boolean, calendarId?: string) {
    // Another tab may have written records this one hasn't seen: keep them (merge by time).
    const before = this.stored();
    const merged = before ? merge(doc, before.doc) : doc;
    // Still unsaved if this change is, or if the copy held something (another tab's) that `doc` lacks.
    const stillUnsaved = unsaved || (!!before?.unsaved && hasLocalWins(before.doc, doc));
    try {
      const stored: Stored = {
        unsaved: stillUnsaved,
        doc: toFile(merged),
        ...(this.account && { account: this.account }),
        ...((calendarId ?? before?.calendarId) && { calendarId: calendarId ?? before?.calendarId }),
      };
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

  private stored(): { unsaved: boolean; doc: PlanDoc; calendarId?: string } | null {
    try {
      const raw = this.store?.getItem(this.key);
      if (!raw) return null;
      const value = JSON.parse(raw) as Partial<Stored>;
      return {
        unsaved: value.unsaved === true,
        doc: migrate(value.doc),
        ...(typeof value.calendarId === 'string' && { calendarId: value.calendarId }),
      };
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
  let keys: string[] = [];
  try {
    keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k): k is string => !!k?.startsWith(PREFIX));
  } catch {
    return out; // unreadable storage: nothing to offer
  }
  for (const key of keys) {
    try {
      const value = JSON.parse(store.getItem(key) ?? 'null') as Partial<Stored> | null;
      const a = value?.account;
      if (value?.unsaved === true && a && typeof a.email === 'string' && a.email && typeof a.name === 'string') {
        out.push({ sub: key.slice(PREFIX.length), email: a.email, name: a.name.trim() || a.email.split('@')[0]! });
      }
    } catch {
      // one unreadable copy says nothing about the others
    }
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
