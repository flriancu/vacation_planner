import { describe, expect, it } from 'vitest';
import { addRecord, live, newPlanDoc, typeByKey, type PlanDoc } from '../../src/domain/schema';
import { MemoryStorage } from '../../src/storage/MemoryStorage';
import { FollowedPlans } from '../../src/sync/Followed';
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
    expect(gone!.error).toBeInstanceOf(Error); // the other one still loaded
  });

  it('picks up changes when refreshed, and keeps the last good copy if a refresh fails', async () => {
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
    expect(f.getSnapshot()[0]!.error).toBeDefined();
    expect(f.getSnapshot()[0]!.doc).toBeDefined();
  });

  it('drops a plan that is no longer followed', async () => {
    const storage = new MemoryStorage();
    const a = await storage.create(plan('ana', '2027-08-16'));
    const f = new FollowedPlans(storage);
    await f.set([a.calendarId]);
    await f.set([]);
    expect(f.getSnapshot()).toEqual([]);
  });
});
