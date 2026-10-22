import { describe, expect, it } from 'vitest';
import { weekday } from '../../src/domain/dates';
import type { Block } from '../../src/domain/schema';
import { buildWeeks, monthEdges, nestLevels, outlineEdges, viewRange } from '../../src/ui/calendarModel';

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
  it('starts a month band at the first week whose Monday is in that month', () => {
    const { from, to } = viewRange(2027);
    const weeks = buildWeeks(from, to);
    expect(weeks).toHaveLength(57);
    const bands = weeks.filter((w) => w.month);
    expect(bands).toHaveLength(14); // the December before, Jan–Dec, the January after
    expect(bands[0]).toMatchObject({ monday: '2026-12-14', month: '2026-12-01', span: 3 });
    expect(bands[1]).toMatchObject({ monday: '2027-01-04', month: '2027-01-01', span: 4 });
    expect(bands.at(-1)).toMatchObject({ monday: '2028-01-03', month: '2028-01-01', span: 2 });
    expect(bands.reduce((n, w) => n + w.span!, 0)).toBe(57);
  });
});

// Thu 5 – Wed 18 Aug 2027: row 1 Thu 5–Sun 8, row 2 the whole week, row 3 Mon 16–Wed 18.
const e = (d: string) => outlineEdges(d, '2027-08-05', '2027-08-18').corners;

describe('outlineEdges (CAL-6)', () => {
  it('marks the inner corners of a range that steps across week rows', () => {
    // Row 1 starts on Thu 5, so the outline turns at the top left of Thu 12.
    expect(e('2027-08-12').tl).toBe(true);
    expect(e('2027-08-13').tl).toBe(false);
    // Row 3 ends on Wed 18, so it turns again at the bottom right of Wed 11.
    expect(e('2027-08-11').br).toBe(true);
    expect(e('2027-08-10').br).toBe(false);
  });

  it('outlines a range that crosses a week boundary', () => {
    // Fri 6 – Tue 10 Aug 2027
    expect(outlineEdges('2027-08-06', '2027-08-06', '2027-08-10')).toMatchObject({ top: true, right: false, bottom: true, left: true });
    expect(outlineEdges('2027-08-08', '2027-08-06', '2027-08-10')).toMatchObject({ top: true, right: true, bottom: true, left: false });
    expect(outlineEdges('2027-08-09', '2027-08-06', '2027-08-10')).toMatchObject({ top: true, right: false, bottom: true, left: true });
  });

  it('leaves out inner edges of a multi-week range', () => {
    // Mon 2 – Sun 15 Aug 2027: two full weeks
    expect(outlineEdges('2027-08-04', '2027-08-02', '2027-08-15')).toMatchObject({ top: true, right: false, bottom: false, left: false });
    expect(outlineEdges('2027-08-11', '2027-08-02', '2027-08-15')).toMatchObject({ top: false, right: false, bottom: true, left: false });
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

const block = (id: string, start: string, end: string) => ({ id, start, end }) as Block;

describe('nestLevels (CAL-6)', () => {
  it('puts an enclosing block outside, and keeps each level the same on every day', () => {
    // Planned Mon 8 – Fri 12 March; an idea Wed 10 – Wed 17 only partly overlaps it.
    const levels = nestLevels([block('idea', '2027-03-10', '2027-03-17'), block('leave', '2027-03-08', '2027-03-12')]);
    expect(levels.get('leave')).toBe(0);
    expect(levels.get('idea')).toBe(1); // also on 15–17, where the leave has ended
  });

  it('draws a block that lies inside another inside it, whatever came before', () => {
    // An idea 4–13 Jan, leave 8–29 Jan, an idea 18–20 Jan inside the leave.
    const levels = nestLevels([
      block('a', '2027-01-04', '2027-01-13'),
      block('leave', '2027-01-08', '2027-01-29'),
      block('in', '2027-01-18', '2027-01-20'),
    ]);
    expect(levels.get('in')!).toBeGreaterThan(levels.get('leave')!);
  });

  it('reuses a level once the block holding it has ended', () => {
    const levels = nestLevels([
      block('a', '2027-03-01', '2027-03-31'),
      block('b', '2027-03-02', '2027-03-04'),
      block('c', '2027-03-10', '2027-03-12'),
    ]);
    expect([levels.get('a'), levels.get('b'), levels.get('c')]).toEqual([0, 1, 1]);
  });
});
