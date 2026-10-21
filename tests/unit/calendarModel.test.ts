import { describe, expect, it } from 'vitest';
import { buildDays } from '../../src/domain/calendar';
import { weekday } from '../../src/domain/dates';
import { buildWeeks, monthEdges, outlineEdges, viewRange } from '../../src/ui/calendarModel';
import { DocBuilder } from '../fixtures/builder';

describe('viewRange (CAL-2)', () => {
  it('runs Monday to Sunday from mid-December before to mid-January after', () => {
    const { from, to } = viewRange(2027);
    expect(from).toBe('2026-12-14');
    expect(to).toBe('2028-01-16');
    expect(weekday(from)).toBe(0);
    expect(weekday(to)).toBe(6);
  });
});

describe('buildWeeks', () => {
  it('names each month in the week it starts, and the first week', () => {
    const { from, to } = viewRange(2027);
    const b = new DocBuilder();
    const weeks = buildWeeks(from, to, buildDays(b.doc, b.personId, from, to));
    expect(weeks).toHaveLength(57);
    expect(weeks[0]!.month).toBe('2026-12-01');
    expect(weeks.filter((w) => w.month)).toHaveLength(14); // first week (Dec) + Jan–Dec + Jan after
    const jan = weeks.find((w) => w.month === '2027-01-01')!;
    expect(jan.days[0]).toBe('2026-12-28');
    expect(jan.holidays.map((h) => h.date)).toEqual(['2027-01-01', '2027-01-02']);
  });
});

describe('outlineEdges (CAL-6)', () => {
  it('outlines a range that crosses a week boundary', () => {
    // Fri 6 – Tue 10 Aug 2027
    expect(outlineEdges('2027-08-06', '2027-08-06', '2027-08-10')).toEqual({ top: true, right: false, bottom: true, left: true });
    expect(outlineEdges('2027-08-08', '2027-08-06', '2027-08-10')).toEqual({ top: true, right: true, bottom: true, left: false });
    expect(outlineEdges('2027-08-09', '2027-08-06', '2027-08-10')).toEqual({ top: true, right: false, bottom: true, left: true });
  });

  it('leaves out inner edges of a multi-week range', () => {
    // Mon 2 – Sun 15 Aug 2027: two full weeks
    expect(outlineEdges('2027-08-04', '2027-08-02', '2027-08-15')).toEqual({ top: true, right: false, bottom: false, left: false });
    expect(outlineEdges('2027-08-11', '2027-08-02', '2027-08-15')).toEqual({ top: false, right: false, bottom: true, left: false });
  });
});

describe('monthEdges (CAL-3)', () => {
  it('steps around the first of the month', () => {
    // 1 Sep 2027 is a Wednesday.
    expect(monthEdges('2027-09-01')).toEqual({ top: true, left: true });
    expect(monthEdges('2027-09-02')).toEqual({ top: true, left: false });
    expect(monthEdges('2027-09-06')).toEqual({ top: true, left: false }); // Monday after: still the first row of September
    expect(monthEdges('2027-09-08')).toEqual({ top: false, left: false });
    expect(monthEdges('2027-08-31')).toEqual({ top: false, left: false });
  });
});
