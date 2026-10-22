import { describe, expect, it } from 'vitest';
import { addCopy, MAX_COPY_BLOCKS, planCopy, readBackup, toBackup } from '../../src/domain/backup';
import { UnsupportedPlanError } from '../../src/domain/migrate';
import { absorb } from '../../src/domain/absorb';
import { nextStamp } from '../../src/domain/clock';
import { deleteRecord, updateRecord } from '../../src/domain/edit';
import { addRecord, live, newPlanDoc, typeByKey, type BlockStatus, type LeaveType, type PlanDoc } from '../../src/domain/schema';
import { DocBuilder, testContext } from '../fixtures/builder';

/** Ids of another plan: real ids are random, so two plans never share one. */
let plans = 0;
function otherContext() {
  const ctx = testContext();
  const prefix = `other${++plans}`;
  let n = 0;
  return {
    get now() {
      return ctx.now;
    },
    newId: () => `${prefix}-${++n}`,
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

const add = (mine: DocBuilder, copy: PlanDoc) => addCopy(mine.doc, planCopy(mine.doc, copy, mine.personId), mine.ctx.now);

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
    const copy = othersCopy();
    const once = add(mine, copy);
    expect(planCopy(once, copy, mine.personId)).toMatchObject({ blocks: [], skipped: { existing: 1 } });
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

/** A copy of `owner`'s plan with these blocks (made-up ids, never shared with my plan's). */
function copyWith(
  owner: string,
  blocks: { start: string; end?: string; status?: BlockStatus; type?: string }[],
  types: LeaveType[] = [],
): PlanDoc {
  const ctx = otherContext();
  const created = newPlanDoc({ googleSub: owner, personName: 'Mihai' }, ctx);
  let doc = created.doc;
  for (const t of types) doc = { ...doc, leaveTypes: { ...doc.leaveTypes, [t.id]: t } };
  for (const b of blocks) {
    const typeId = b.type ?? typeByKey(doc, 'annual')!.id;
    doc = addRecord(
      doc,
      'blocks',
      { personId: created.personId, typeId, start: b.start, end: b.end ?? b.start, status: b.status ?? 'approved' },
      ctx,
    ).doc;
  }
  return readBackup(toBackup(doc));
}
const custom = (id: string, ro: string, en: string, budget: LeaveType['budget'] = 'annual'): LeaveType => ({
  id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  name: { ro, en },
  color: '#000000',
  budget,
  needsApproval: true,
});

describe('plan copies, after re-verification (IO-4)', () => {
  it("keeps the copy's own times, so a newer edit or delete elsewhere still wins", () => {
    // In Drive: leave X moved later, leave Y deleted. A copy from before both is added to the demo, which is then carried in.
    const drive = new DocBuilder();
    const x = drive.block('annual', '2027-06-07', '2027-06-07', 'planned');
    const y = drive.block('annual', '2027-06-21', '2027-06-21', 'planned');
    const old = readBackup(toBackup(drive.doc));
    drive.doc = updateRecord(drive.doc, 'blocks', x.id, { start: '2027-06-14', end: '2027-06-14' }, nextStamp(drive.doc));
    drive.doc = deleteRecord(drive.doc, 'blocks', y.id, nextStamp(drive.doc));
    const demo = newPlanDoc({ googleSub: 'demo', personName: 'Me' }, testContext());
    const withCopy = addCopy(demo.doc, planCopy(demo.doc, old, demo.personId), '2027-12-31T00:00:00.000Z');
    const carried = absorb(drive.doc, withCopy);
    expect(carried.blocks[x.id]!.start).toBe('2027-06-14');
    expect(carried.blocks[y.id]!.deleted).toBe(true);
  });

  it('never stamps an added record later than now', () => {
    const copy = copyWith('someone-else', [{ start: '2027-05-04' }]);
    const block = Object.values(copy.blocks)[0]!;
    const future = { ...copy, blocks: { [block.id]: { ...block, updatedAt: '2027-12-31T00:00:00.000Z' } } };
    const mine = new DocBuilder();
    const out = addCopy(mine.doc, planCopy(mine.doc, future, mine.personId), '2027-03-01T00:00:00.000Z');
    expect(out.blocks[block.id]!.updatedAt).toBe('2027-03-01T00:00:00.000Z');
  });

  it('matches a custom type only to an identical one: a name alone never turns leave into another kind', () => {
    const mine = new DocBuilder();
    const copy = copyWith(
      'someone-else',
      [{ start: '2027-06-01', end: '2027-06-30', type: 'c' }],
      [custom('c', 'Concediu plătit', 'Office closed')],
    );
    const plan = planCopy(mine.doc, copy, mine.personId);
    expect(plan.blocks[0]!.typeId).not.toBe(typeByKey(mine.doc, 'closed')!.id);
    expect(plan.types.map((t) => [t.name.en, t.budget])).toEqual([['Office closed', 'annual']]);
  });

  it('gives an added type an id nobody uses: not mine, not one kept unread, not another of the copy', () => {
    const mine = new DocBuilder();
    mine.doc = { ...mine.doc, skipped: { leaveTypes: { x: { id: 'x', budget: 'future-budget' } } } };
    const copy = copyWith(
      'someone-else',
      [
        { start: '2027-06-01', type: 'x' },
        { start: '2027-06-02', type: 'x-2' },
      ],
      [custom('x', 'Formare', 'Training'), custom('x-2', 'Curs', 'Course')],
    );
    const plan = planCopy(mine.doc, copy, mine.personId);
    const ids = plan.types.map((t) => t.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain('x');
    const out = addCopy(mine.doc, plan, mine.ctx.now);
    expect(out.skipped?.leaveTypes?.x).toEqual({ id: 'x', budget: 'future-budget' });
  });

  it('keeps three imports of a renamed custom type apart', () => {
    const mine = new DocBuilder();
    let doc = mine.doc;
    for (const [i, name] of ['Formare', 'Curs', 'Atelier'].entries()) {
      const copy = copyWith('someone-else', [{ start: `2027-0${i + 4}-06`, type: 'x' }], [custom('x', name, name)]);
      doc = addCopy(doc, planCopy(doc, copy, mine.personId), mine.ctx.now);
    }
    const names = live(doc.blocks)
      .map((b) => doc.leaveTypes[b.typeId]!.name.ro)
      .sort();
    expect(names).toEqual(['Atelier', 'Curs', 'Formare']);
  });

  it('keeps the surest leave when two in a copy overlap', () => {
    const mine = new DocBuilder();
    const copy = copyWith('someone-else', [
      { start: '2027-06-01', end: '2027-06-10', status: 'planned' },
      { start: '2027-06-05', end: '2027-06-06', status: 'approved' },
    ]);
    const plan = planCopy(mine.doc, copy, mine.personId);
    expect(plan.blocks.map((b) => b.status)).toEqual(['approved']);
  });

  it('says what it could not read, and reads back a copy with many deletions', () => {
    const mine = new DocBuilder();
    const copy = copyWith('someone-else', [{ start: '2027-06-01' }]);
    const raw = JSON.parse(toBackup(copy)) as { blocks: Record<string, object> };
    raw.blocks.bad = { id: 'bad', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', start: '2027-02-30' };
    expect(planCopy(mine.doc, readBackup(JSON.stringify(raw)), mine.personId).skipped.unreadable).toBe(1);

    const b = new DocBuilder();
    const kept = b.block('annual', '2027-01-04', '2027-01-04', 'idea');
    const gone = deleteRecord(b.doc, 'blocks', kept.id, nextStamp(b.doc)).blocks[kept.id]!;
    b.doc = {
      ...b.doc,
      blocks: Object.fromEntries(Array.from({ length: MAX_COPY_BLOCKS + 5 }, (_, i) => [`d${i}`, { ...gone, id: `d${i}` }])),
    };
    expect(() => readBackup(toBackup(b.doc))).not.toThrow();
  });

  it('treats ids named like object properties as any other id', () => {
    const mine = new DocBuilder();
    const copy = copyWith('someone-else', [{ start: '2027-06-01' }]);
    const block = Object.values(copy.blocks)[0]!;
    const hostile = readBackup(JSON.stringify({ ...JSON.parse(toBackup(copy)), blocks: { constructor: { ...block, id: 'constructor' } } }));
    expect(planCopy(mine.doc, hostile, mine.personId)).toMatchObject({ skipped: { existing: 0 }, byStatus: { approved: 1 } });
  });

  it('checks swap days as the editor does', () => {
    const mine = new DocBuilder();
    const swap = typeByKey(mine.doc, 'swap')!;
    const copy = copyWith('someone-else', [{ start: '2027-06-01', type: 'swap-type' }], [{ ...swap, id: 'swap-type' }]);
    expect(planCopy(mine.doc, copy, mine.personId).skipped.conflicts).toBe(1);
  });

  it("doesn't call a copy of the demo someone else's", () => {
    const mine = new DocBuilder();
    const demo = newPlanDoc({ googleSub: 'demo', personName: 'Me' }, otherContext());
    expect(planCopy(mine.doc, readBackup(toBackup(demo.doc)), mine.personId).from).toBeUndefined();
  });

  it('plans a copy of thousands of leaves in a moment', () => {
    const mine = new DocBuilder();
    const copy = copyWith(
      'someone-else',
      Array.from({ length: 4000 }, (_, i) => ({ start: `2027-0${(i % 9) + 1}-1${i % 10}`, status: 'idea' as const })),
    );
    const started = performance.now();
    planCopy(mine.doc, copy, mine.personId);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
