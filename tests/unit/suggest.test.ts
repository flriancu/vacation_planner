import { describe, expect, it } from 'vitest';
import { buildDays } from '../../src/domain/calendar';
import { addDays, daysBetween, type ISODate } from '../../src/domain/dates';
import { suggest, swapOptionScores, type Candidate } from '../../src/domain/suggest';
import { swapReminders } from '../../src/domain/swaps';
import { DocBuilder } from '../fixtures/builder';
import { demo2027 } from '../fixtures/demo2027';

const find = (list: Candidate[], start: string, end: string) => list.find((c) => c.start === start && c.end === end && !c.assumesSwap);

/** Hand-checked breaks in the demo year (REQUIREMENTS §7). */
const DEMO_BREAKS: readonly { start: ISODate; end: ISODate; leave: ISODate[] }[] = [
  { start: '2027-01-01', end: '2027-01-07', leave: ['2027-01-05'] },
  { start: '2027-01-01', end: '2027-01-10', leave: ['2027-01-05', '2027-01-08'] },
  { start: '2027-04-24', end: '2027-05-03', leave: ['2027-04-26', '2027-04-27', '2027-04-28', '2027-04-29'] },
  { start: '2027-04-30', end: '2027-05-09', leave: ['2027-05-04', '2027-05-05', '2027-05-06', '2027-05-07'] },
  { start: '2027-05-29', end: '2027-06-02', leave: ['2027-06-02'] },
  { start: '2027-05-29', end: '2027-06-06', leave: ['2027-06-02', '2027-06-03', '2027-06-04'] },
  { start: '2027-08-13', end: '2027-08-16', leave: ['2027-08-13'] },
  { start: '2027-12-24', end: '2028-01-02', leave: ['2027-12-27'] },
];

describe('suggest: hand-checked breaks in the demo year (REQUIREMENTS §7)', () => {
  const b = demo2027();
  const list = suggest(b.doc, b.personId, 2027);

  it.each(DEMO_BREAKS.map((s) => [`${s.start} – ${s.end}`, s] as const))('%s', (_label, s) => {
    const c = find(list, s.start, s.end);
    expect(c, 'candidate missing').toBeDefined();
    expect(c!.leaveDays).toEqual(s.leave);
    expect(c!.gain).toBe(daysBetween(s.start, s.end).length);
    // One floating day is still unplaced, so it pays first (SUG-7).
    expect(c!.split).toEqual({ floating: 1, excused: 0, annual: s.leave.length - 1 });
  });

  it('ranks the Christmas break first: 1 leave day for 10 days off', () => {
    expect(list[0]).toMatchObject({ start: '2027-12-24', end: '2028-01-02', ratio: 10 });
  });

  it('names the holidays each break builds on', () => {
    expect(find(list, '2027-08-13', '2027-08-16')!.holidays.map((h) => h.names[0]!.ro)).toEqual(['Adormirea Maicii Domnului']);
  });
});

describe('suggest: matches a brute-force search (SUG-1)', () => {
  it.each([3, 5])('maxCost %i', (maxCost) => {
    const b = demo2027();
    const days = buildDays(b.doc, b.personId, '2026-10-01', '2028-03-31');
    const off = (d: ISODate) => days.get(d)!.off;
    const expected: string[] = [];
    // Every range overlapping 2027 with working days on both sides, at least one
    // anchor day inside and 1..maxCost working days to pay for.
    for (const start of daysBetween('2026-11-01', '2027-12-31')) {
      if (off(addDays(start, -1))) continue;
      for (let len = 1; len <= 45; len++) {
        const end = addDays(start, len - 1);
        if (end < '2027-01-01' || off(addDays(end, 1))) continue;
        const range = daysBetween(start, end);
        const cost = range.filter((d) => !off(d)).length;
        if (cost >= 1 && cost <= maxCost && range.some((d) => days.get(d)!.anchor)) expected.push(`${start}|${end}`);
      }
    }
    const actual = suggest(b.doc, b.personId, 2027, { maxCost })
      .filter((c) => !c.assumesSwap)
      .map((c) => `${c.start}|${c.end}`);
    expect(actual.sort()).toEqual(expected.sort());
  });
});

