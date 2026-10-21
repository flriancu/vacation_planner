import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { live, newPlanDoc, typeByKey, type PlanDoc } from '../../src/domain/schema';
import { addRecord } from '../../src/domain/schema';
import { MemoryStorage } from '../../src/storage/MemoryStorage';
import type { SaveResult } from '../../src/storage/Storage';
import { DocumentSync, OtherOwnerError, PlanRemovedError, type SyncOptions } from '../../src/sync/DocumentSync';
import { LocalReplica } from '../../src/sync/Replica';
import { testContext } from '../fixtures/builder';

/** MemoryStorage with switches: fail the next saves, or let a save skip the version check (the Drive race). */
class TestStorage extends MemoryStorage {
  failSaves: unknown[] = [];
  ignoreVersion = false;
  saves = 0;

  override async save(calendarId: string, doc: PlanDoc, baseVersion: string): Promise<SaveResult> {
    this.saves++;
    const failure = this.failSaves.shift();
    if (failure) throw failure;
    return super.save(calendarId, doc, this.ignoreVersion ? await this.version(calendarId) : baseVersion);
  }
}

class MapStore {
  readonly items = new Map<string, string>();
  getItem = (k: string) => this.items.get(k) ?? null;
  setItem = (k: string, v: string) => void this.items.set(k, v);
  removeItem = (k: string) => void this.items.delete(k);
}

const OWNER = 'sub-1';
const ctx = testContext();
const init = () => newPlanDoc({ googleSub: OWNER, personName: 'Me' }, ctx).doc;
let ids = 0;
const newId = () => `new-${++ids}`;

function sync(storage: MemoryStorage, extra: Partial<SyncOptions> = {}) {
  return new DocumentSync({ storage, init, owner: OWNER, newId, saveDelayMs: 1500, ...extra });
}

/** Adds a planned annual-leave block, the way the editor does. */
function addBlock(s: DocumentSync, start: string, note?: string) {
  s.update((d) => {
    const personId = live(d.people)[0]!.id;
    const typeId = typeByKey(d, 'annual')!.id;
    return addRecord(d, 'blocks', { personId, typeId, start, end: start, status: 'planned', ...(note && { note }) }, ctx).doc;
  });
}

async function storedBlocks(storage: MemoryStorage) {
  const [ref] = await storage.listCalendars();
  return live((await storage.load(ref!.calendarId)).doc.blocks)
    .map((b) => b.start)
    .sort();
}

