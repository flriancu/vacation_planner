import { describe, expect, it } from 'vitest';
import { updateRecord } from '../../src/domain/edit';
import { followed, leaveDays, movedOrder, offTogether, ownPerson } from '../../src/domain/people';
import { DocBuilder } from '../fixtures/builder';

/** Me, and Ana whose plan I follow; made-up August 2027 leave. */
function family() {
  const me = new DocBuilder();
  me.block('annual', '2027-08-09', '2027-08-20', 'approved');
  const ana = new DocBuilder();
  ana.block('annual', '2027-08-12', '2027-08-20', 'approved');
  ana.block('annual', '2027-08-23', '2027-08-27', 'idea');
  return { me, ana };
}

describe('the overlay of the people I follow (PPL-4)', () => {
  it("gives each day of someone's leave, and where their line starts and ends", () => {
    const { ana } = family();
    const days = leaveDays(ana.doc, ana.personId, '2027-08-01', '2027-08-31');
    expect(days.get('2027-08-12')).toMatchObject({ status: 'approved', start: true, end: false });
    expect(days.get('2027-08-20')).toMatchObject({ status: 'approved', start: false, end: true });
    expect(days.get('2027-08-24')!.status).toBe('idea');
    expect(days.has('2027-08-11')).toBe(false);
    expect(ownPerson(ana.doc)).toBe(ana.personId);
  });

  it('marks the days everyone is off, counting days off anyway but not ideas', () => {
    const { me, ana } = family();
    const together = offTogether(
      [
        { doc: me.doc, personId: me.personId },
        { doc: ana.doc, personId: ana.personId },
      ],
      '2027-08-01',
      '2027-08-31',
    );
    // 12–20 Aug both on approved leave, and the weekend 14–15 (15 Aug is a holiday too) in between.
    expect([...together.keys()]).toEqual([
      '2027-08-12',
      '2027-08-13',
      '2027-08-14',
      '2027-08-15',
      '2027-08-16',
      '2027-08-17',
      '2027-08-18',
      '2027-08-19',
      '2027-08-20',
      '2027-08-21',
      '2027-08-22',
    ]);
    expect(new Set(together.values())).toEqual(new Set(['approved']));
    // Ana's idea of 23–27 Aug is not "off" yet; ordinary weekends alone are not marked.
    expect(together.has('2027-08-23')).toBe(false);
    expect(together.has('2027-08-07')).toBe(false);
  });

  it('says a stretch is only planned when any leave in it is not approved yet', () => {
    const { me, ana } = family();
    const planned = Object.values(ana.doc.blocks).find((b) => b.start === '2027-08-12')!;
    ana.doc = updateRecord(ana.doc, 'blocks', planned.id, { status: 'planned' }, '2027-02-01T00:00:00.000Z');
    const together = offTogether(
      [
        { doc: me.doc, personId: me.personId },
        { doc: ana.doc, personId: ana.personId },
      ],
      '2027-08-01',
      '2027-08-31',
    );
    expect(together.get('2027-08-16')).toBe('planned');
    expect(together.get('2027-08-14')).toBe('planned'); // the whole stretch, weekend included
  });

  it('orders the people I follow as I set, then by when I started following them', () => {
    const me = new DocBuilder();
    const a = me.add('following', { driveFileId: 'a', label: 'A' });
    const b = me.add('following', { driveFileId: 'b', label: 'B' });
    const c = me.add('following', { driveFileId: 'c', label: 'C', order: 1 });
    expect(followed(me.doc).map((f) => f.id)).toEqual([c.id, a.id, b.id]);
  });
});

describe('the plans I follow, after merges and copies (PPL-3)', () => {
  it('lists each file once, never my own, and only real file ids', () => {
    const me = new DocBuilder();
    me.add('following', { driveFileId: 'ana-file', label: 'Ana', order: 1 });
    me.add('following', { driveFileId: 'ana-file', label: 'Ana again', order: 2 }); // two devices, or two clicks
    me.add('following', { driveFileId: 'my-file', label: 'Me' }); // from someone's copy
    me.add('following', { driveFileId: 'bad\nid', label: 'Broken' });
    expect(followed(me.doc, 'my-file').map((f) => f.label)).toEqual(['Ana']);
  });

  it('moves one person past the next shown one, writing only their own place', () => {
    const me = new DocBuilder();
    const a = me.add('following', { driveFileId: 'a', label: 'A', order: 1 });
    const b = me.add('following', { driveFileId: 'b', label: 'B', order: 2, hidden: true });
    const c = me.add('following', { driveFileId: 'c', label: 'C', order: 3 });
    const list = followed(me.doc);
    // C up: past A (B is hidden, so moving past it alone would change nothing on the calendar).
    expect(movedOrder(list, c.id, -1)).toBeLessThan(1);
    // A down: past C.
    expect(movedOrder(list, a.id, 1)).toBeGreaterThan(3);
    expect(movedOrder(list, a.id, -1)).toBeUndefined();
    expect(movedOrder(list, c.id, 1)).toBeUndefined();
    expect(b.hidden).toBe(true);
  });
});

describe("what a followed person's line says (PPL-4)", () => {
  it('keeps one look across an office closure inside their approved leave', () => {
    const ana = new DocBuilder();
    ana.block('annual', '2027-03-08', '2027-03-12', 'approved');
    ana.block('closed', '2027-03-10', '2027-03-10', 'planned');
    const days = leaveDays(ana.doc, ana.personId, '2027-03-01', '2027-03-31');
    expect(['2027-03-08', '2027-03-10', '2027-03-12'].map((d) => days.get(d)!.status)).toEqual(['approved', 'approved', 'approved']);
  });

  it('counts an office closure as sure: it needs no approval', () => {
    const me = new DocBuilder();
    me.block('closed', '2027-03-10', '2027-03-10', 'planned');
    const ana = new DocBuilder();
    ana.block('annual', '2027-03-10', '2027-03-10', 'approved');
    const together = offTogether(
      [
        { doc: me.doc, personId: me.personId },
        { doc: ana.doc, personId: ana.personId },
      ],
      '2027-03-01',
      '2027-03-31',
    );
    expect(together.get('2027-03-10')).toBe('approved');
  });

  it('says the same about a day in every view that shows it', () => {
    const me = new DocBuilder();
    me.block('annual', '2027-12-20', '2028-01-14', 'approved');
    const ana = new DocBuilder();
    ana.block('annual', '2027-12-20', '2027-12-31', 'approved');
    ana.block('annual', '2028-01-03', '2028-01-14', 'planned');
    const plans = [
      { doc: me.doc, personId: me.personId },
      { doc: ana.doc, personId: ana.personId },
    ];
    // The 2027 view ends mid-January 2028; the 2028 view starts mid-December 2027.
    const in2027 = offTogether(plans, '2026-12-14', '2028-01-16');
    const in2028 = offTogether(plans, '2027-12-13', '2029-01-14');
    for (const d of ['2027-12-22', '2028-01-05', '2028-01-12']) expect(in2027.get(d)).toBe(in2028.get(d));
  });
});
