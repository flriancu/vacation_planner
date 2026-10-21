import { carryBlocks } from '../domain/carry';
import { hasLocalWins, merge } from '../domain/merge';
import { skippedCount } from '../domain/migrate';
import type { PlanDoc } from '../domain/schema';
import { isRetryable, needsSignIn, type Storage } from '../storage/Storage';
import type { ReplicaStore } from './Replica';
import { retryDelay } from './retry';

/** `signin`: the Google session expired; changes are kept until the user reconnects. */
export type SaveState = 'saved' | 'saving' | 'error' | 'signin';

export type SyncNotice = { kind: 'carried'; count: number } | { kind: 'skipped'; count: number };

export interface SyncSnapshot {
  doc: PlanDoc | null;
  saveState: SaveState;
  /** Why the last save failed, while `saveState` is `error`. */
  saveError: unknown;
  loadError: unknown;
  notices: readonly SyncNotice[];
}

export interface SyncOptions {
  storage: Storage;
  /** A new plan, when I have none yet. */
  init: () => PlanDoc;
  /** The signed-in account: a plan file of another account is refused. */
  owner?: string;
  replica?: ReplicaStore;
  /** A plan whose blocks are added to mine once it is open (the demo, at sign-in). */
  carry?: () => PlanDoc | null;
  newId: () => string;
  /** Debounce before saving (NF-4). */
  saveDelayMs?: number;
}

/** No plan file, but one in the Drive trash: restore it, or start a new one on purpose. */
export class PlanRemovedError extends Error {
  constructor() {
    super('Your plan file is in the Google Drive trash');
  }
}

export class OtherOwnerError extends Error {
  constructor() {
    super('This plan file belongs to another Google account');
  }
}

/** Saving kept meeting newer versions from another device; worth another try later. */
export class SaveConflictError extends Error {
  readonly retryable = true;
  constructor() {
    super('Another device kept saving at the same time');
  }
}

const MAX_ROUNDS = 3;

/**
 * The open plan and its way to storage (DESIGN §4): open (and create, merge duplicates, merge
 * this device's copy, carry the demo in), auto-save with a debounce, merge on conflicts, retry
 * with growing delays, pick up other devices' changes on `refresh`, save what's left on `close`.
 * Every storage call runs in one queue, so they never overlap. No React and no DOM here: the
 * `useDocument` hook connects it to the page's events.
 */
export class DocumentSync {
  private snapshot: SyncSnapshot = { doc: null, saveState: 'saved', saveError: null, loadError: null, notices: [] };
  private readonly listeners = new Set<() => void>();
  private opening: Promise<void> | null = null;
  private current: PlanDoc | null = null;
  private saved: PlanDoc | null = null;
  private calendarId = '';
  private version = '';
  private duplicates: string[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private closed = false;

  constructor(private readonly options: SyncOptions) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  /** True while some change may not be in storage yet. */
  get dirty(): boolean {
    return this.current !== this.saved;
  }

  /** Opens my plan; idempotent. `startNew` creates a new plan even if one is in the trash. */
  open(startNew = false): Promise<void> {
    this.closed = false;
    if (this.opening && !startNew) return this.opening;
    this.set({ loadError: null });
    this.opening = this.enqueue(() => this.openOwn(startNew)).catch((e: unknown) => {
      this.opening = null;
      this.set({ loadError: e });
    });
    return this.opening;
  }

  update = (change: (doc: PlanDoc) => PlanDoc) => {
    if (!this.current) return;
    this.current = change(this.current);
    this.options.replica?.write(this.current, true);
    this.set({ doc: this.current, saveState: this.snapshot.saveState === 'signin' ? 'signin' : 'saving' });
    this.schedule(this.options.saveDelayMs ?? 1500);
  };

  /** Saves now (and waits). Never rejects: failures become `saveState`. */
  flush = (): Promise<void> => {
    clearTimeout(this.timer);
    return this.enqueue(() => this.saveRounds()).then(
      () => {
        this.attempts = 0;
      },
      (e: unknown) => this.failed(e),
    );
  };

  /** Picks up what other devices saved meanwhile (a tab coming back into view). */
  refresh = (): Promise<void> =>
    this.enqueue(async () => {
      if (!this.current || !this.calendarId) return;
      if ((await this.options.storage.version(this.calendarId)) === this.version) return;
      const remote = await this.options.storage.load(this.calendarId);
      this.version = remote.version;
      const mine = this.current;
      this.current = merge(mine, remote.doc);
      this.saved = hasLocalWins(mine, remote.doc) ? remote.doc : this.current;
      this.set({ doc: this.current });
      if (this.dirty) this.schedule(0);
    }).catch((e: unknown) => {
      if (needsSignIn(e)) this.set({ saveState: 'signin' });
      // otherwise: a missed refresh is harmless, the next save merges anyway
    });

  /** Saves what's left and stops retrying (sign-out, unmount). Resolves true when nothing is left unsaved. */
  async close(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.dirty) await this.flush();
    this.closed = true;
    clearTimeout(this.timer);
    return !this.dirty;
  }

