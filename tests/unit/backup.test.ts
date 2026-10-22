import { describe, expect, it } from 'vitest';
import { addCopy, MAX_COPY_BLOCKS, planCopy, readBackup, toBackup } from '../../src/domain/backup';
import { UnsupportedPlanError } from '../../src/domain/migrate';
import { addRecord, live, newPlanDoc, typeByKey, type PlanDoc } from '../../src/domain/schema';
import { DocBuilder, testContext } from '../fixtures/builder';

/** Ids of another plan: real ids are random, so two plans never share one. */
function otherContext() {
  const ctx = testContext();
  let n = 0;
  return {
    get now() {
      return ctx.now;
    },
    newId: () => `other-${++n}`,
  };
}

/** Someone else's plan with one approved day of leave, as a copy file would hold it. */
function othersCopy(start = '2027-05-04', end = start): PlanDoc {
  const ctx = otherContext();
  const created = newPlanDoc({ googleSub: 'someone-else', personName: 'Mihai' }, ctx);
  const annual = typeByKey(created.doc, 'annual')!.id;
  const doc = addRecord(created.doc, 'blocks', { personId: created.personId, typeId: annual, start, end, status: 'approved' }, ctx).doc;
  return readBackup(toBackup(doc));
}

const add = (mine: DocBuilder, copy: PlanDoc) => addCopy(mine.doc, planCopy(mine.doc, copy, mine.personId), mine.ctx);

