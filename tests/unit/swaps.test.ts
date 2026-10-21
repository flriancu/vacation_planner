import { describe, expect, it } from 'vitest';
import { swapHolidaysFor, swapReminders } from '../../src/domain/swaps';
import { DocBuilder } from '../fixtures/builder';
import { demo2027 } from '../fixtures/demo2027';

const summary = (b: DocBuilder, year: number) =>
  swapReminders(b.doc, b.personId, year).map((r) => ({
    holiday: r.holiday.date,
    options: r.options,
    resolvedBy: r.resolvedBy?.start,
    open: r.open,
  }));

describe('swapReminders (DAY-4)', () => {
  it('lists the six 2027 weekend holidays, without Easter or Rusalii Sunday', () => {
    expect(summary(demo2027(), 2027)).toEqual([
      // Friday 1 Jan is itself a holiday, so only Monday is possible.
      { holiday: '2027-01-02', options: ['2027-01-04'], resolvedBy: '2027-01-04', open: false },
      { holiday: '2027-01-24', options: ['2027-01-22', '2027-01-25'], resolvedBy: undefined, open: true },
      // Good Friday and Easter Monday surround 1 May: no option at all.
      { holiday: '2027-05-01', options: [], resolvedBy: undefined, open: true },
      { holiday: '2027-08-15', options: ['2027-08-13', '2027-08-16'], resolvedBy: '2027-08-16', open: false },
      { holiday: '2027-12-25', options: ['2027-12-24', '2027-12-27'], resolvedBy: '2027-12-24', open: false },
      // 24 Dec is taken by the 25 Dec swap, so only Monday is left; dismissed.
      { holiday: '2027-12-26', options: ['2027-12-27'], resolvedBy: undefined, open: false },
    ]);
  });

  it('offers only Friday when the Monday after is a holiday (30 Nov 2031)', () => {
    const b = new DocBuilder();
    const nov30 = swapReminders(b.doc, b.personId, 2031).find((r) => r.holiday.date === '2031-11-30')!;
    expect(nov30.options).toEqual(['2031-11-28']);
  });

  it('looks across the year boundary for the Friday before a 1 January Saturday', () => {
    const b = new DocBuilder();
    const jan1 = swapReminders(b.doc, b.personId, 2022).find((r) => r.holiday.date === '2022-01-01')!;
    expect(jan1.options).toEqual(['2021-12-31', '2022-01-03']);
  });

  it('does not count an idea block as resolving a reminder', () => {
    const b = new DocBuilder();
    b.block('swap', '2027-01-22', '2027-01-22', 'idea', { swapFor: '2027-01-24' });
    const jan24 = swapReminders(b.doc, b.personId, 2027).find((r) => r.holiday.date === '2027-01-24')!;
    expect(jan24.open).toBe(true);
    expect(jan24.options).toEqual(['2027-01-22', '2027-01-25']);
  });
});

describe('swapHolidaysFor (DAY-4)', () => {
  const doc = new DocBuilder().doc;
  const dates = (d: string) => swapHolidaysFor(doc, d).map((h) => h.date);

  it('is the Friday before or the Monday after a weekend with a holiday', () => {
    expect(dates('2027-08-16')).toEqual(['2027-08-15']); // Mon after Sun 15 Aug
    expect(dates('2027-12-24')).toEqual(['2027-12-25', '2027-12-26']); // Fri before Sat 25 / Sun 26 Dec
    expect(dates('2027-12-31')).toEqual(['2028-01-01', '2028-01-02']); // across the year
  });

  it('is nothing on any other day', () => {
    expect(dates('2027-08-17')).toEqual([]); // a Tuesday
    expect(dates('2027-08-20')).toEqual([]); // the Friday before a weekend without a holiday
    expect(dates('2027-01-01')).toEqual([]); // a Friday that is itself a holiday
    expect(dates('2027-08-15')).toEqual([]); // the weekend holiday itself
  });
});