const retryable = Object.assign(new Error('503'), { retryable: true });
const signin = Object.assign(new Error('expired'), { needsSignIn: true });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('DocumentSync', () => {
  it('creates my plan on first use and saves edits after the debounce', async () => {
    const storage = new TestStorage();
    const s = sync(storage);
    await s.open();
    addBlock(s, '2027-03-01');
    expect(s.getSnapshot().saveState).toBe('saving');
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.getSnapshot().saveState).toBe('saved');
    expect(await storedBlocks(storage)).toEqual(['2027-03-01']);
  });

  it('keeps an edit made right before the page died, and saves it on the next open', async () => {
    const storage = new TestStorage();
    const store = new MapStore();
    const replica = () => new LocalReplica('r', store);
    const first = sync(storage, { replica: replica() });
    await first.open();
    addBlock(first, '2027-03-01'); // and the tab is closed 300 ms later: no save ever runs
    expect(await storedBlocks(storage)).toEqual([]);

    const next = sync(storage, { replica: replica() });
    await next.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(await storedBlocks(storage)).toEqual(['2027-03-01']);
    expect(replica().hasUnsaved()).toBe(false);
  });

  it('retries a failed save by itself, with growing delays', async () => {
    const storage = new TestStorage();
    const s = sync(storage);
    await s.open();
    storage.failSaves = [retryable, retryable];
    addBlock(s, '2027-03-01');
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.getSnapshot().saveState).toBe('error');
    await vi.advanceTimersByTimeAsync(3000); // first retry after 2–3 s: fails again
    expect(storage.saves).toBe(2);
    await vi.advanceTimersByTimeAsync(5000); // second retry after 4–5 s: works
    expect(s.getSnapshot().saveState).toBe('saved');
    expect(await storedBlocks(storage)).toEqual(['2027-03-01']);
  });

  it('does not retry by itself what retrying cannot fix, but "try again" works', async () => {
    const storage = new TestStorage();
    const s = sync(storage);
    await s.open();
    storage.failSaves = [new Error('403 forbidden')];
    addBlock(s, '2027-03-01');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(storage.saves).toBe(1);
    expect(s.getSnapshot().saveState).toBe('error');
    await s.flush();
    expect(s.getSnapshot().saveState).toBe('saved');
  });

  it('asks to sign in again on an expired session, and keeps that state while editing', async () => {
    const storage = new TestStorage();
    const s = sync(storage);
    await s.open();
    storage.failSaves = [signin, signin];
    addBlock(s, '2027-03-01');
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.getSnapshot().saveState).toBe('signin');
    addBlock(s, '2027-03-02');
    expect(s.getSnapshot().saveState).toBe('signin');
  });

  it('repairs an edit lost to two devices writing at the same moment', async () => {
    const storage = new TestStorage();
    const store = new MapStore();
    const phone = sync(storage, { replica: new LocalReplica('phone', store) });
    const laptop = sync(storage);
    await phone.open();
    await laptop.open();
    addBlock(phone, '2027-03-01');
    await phone.flush();
    // The laptop checked the version just before the phone wrote, then wrote over it.
    storage.ignoreVersion = true;
    addBlock(laptop, '2027-04-01');
    await laptop.flush();
    storage.ignoreVersion = false;
    expect(await storedBlocks(storage)).toEqual(['2027-04-01']);
    // The phone comes back into view: it sees a new version, merges, and saves its block back.
    await phone.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(await storedBlocks(storage)).toEqual(['2027-03-01', '2027-04-01']);
  });

  it('picks up what another device saved when the page comes back into view', async () => {
    const storage = new TestStorage();
    const a = sync(storage);
    const b = sync(storage);
    await a.open();
    await b.open();
    addBlock(a, '2027-03-01');
    await a.flush();
    await b.refresh();
    expect(live(b.getSnapshot().doc!.blocks).map((x) => x.start)).toEqual(['2027-03-01']);
    expect(b.dirty).toBe(false);
  });

  it('merges duplicate plan files into the oldest and removes the others', async () => {
    const storage = new TestStorage();
    const a = sync(storage);
    await a.open();
    addBlock(a, '2027-03-01');
    await a.flush();
    const other = init();
    const personId = live(other.people)[0]!.id;
    const withBlock = addRecord(
      other,
      'blocks',
      { personId, typeId: typeByKey(other, 'annual')!.id, start: '2027-05-01', end: '2027-05-01', status: 'planned' },
      ctx,
    ).doc;
    await storage.create(withBlock);

    const s = sync(storage);
    await s.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(await storage.listCalendars()).toHaveLength(1);
    expect(await storedBlocks(storage)).toEqual(['2027-03-01', '2027-05-01']);
  });

  it('does not start an empty plan over one in the trash, unless asked', async () => {
    const storage = new TestStorage();
    const { calendarId } = await storage.create(init());
    await storage.remove(calendarId);
    const s = sync(storage);
    await s.open();
    expect(s.getSnapshot().loadError).toBeInstanceOf(PlanRemovedError);
    await s.open(true);
    expect(s.getSnapshot().loadError).toBeNull();
    expect(await storage.listCalendars()).toHaveLength(1);
  });

  it('refuses a plan file that belongs to another account', async () => {
    const storage = new TestStorage();
    await storage.create(newPlanDoc({ googleSub: 'someone-else', personName: 'X' }, ctx).doc);
    const s = sync(storage);
    await s.open();
    expect(s.getSnapshot().loadError).toBeInstanceOf(OtherOwnerError);
  });

  it('carries the demo plan into mine once, and says so', async () => {
    const storage = new TestStorage();
    const demo = new MemoryStorage();
    const d = new DocumentSync({ storage: demo, init, newId });
    await d.open();
    addBlock(d, '2027-07-01', 'beach');
    await d.close();
    const s = sync(storage, { carry: () => demo.latest() });
    await s.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(await storedBlocks(storage)).toEqual(['2027-07-01']);
    expect(s.getSnapshot().notices).toEqual([{ kind: 'carried', count: 1 }]);
  });

  it('saves what is left when closed (sign-out), and says whether everything got saved', async () => {
    const storage = new TestStorage();
    const s = sync(storage);
    await s.open();
    addBlock(s, '2027-03-01');
    expect(await s.close()).toBe(true);
    expect(await storedBlocks(storage)).toEqual(['2027-03-01']);

    const t = sync(storage);
    await t.open();
    storage.failSaves = [retryable];
    addBlock(t, '2027-03-02');
    expect(await t.close()).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(storage.saves).toBe(2); // closed: no retries behind the user's back
  });
});
