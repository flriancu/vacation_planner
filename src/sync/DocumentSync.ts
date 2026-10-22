import { absorb } from '../domain/absorb';
import { hasLocalWins, merge } from '../domain/merge';
import { skippedCount } from '../domain/migrate';
import { live, type PlanDoc } from '../domain/schema';
import { fileGone, isRetryable, needsSignIn, type Storage } from '../storage/Storage';
import type { ReplicaStore } from './Replica';
import { retryDelay } from './retry';

/** `signin`: the Google session expired; changes are kept until the user reconnects. */
export type SaveState = 'saved' | 'saving' | 'error' | 'signin';

export type SyncNotice = { kind: 'carried' | 'skipped' | 'floating'; count: number };

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
  /** Debounce before saving (NF-4). */
  saveDelayMs?: number;
  /** How long `close` waits for a last save before giving up on it (sign-out must not hang). */
  closeWaitMs?: number;
}

/** No plan file, but one in the Drive trash: restore it, or start a new one on purpose. */
export class PlanRemovedError extends Error {
  constructor() {
    super('Your plan file is in the Google Drive trash');
  }
}

/** No plan file anywhere in Drive, but this device has a copy of one: restore it, or start anew. */
export class PlanMissingError extends Error {
  constructor() {
    super('Your plan file is no longer in Google Drive; this device has a copy of it');
  }
}