describe('plan copies (IO-4)', () => {
  it('round-trips: a saved copy reads back as the same plan', () => {
    const b = new DocBuilder();
    b.block('annual', '2027-08-09', '2027-08-13', 'approved');
    b.year(2027, { annualOpening: 21, excusedQuota: 2 });
    expect(toBackup(readBackup(toBackup(b.doc)))).toBe(toBackup(b.doc));
  });

  it('leaves out the plans I follow: other people’s files are not passed on', () => {
    const b = new DocBuilder();
    b.add('following', { driveFileId: 'mihai-file', label: 'Mihai' });
    expect(toBackup(b.doc)).not.toContain('mihai-file');
  });

  it('refuses a file that is not a plan, saying why', () => {
    expect(() => readBackup('not json')).toThrow(expect.objectContaining({ reason: 'json' }));
    expect(() => readBackup('{"schemaVersion":9}')).toThrow(expect.objectContaining({ reason: 'version' }));
    expect(() => readBackup('[]')).toThrow(expect.objectContaining({ reason: 'notPlan' }));
    expect(() => readBackup(' '.repeat(5_000_001))).toThrow(expect.objectContaining({ reason: 'tooBig' }));
    const ctx = testContext();
    const { doc, personId } = newPlanDoc({ googleSub: 'x', personName: 'X' }, ctx);
    const annual = typeByKey(doc, 'annual')!.id;
    const block = {
      id: 'b',
      createdAt: ctx.now,
      updatedAt: ctx.now,
      personId,
      typeId: annual,
      start: '2027-01-04',
      end: '2027-01-04',
      status: 'idea',
    };
    const big = {
      ...doc,
      blocks: Object.fromEntries(Array.from({ length: MAX_COPY_BLOCKS + 1 }, (_, i) => [`b${i}`, { ...block, id: `b${i}` }])),
    };
    expect(() => readBackup(JSON.stringify(big))).toThrow(UnsupportedPlanError);
  });

  it("adds another account's copy as my leave, and says whose copy it is", () => {
    const mine = new DocBuilder();
    mine.block('annual', '2027-03-01', '2027-03-05', 'planned');
    const plan = planCopy(mine.doc, othersCopy(), mine.personId);
    expect(plan).toMatchObject({ from: 'Mihai', byStatus: { approved: 1 }, years: [2027] });
    const out = add(mine, othersCopy());
    expect(live(out.people)).toHaveLength(1);
    expect(
      live(out.blocks)
        .map((b) => [b.start, b.personId, b.typeId])
        .sort(),
    ).toEqual([
      ['2027-03-01', mine.personId, typeByKey(mine.doc, 'annual')!.id],
      ['2027-05-04', mine.personId, typeByKey(mine.doc, 'annual')!.id],
    ]);
    expect(out.settings).toEqual(mine.doc.settings);
  });

  it('adds only what is new: a second add of the same copy adds nothing, and deleted leave stays deleted', () => {
    const mine = new DocBuilder();
    const once = add(mine, othersCopy());
    expect(planCopy(once, othersCopy(), mine.personId)).toMatchObject({ blocks: [], skipped: { existing: 1 } });
  });

  it('never deletes, changes or replaces anything of mine, whatever the copy holds', () => {
    const mine = new DocBuilder();
    const kept = mine.block('annual', '2027-03-01', '2027-03-05', 'approved');
    const annual = typeByKey(mine.doc, 'annual')!;
    const later = '2099-01-01T00:00:00.000Z';
    // A hostile copy of my own plan: a deletion marker for my leave, my annual type turned
    // into one that costs nothing, holidays removed, a balance adjustment, a follow, a second person "0".
    const copy = readBackup(toBackup(mine.doc));
    const hostile = {
      ...copy,
      blocks: { [kept.id]: { ...kept, deleted: true, updatedAt: later } },
      leaveTypes: { ...copy.leaveTypes, [annual.id]: { ...annual, budget: 'none', updatedAt: later } },
      holidayOverrides: { h: { id: 'h', createdAt: later, updatedAt: later, date: '2027-12-01', kind: 'remove' } },
      adjustments: { a: { id: 'a', createdAt: later, updatedAt: later, personId: mine.personId, year: 2027, days: -20, reason: 'x' } },
      following: { f: { id: 'f', createdAt: later, updatedAt: later, driveFileId: 'other-file', label: 'Boss' } },
      people: { ...copy.people, 0: { id: '0', createdAt: later, updatedAt: later, name: 'Intruder', color: '#000', hasAccount: false } },
    };
    const out = add(mine, readBackup(JSON.stringify(hostile)));
    expect(out).toEqual(mine.doc);
  });

  it('applies the editor’s rules: no overlapping planned or approved leave, no fourth idea on a day', () => {
    const mine = new DocBuilder();
    mine.block('annual', '2027-05-03', '2027-05-07', 'approved');
    for (let i = 0; i < 3; i++) mine.block('annual', '2027-06-07', '2027-06-07', 'idea');
    const ctx = otherContext();
    const created = newPlanDoc({ googleSub: 'someone-else', personName: 'Mihai' }, ctx);
    const annual = typeByKey(created.doc, 'annual')!.id;
    let doc = created.doc;
    for (const [start, status] of [
      ['2027-05-05', 'approved'],
      ['2027-06-07', 'idea'],
      ['2027-07-05', 'planned'],
    ] as const) {
      doc = addRecord(doc, 'blocks', { personId: created.personId, typeId: annual, start, end: start, status }, ctx).doc;
    }
    const plan = planCopy(mine.doc, readBackup(toBackup(doc)), mine.personId);
    expect(plan.blocks.map((b) => b.start)).toEqual(['2027-07-05']);
    expect(plan.skipped.conflicts).toBe(2);
  });

  it('carries only the fields a leave has: whatever else a copy holds stays behind', () => {
    const copy = othersCopy();
    const block = Object.values(copy.blocks)[0]!;
    // Nested deeper than JSON.stringify can write back: written by hand.
    const deep = `${'{"d":'.repeat(10000)}"x"${'}'.repeat(10000)}`;
    const text = JSON.stringify({ ...copy, blocks: { [block.id]: { ...block, extra: 'DEEP' } } }).replace('"DEEP"', deep);
    const mine = new DocBuilder();
    const out = add(mine, readBackup(text));
    expect(JSON.stringify(out)).not.toContain('extra');
  });
});
