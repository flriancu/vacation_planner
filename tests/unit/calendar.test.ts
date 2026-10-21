import { describe, expect, it } from 'vitest';
import { blockBudget, buildDays, findOverlaps } from '../../src/domain/calendar';
import { DocBuilder } from '../fixtures/builder';
import { demo2027 } from '../fixtures/demo2027';

describe('buildDays', () => {
  it('classifies the demo year: holidays, weekends, swap, office-closed and floating days', () => {
    const { doc, personId } = demo2027();
    const days = buildDays(doc, personId, '2026-12-31', '2028-01-03');
    const kind = (d: string) => {
      const day = days.get(d)!;
      return `${day.base}${day.off ? ' off' : ''}${day.anchor ? ' anchor' : ''}`;
    };
    expect(kind('2026-12-31')).toBe('work');
    expect(kind('2027-01-01')).toBe('holiday off anchor');
    expect(kind('2027-01-03')).toBe('weekend off');
    expect(kind('2027-01-04')).toBe('work off anchor'); // swap day
    expect(kind('2027-01-05')).toBe('work');
    expect(kind('2027-05-31')).toBe('work off anchor'); // floating day
    expect(kind('2027-12-27')).toBe('work'); // the dismissed 26 Dec swap
    expect(kind('2027-12-28')).toBe('work off anchor'); // office-closed day
    expect(kind('2028-01-03')).toBe('work');
  });

  it('orders blocks by status, ignores ideas for "off", and anchors on floating, swap and office-closed days', () => {
    const b = new DocBuilder();
    b.block('annual', '2025-03-03', '2025-03-07', 'idea');
    b.block('annual', '2025-03-05', '2025-03-05', 'planned');
    b.block('floating', '2025-03-10', '2025-03-10', 'planned');
    const days = buildDays(b.doc, b.personId, '2025-03-01', '2025-03-15');
    expect(days.get('2025-03-03')!.off).toBe(false);
    expect(days.get('2025-03-05')!.blocks.map((x) => x.status)).toEqual(['planned', 'idea']);
    expect(days.get('2025-03-05')!.off).toBe(true);
    expect(days.get('2025-03-05')!.anchor).toBe(false); // annual leave is not a bridge anchor
    expect(days.get('2025-03-10')!.anchor).toBe(true);
  });

  it('ignores deleted blocks and other people', () => {
    const b = new DocBuilder();
    const mine = b.block('annual', '2025-03-03');
    const kid = b.add('people', { name: 'Kid', color: '#000', hasAccount: false });
    b.add('blocks', { personId: kid.id, typeId: mine.typeId, start: '2025-03-04', end: '2025-03-04', status: 'approved' });
    const gone = b.block('annual', '2025-03-05');
    b.update('blocks', { ...gone, deleted: true });
    const days = buildDays(b.doc, b.personId, '2025-03-03', '2025-03-05');
    expect(days.get('2025-03-03')!.off).toBe(true);
    expect(days.get('2025-03-04')!.off).toBe(false);
    expect(days.get('2025-03-05')!.off).toBe(false);
  });
});

describe('blockBudget', () => {
  it('charges office-closed days to annual leave only in years set that way (LT-3)', () => {
    const b = new DocBuilder();
    b.year(2028, { closedCountsAgainstAnnual: true });
    const block = b.block('closed', '2028-12-27');
    expect(blockBudget(b.doc, block, 2028)).toBe('annual');
    expect(blockBudget(b.doc, block, 2029)).toBe('none');
    expect(blockBudget(b.doc, b.block('floating', '2028-06-02'), 2028)).toBe('floating');
  });
});

describe('findOverlaps', () => {
  it('reports overlapping planned/approved blocks but not ideas (BLK-5)', () => {
    const b = new DocBuilder();
    const a = b.block('annual', '2025-07-07', '2025-07-11', 'planned');
    const c = b.block('annual', '2025-07-11', '2025-07-15', 'approved');
    b.block('annual', '2025-07-08', '2025-07-09', 'idea');
    b.block('annual', '2025-07-16', '2025-07-18', 'planned');
    expect(findOverlaps(b.doc, b.personId)).toEqual([[a, c]]);
  });

  it('lets leave span office-closed days (BLK-6)', () => {
    const b = new DocBuilder();
    b.block('closed', '2027-12-28', '2027-12-31', 'planned');
    b.block('annual', '2027-12-20', '2028-01-07', 'planned');
    expect(findOverlaps(b.doc, b.personId)).toEqual([]);
  });
});