  dismissNotice(kind: SyncNotice['kind']) {
    this.set({ notices: this.snapshot.notices.filter((n) => n.kind !== kind) });
  }

  private async openOwn(startNew: boolean) {
    const { storage, owner, replica, carry } = this.options;
    const refs = await storage.listCalendars();
    let doc: PlanDoc;
    if (refs.length === 0) {
      if (!startNew && (await storage.listRemoved()).length > 0) throw new PlanRemovedError();
      doc = this.options.init();
      ({ calendarId: this.calendarId, version: this.version } = await storage.create(doc));
    } else {
      // The oldest file is the plan; any others (two devices creating one at once) merge into it.
      const [first, ...others] = refs;
      ({ doc, version: this.version } = await storage.load(first!.calendarId));
      this.calendarId = first!.calendarId;
      this.duplicates = others.map((r) => r.calendarId);
    }
    if (owner && doc.owner.googleSub !== owner) throw new OtherOwnerError();
    this.saved = doc;

    let current = doc;
    for (const id of this.duplicates) current = merge((await storage.load(id)).doc, current);
    const kept = replica?.read();
    if (kept && kept.owner.googleSub === doc.owner.googleSub) current = merge(kept, current);
    if (!hasLocalWins(current, doc)) current = doc;

    const notices: SyncNotice[] = [];
    const demo = carry?.();
    if (demo) {
      const carried = carryBlocks(current, demo, this.options.newId);
      if (carried.count) notices.push({ kind: 'carried', count: carried.count });
      current = carried.doc;
    }
    const skipped = skippedCount(current);
    if (skipped) notices.push({ kind: 'skipped', count: skipped });

    this.current = current;
    this.set({ doc: current, notices, saveState: this.dirty ? 'saving' : 'saved' });
    if (this.dirty) {
      replica?.write(current, true);
      this.schedule(0);
    } else {
      replica?.write(current, false);
      void this.removeDuplicates();
    }
  }

  private async saveRounds() {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const toSave = this.current;
      if (!toSave || toSave === this.saved) return;
      this.set({ saveState: 'saving' });
      const result = await this.options.storage.save(this.calendarId, toSave, this.version);
      if (result.ok) {
        this.version = result.version;
        this.saved = toSave;
        this.options.replica?.write(this.current!, this.dirty);
        this.set({ saveState: this.dirty ? 'saving' : 'saved', saveError: null });
        void this.removeDuplicates();
        if (this.dirty) this.schedule(this.options.saveDelayMs ?? 1500);
        return;
      }
      // Another device saved first: take its version, keep my newer records, try again.
      const remote = await this.options.storage.load(this.calendarId);
      this.version = remote.version;
      this.current = merge(this.current!, remote.doc);
      this.saved = remote.doc;
      this.set({ doc: this.current });
    }
    throw new SaveConflictError();
  }

  private failed(e: unknown) {
    if (needsSignIn(e)) {
      this.set({ saveState: 'signin' });
      return;
    }
    this.set({ saveState: 'error', saveError: e });
    if (isRetryable(e)) this.schedule(retryDelay(this.attempts++));
  }

  private async removeDuplicates() {
    const ids = this.duplicates;
    this.duplicates = [];
    for (const id of ids) await this.options.storage.remove(id).catch(() => {}); // the next open tries again
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    if (this.closed) return;
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op, op);
    this.queue = run.catch(() => {});
    return run;
  }

  private set(patch: Partial<SyncSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}