/** How to open: as usual; a new plan instead of the one in the trash; or the plan from this device's copy. */
export type OpenMode = 'normal' | 'new' | 'restore';

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
  private loadAttempts = 0;
  private loadTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(private readonly options: SyncOptions) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  /** My plan's id in storage (the Drive file), once open: for sharing it, and to tell it from plans I follow. */
  get calendar(): string {
    return this.calendarId;
  }

  /** True while some change may not be in storage yet. */
  get dirty(): boolean {
    return this.current !== this.saved;
  }

  /** Opens my plan; idempotent. See `OpenMode` for the ways out of a missing or trashed plan. */
  open(how: OpenMode = 'normal'): Promise<void> {
    this.closed = false;
    clearTimeout(this.loadTimer);
    if (this.opening && how === 'normal') return this.opening;
    this.set({ loadError: null });
    this.opening = this.enqueue(() => this.openOwn(how)).then(
      () => {
        this.loadAttempts = 0;
      },
      (e: unknown) => {
        this.opening = null;
        this.set({ loadError: e });
        // What the message promises: a passing problem is tried again, with growing delays.
        if (isRetryable(e) && !this.closed) this.loadTimer = setTimeout(() => void this.open(), retryDelay(this.loadAttempts++));
      },
    );
    return this.opening;
  }

  update = (change: (doc: PlanDoc) => PlanDoc) => {
    // Closed (signed out): a late answer (Google's picker, a slow dialog) must not write the plan
    // back to this device, which signing out has just cleared.
    if (!this.current || this.closed) return;
    this.current = change(this.current);
    this.options.replica?.write(this.current, true, this.calendarId);
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
      if (fileGone(e)) this.reopen();
      else if (needsSignIn(e)) this.set({ saveState: 'signin' });
      // otherwise: a missed refresh is harmless, the next save merges anyway
    });

  /**
   * Stops retrying and makes one last save (sign-out, unmount), waiting for it at most
   * `closeWaitMs`: a Drive that doesn't answer must not keep someone signed in. Resolves true
   * when nothing is left unsaved (otherwise this device's copy keeps it).
   */
  async close(): Promise<boolean> {
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.loadTimer);
    if (this.dirty) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wait = new Promise<void>((resolve) => (timer = setTimeout(resolve, this.options.closeWaitMs ?? 5000)));
      await Promise.race([this.flush(), wait]);
      clearTimeout(timer);
    }
    return !this.dirty;
  }

  dismissNotice(kind: SyncNotice['kind']) {
    this.set({ notices: this.snapshot.notices.filter((n) => n.kind !== kind) });
  }

  private async openOwn(how: OpenMode) {
    const { storage, owner, replica, carry } = this.options;
    const startNew = how === 'new';
    // What this tab had open before (a reopen after its file went away) is kept and merged in.
    const before = startNew ? null : this.current && { doc: this.current, calendarId: this.calendarId };
    const refs = await storage.listCalendars();
    let doc: PlanDoc;
    let duplicates: PlanDoc[] = [];
    this.duplicates = [];
    if (refs.length === 0) {
      const removed = await storage.listRemoved();
      if (how === 'normal' && removed.length > 0) throw new PlanRemovedError();
      const copy = replica?.read();
      // A plan deleted for good comes back from a device's copy only when asked.
      if (how === 'normal' && copy && live(copy.doc.blocks).length > 0) throw new PlanMissingError();
      doc = this.options.init();
      if (startNew) {
        // Copies of the plans this one replaces (on other devices and tabs too) stay out of it.
        const replaces = [...removed.map((r) => r.calendarId), ...(copy?.calendarId ? [copy.calendarId] : [])];
        if (replaces.length) doc = { ...doc, settings: { ...doc.settings, replaces } };
      }
      ({ calendarId: this.calendarId, version: this.version } = await storage.create(doc));
    } else {
      // The oldest file is the plan; any others (two devices creating one at once) are added to
      // it and then moved to the trash. One that can't be read is left alone: it must not keep
      // the plan from opening.
      const [first, ...others] = refs;
      ({ doc, version: this.version } = await storage.load(first!.calendarId));
      this.calendarId = first!.calendarId;
      for (const other of others) {
        const loaded = await storage.load(other.calendarId).catch(() => null);
        if (!loaded) continue;
        duplicates.push(loaded.doc);
        this.duplicates.push(other.calendarId);
      }
    }
    if (owner && doc.owner.googleSub !== owner) throw new OtherOwnerError();
    this.saved = doc;

    let current = doc;
    for (const d of duplicates) current = absorb(current, d);
    // "Start a new plan" means new: a copy of a plan it replaced, here or on any device, stays out.
    const replaced = new Set(doc.settings.replaces ?? []);
    const ours = (c: { doc: PlanDoc; calendarId?: string } | null | undefined) =>
      !!c && c.doc.owner.googleSub === doc.owner.googleSub && !replaced.has(c.calendarId ?? '');
    const kept = startNew ? null : replica?.read();
    if (startNew || (kept && !ours(kept))) replica?.clear();
    if (ours(kept)) current = absorb(current, kept!.doc);
    if (ours(before)) current = absorb(current, before!.doc);
    if (!hasLocalWins(current, doc)) current = doc;
    // Old floating days were turned into annual leave on loading: save that once, so the file
    // no longer holds them and the notice below doesn't come back on every open.
    const converted = doc.converted ?? 0;
    if (converted && current === doc) current = { ...doc };
    duplicates = [];

    const notices: SyncNotice[] = [];
    const demo = carry?.();
    const carried = demo ? live(demo.blocks).length : 0;
    if (demo && carried) {
      current = absorb(current, demo);
      notices.push({ kind: 'carried', count: carried });
    }
    if (converted) notices.push({ kind: 'floating', count: converted });
    const skipped = skippedCount(current);
    if (skipped) notices.push({ kind: 'skipped', count: skipped });

    this.current = current;
    this.set({ doc: current, notices, saveState: this.dirty ? 'saving' : 'saved' });
    if (this.dirty) {
      replica?.write(current, true, this.calendarId);
      this.schedule(0);
    } else {
      replica?.write(current, false, this.calendarId);
      void this.removeDuplicates();
    }
  }

  private async saveRounds() {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const toSave = this.current;
      // No file yet (it is being looked up again): the open that follows saves what's pending.
      if (!toSave || toSave === this.saved || !this.calendarId) return;
      this.set({ saveState: 'saving' });
      const result = await this.options.storage.save(this.calendarId, toSave, this.version);
      if (result.ok) {
        this.version = result.version;
        this.saved = toSave;
        this.options.replica?.write(this.current!, this.dirty, this.calendarId);
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
    if (fileGone(e)) {
      this.reopen();
      return;
    }
    if (needsSignIn(e)) {
      this.set({ saveState: 'signin' });
      return;
    }
    this.set({ saveState: 'error', saveError: e });
    if (isRetryable(e)) this.schedule(retryDelay(this.attempts++));
  }

  /**
   * The plan file went away (another device merged it into an older one and trashed it, or it
   * was deleted): look for the plan again, and add what this tab has to it.
   */
  private reopen() {
    if (this.closed) return; // signed out meanwhile: never again, and never with another account
    this.opening = null;
    this.calendarId = '';
    void this.open();
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