describe('suggest: rules', () => {
  it('ranks by ratio, then by gain, then by date (SUG-2)', () => {
    const b = demo2027();
    const list = suggest(b.doc, b.personId, 2027);
    for (let i = 1; i < list.length; i++) {
      const [p, c] = [list[i - 1]!, list[i]!];
      expect(p.ratio > c.ratio || (p.ratio === c.ratio && (p.gain > c.gain || (p.gain === c.gain && p.start <= c.start)))).toBe(true);
    }
  });

  it('drops dismissed suggestions (SUG-3)', () => {
    const b = demo2027();
    b.add('dismissals', { personId: b.personId, kind: 'suggestion', start: '2027-08-13', end: '2027-08-16' });
    expect(find(suggest(b.doc, b.personId, 2027), '2027-08-13', '2027-08-16')).toBeUndefined();
  });

  it('pays floating, then excused, then annual leave (SUG-7)', () => {
    const b = new DocBuilder();
    b.year(2027, { annualOpening: 21, floatingQuota: 1, excusedQuota: 2 });
    expect(find(suggest(b.doc, b.personId, 2027), '2027-04-24', '2027-05-03')!.split).toEqual({ floating: 1, excused: 2, annual: 1 });
    const none = new DocBuilder();
    none.year(2027, { annualOpening: 21 });
    expect(find(suggest(none.doc, none.personId, 2027), '2027-04-24', '2027-05-03')!.split).toEqual({ floating: 0, excused: 0, annual: 4 });
  });

  it('offers candidates for each option of an open swap reminder (SUG-8)', () => {
    const b = demo2027();
    const withSwap = suggest(b.doc, b.personId, 2027).filter((c) => c.assumesSwap?.holiday === '2027-01-24');
    // Thu 21 Jan leave + Fri 22 swap + weekend (Sun 24 holiday).
    expect(withSwap.find((c) => c.start === '2027-01-21')).toMatchObject({
      end: '2027-01-24',
      cost: 1,
      assumesSwap: { date: '2027-01-22' },
    });
    // Weekend + Mon 25 swap + Tue 26 leave.
    expect(withSwap.find((c) => c.start === '2027-01-23')).toMatchObject({
      end: '2027-01-26',
      cost: 1,
      assumesSwap: { date: '2027-01-25' },
    });
    // 1 May has no options, so it adds nothing.
    expect(suggest(b.doc, b.personId, 2027).some((c) => c.assumesSwap?.holiday === '2027-05-01')).toBe(false);
  });

  it('treats planned leave as already off, and keeps ideas out of the way', () => {
    const b = new DocBuilder();
    b.block('annual', '2031-08-11', '2031-08-14', 'planned');
    b.block('annual', '2031-04-15', '2031-04-18', 'idea');
    const list = suggest(b.doc, b.personId, 2031);
    // 15 Aug (Fri) + weekend joined to the planned 11–14 Aug: only 8 Aug left to add.
    expect(find(list, '2031-08-08', '2031-08-17')).toMatchObject({ cost: 1, leaveDays: ['2031-08-08'] });
    // The idea doesn't make 15–18 Apr free: Easter (11–14 Apr) + those 4 days + weekend.
    expect(find(list, '2031-04-11', '2031-04-20')).toMatchObject({ cost: 4 });
  });
});

describe('swapOptionScores (DAY-5)', () => {
  it('scores both options of 24 Jan 2027 when no swap is entered yet', () => {
    const b = new DocBuilder();
    const reminder = swapReminders(b.doc, b.personId, 2027).find((r) => r.holiday.date === '2027-01-24')!;
    const scores = swapOptionScores(b.doc, b.personId, reminder);
    expect(scores.map((s) => [s.date, s.runLength])).toEqual([
      ['2027-01-22', 3],
      ['2027-01-25', 3],
    ]);
    for (const s of scores) expect(s.best!.start <= s.date && s.date <= s.best!.end).toBe(true);
  });
});
