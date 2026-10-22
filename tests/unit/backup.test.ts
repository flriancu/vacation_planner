import { describe, expect, it } from 'vitest';
import { addFromBackup, readBackup, summarize, toBackup } from '../../src/domain/backup';
import { UnsupportedPlanError } from '../../src/domain/migrate';
import { addRecord, live, newPlanDoc, typeByKey } from '../../src/domain/schema';
import { DocBuilder } from '../fixtures/builder';

describe('plan copies (IO-4)', () => {
  it('round-trips: a saved copy reads back as the same plan', () => {
    const b = new DocBuilder();
    b.block('annual', '2027-08-09', '2027-08-13', 'approved');
    b.year(2027, { annualOpening: 21, excusedQuota: 2 });
    expect(toBackup(readBackup(toBackup(b.doc)))).toBe(toBackup(b.doc));
  });

  it('refuses a file that is not a plan, saying why', () => {
    expect(() => readBackup('not json')).toThrow(UnsupportedPlanError);
    expect(() => readBackup('{"schemaVersion":9}')).toThrow(/schema version 9/);
  });

  it('summarises what a copy holds', () => {
    const b = new DocBuilder();
    b.block('annual', '2027-12-27', '2028-01-04', 'idea');
    b.block('annual', '2027-05-04', '2027-05-04', 'approved');
    expect(summarize(b.doc)).toEqual({ blocks: 2, byStatus: { idea: 1, planned: 0, approved: 1 }, years: [2027, 2028] });
  });

  it("adds another account's copy to my plan as mine, keeping everything I have", () => {
    const mine = new DocBuilder();
    mine.block('annual', '2027-03-01', '2027-03-05', 'planned');
    let n = 0;
    const ctx = { now: '2026-01-01T00:00:00.000Z', newId: () => `other-${++n}` };
    const created = newPlanDoc({ googleSub: 'someone-else', personName: 'X' }, ctx);
    const annual = typeByKey(created.doc, 'annual')!.id;
    const other = addRecord(
      created.doc,
      'blocks',
      { personId: created.personId, typeId: annual, start: '2027-05-04', end: '2027-05-04', status: 'approved' },
      ctx,
    ).doc;

    const out = addFromBackup(mine.doc, readBackup(toBackup(other)));
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
});
