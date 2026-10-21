import { describe, expect, it } from 'vitest';
import { yearBalance } from '../../src/domain/balance';
import { getYearSettings, typeByKey } from '../../src/domain/schema';
import { DocBuilder } from '../fixtures/builder';
import { demo2027 } from '../fixtures/demo2027';

describe('yearBalance', () => {
  it('splits used and reserved at today, and adds adjustments (BAL-1..3)', () => {
    const b = new DocBuilder();
    b.year(2031, { annualOpening: 21 });
    b.add('adjustments', { personId: b.personId, year: 2031, date: '2031-01-01', days: 3, note: 'carry-over' });
    b.block('annual', '2031-04-10', '2031-04-18', 'approved'); // 5 working days, Easter inside
    b.block('annual', '2031-08-11', '2031-08-14', 'approved'); // 4, after today
    b.block('annual', '2031-10-06', '2031-10-07', 'planned'); // 2
    b.block('annual', '2031-12-22', '2031-12-24', 'idea'); // 3

    const bal = yearBalance(b.doc, b.personId, 2031, '2031-06-01');
    expect(bal.annual).toEqual({ opening: 21, adjustments: 3, total: 24, used: 5, reserved: 6, available: 13, ideas: 3, ifIdeas: 10 });
    expect(bal.overbooked.annual).toBe(false);
  });

  it('charges a day once, to its highest-status block', () => {
    const b = new DocBuilder();
    b.year(2025, { annualOpening: 5 });
    b.block('annual', '2025-03-03', '2025-03-07', 'idea');
    b.block('annual', '2025-03-05', '2025-03-05', 'planned');
    const bal = yearBalance(b.doc, b.personId, 2025, '2025-01-01');
    expect(bal.annual).toMatchObject({ reserved: 1, ideas: 4, available: 4, ifIdeas: 0 });
  });

  it('warns when overbooked, without blocking (BAL-4)', () => {
    const b = new DocBuilder();
    b.year(2025, { annualOpening: 2 });
    b.block('annual', '2025-03-03', '2025-03-05', 'planned');
    expect(yearBalance(b.doc, b.personId, 2025, '2025-01-01').overbooked.annual).toBe(true);
  });

  it('keeps floating days on their own quota (LT-6)', () => {
    const b = demo2027();
    const bal = yearBalance(b.doc, b.personId, 2027, '2027-07-01');
    expect(bal.floating).toEqual({ quota: 2, total: 2, used: 0, reserved: 1, available: 1, ideas: 0, ifIdeas: 1 });
    expect(bal.annual.reserved + bal.annual.used).toBe(0); // swap and employer days are free
    expect(bal.expiring.floating).toBe(false);
  });

  it('warns from 1 October about unplaced floating days (BAL-6)', () => {
    const b = demo2027();
    expect(yearBalance(b.doc, b.personId, 2027, '2027-09-30').expiring.floating).toBe(false);
    expect(yearBalance(b.doc, b.personId, 2027, '2027-10-01').expiring.floating).toBe(true);
    b.block('floating', '2027-11-29', '2027-11-29', 'planned');
    expect(yearBalance(b.doc, b.personId, 2027, '2027-10-01').expiring.floating).toBe(false);
  });

  it('keeps excused leave on its own expiring quota (LT-6)', () => {
    const b = new DocBuilder();
    b.year(2027, { annualOpening: 21, excusedQuota: 2 });
    b.block('excused', '2027-03-12', '2027-03-12', 'approved');
    const bal = yearBalance(b.doc, b.personId, 2027, '2027-10-15');
    expect(bal.excused).toEqual({ quota: 2, total: 2, used: 1, reserved: 0, available: 1, ideas: 0, ifIdeas: 1 });
    expect(bal.expiring).toEqual({ floating: false, excused: true });
    expect(bal.annual.used).toBe(0);
  });

  it('charges employer days to annual leave in years set that way (LT-3)', () => {
    const b = demo2027();
    b.update('yearSettings', { ...getYearSettings(b.doc, b.personId, 2027)!, employerCountsAgainstAnnual: true });
    const bal = yearBalance(b.doc, b.personId, 2027, '2027-12-30');
    // 28–29 Dec are past (used); 30–31 Dec are still reserved.
    expect(bal.annual).toMatchObject({ used: 2, reserved: 2, available: 17 });
  });

  it('counts every leave type separately (LT-5)', () => {
    const b = new DocBuilder();
    b.block('sick', '2025-02-03', '2025-02-05', 'approved');
    b.block('special', '2025-09-12', '2025-09-12', 'planned');
    const bal = yearBalance(b.doc, b.personId, 2025, '2025-06-01');
    expect(bal.byType[typeByKey(b.doc, 'sick')!.id]).toEqual({ used: 3, reserved: 0, ideas: 0 });
    expect(bal.byType[typeByKey(b.doc, 'special')!.id]).toEqual({ used: 0, reserved: 1, ideas: 0 });
    expect(bal.annual.used + bal.annual.reserved).toBe(0);
  });
});
