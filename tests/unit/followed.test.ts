import { describe, expect, it, vi } from 'vitest';
import { addRecord, live, newPlanDoc, typeByKey, type PlanDoc } from '../../src/domain/schema';
import { MemoryStorage } from '../../src/storage/MemoryStorage';
import { FollowedPlans, MAX_FOLLOWED_RECORDS } from '../../src/sync/Followed';
import { testContext } from '../fixtures/builder';

const ctx = testContext();

function plan(owner: string, start: string): PlanDoc {
  const { doc, personId } = newPlanDoc({ googleSub: owner, personName: owner }, ctx);
  return addRecord(doc, 'blocks', { personId, typeId: typeByKey(doc, 'annual')!.id, start, end: start, status: 'approved' }, ctx).doc;
}

describe('FollowedPlans (PPL-3)', () => {
  it('loads every followed plan read-only, each on its own', async () => {
    const storage = new MemoryStorage();
    const a = await storage.create(plan('ana', '2027-08-16'));
    const f = new FollowedPlans(storage);
    await f.set([a.calendarId, 'gone']);
    const [ana, gone] = f.getSnapshot();
    expect(live(ana!.doc!.blocks).map((b) => b.start)).toEqual(['2027-08-16']);
    expect(gone!.doc).toBeUndefined();
    expect(gone!.state).toBe('gone'); // the other one still loaded
  });

  it('picks up changes when refreshed, and says so when the plan is gone', async () => {
    const storage = new MemoryStorage();
    const a = await storage.create(plan('ana', '2027-08-16'));
    const f = new FollowedPlans(storage);
    await f.set([a.calendarId]);
    const { version } = await storage.load(a.calendarId);
    await storage.save(a.calendarId, plan('ana', '2027-09-01'), version);
    await f.refresh();
    expect(live(f.getSnapshot()[0]!.doc!.blocks).map((b) => b.start)).toEqual(['2027-09-01']);
    await storage.remove(a.calendarId); // sharing stopped
    await f.refresh();
    expect(f.getSnapshot()[0]!.state).toBe('gone');
    expect(f.getSnapshot()[0]!.doc).toBeUndefined();
  });

  it('keeps what it loaded through a passing failure, says it is stale, and tries again', async () => {
    vi.useFakeTimers();
    try {
      const storage = new MemoryStorage();
      const a = await storage.create(plan('ana', '2027-08-16'));
      const f = new FollowedPlans(storage, () => 1000);
      await f.set([a.calendarId]);
      const { version } = await storage.load(a.calendarId);
      await storage.save(a.calendarId, plan('ana', '2027-09-01'), version);
      const load = storage.load.bind(storage);
      let offline = true;
      storage.load = (id) => (offline ? Promise.reject(Object.assign(new Error('offline'), { retryable: true })) : load(id));
      await f.refresh();
      expect(f.getSnapshot()[0]).toMatchObject({ state: 'stale', loadedAt: 1000 });
      expect(live(f.getSnapshot()[0]!.doc!.blocks).map((b) => b.start)).toEqual(['2027-08-16']);
      offline = false;
      await vi.advanceTimersByTimeAsync(5000);
      expect(f.getSnapshot()[0]!.state).toBe('ready');
      expect(live(f.getSnapshot()[0]!.doc!.blocks).map((b) => b.start)).toEqual(['2027-09-01']);
      f.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a plan too big to draw', async () => {
    const storage = new MemoryStorage();
    const small = plan('ana', '2027-08-16');
    const block = Object.values(small.blocks)[0]!;
    const blocks = Object.fromEntries(Array.from({ length: MAX_FOLLOWED_RECORDS }, (_, i) => [`b${i}`, { ...block, id: `b${i}` }]));
    const big = { ...small, blocks };
    const a = await storage.create(big);
    const f = new FollowedPlans(storage);
    await f.set([a.calendarId]);
    expect(f.getSnapshot()[0]!.state).toBe('tooBig');
    expect(f.getSnapshot()[0]!.doc).toBeUndefined();
  });

  it('drops a plan that is no longer followed', async () => {
    const storage = new MemoryStorage();
    const a = await storage.create(plan('ana', '2027-08-16'));
    const f = new FollowedPlans(storage);
    await f.set([a.calendarId]);
    await f.set([]);
    expect(f.getSnapshot()).toEqual([]);
  });

  it('answers a burst of refreshes with one round of requests', async () => {
    const storage = new MemoryStorage();
    const a = await storage.create(plan('ana', '2027-08-16'));
    const f = new FollowedPlans(storage);
    await f.set([a.calendarId]);
    let checks = 0;
    const version = storage.version.bind(storage);
    storage.version = (id) => (checks++, version(id));
    await Promise.all(Array.from({ length: 100 }, () => f.refresh()));
    expect(checks).toBe(1);
  });
});
