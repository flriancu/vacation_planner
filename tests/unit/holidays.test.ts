import { describe, expect, it } from 'vitest';
import { holidaysBetween, orthodoxEaster, publicHolidays } from '../../src/domain/holidays';
import type { HolidayOverride } from '../../src/domain/schema';

const dates = (year: number, overrides: HolidayOverride[] = []) => publicHolidays(year, overrides).map((h) => h.date);

function override(data: Omit<HolidayOverride, 'id' | 'createdAt' | 'updatedAt'>, n: number): HolidayOverride {
  const stamp = `2026-01-01T00:00:0${n}Z`;
  return { ...data, id: `o${n}`, createdAt: stamp, updatedAt: stamp };
}

describe('orthodoxEaster', () => {
  it.each([
    [2023, '2023-04-16'],
    [2025, '2025-04-20'],
    [2026, '2026-04-12'],
    [2027, '2027-05-02'],
    [2028, '2028-04-16'],
  ])('%i → %s', (year, expected) => {
    expect(orthodoxEaster(year)).toBe(expected);
  });

  it('refuses years outside 1900–2099', () => {
    expect(() => orthodoxEaster(2100)).toThrow();
  });
});

describe('publicHolidays', () => {
  it('lists every 2025 holiday (DAY-1)', () => {
    expect(dates(2025)).toEqual([
      '2025-01-01', '2025-01-02', '2025-01-06', '2025-01-07', '2025-01-24',
      '2025-04-18', '2025-04-20', '2025-04-21', '2025-05-01', '2025-06-01',
      '2025-06-08', '2025-06-09', '2025-08-15', '2025-11-30', '2025-12-01',
      '2025-12-25', '2025-12-26',
    ]);
  });

  it('puts Rusalii 49 and 50 days after Easter', () => {
    const y2027 = publicHolidays(2027);
    expect(y2027.find((h) => h.keys.includes('pentecost'))?.date).toBe('2027-06-20');
    expect(y2027.find((h) => h.keys.includes('pentecostMonday'))?.date).toBe('2027-06-21');
  });

  it('keeps both names when two holidays coincide (1 Jun 2026)', () => {
    const jun1 = publicHolidays(2026).find((h) => h.date === '2026-06-01')!;
    expect(jun1.keys).toEqual(['childrensDay', 'pentecostMonday']);
    expect(jun1.names.map((n) => n.en)).toEqual(["Children's Day", 'Orthodox Pentecost Monday']);
  });

  it('has no 6–7 January before they became law', () => {
    expect(dates(2023)).not.toContain('2023-01-06');
    expect(dates(2025)).toContain('2025-01-06');
  });

  it('applies overrides in creation order (DAY-3)', () => {
    const name = { ro: 'Zi nouă', en: 'New day' };
    const result = publicHolidays(2025, [
      override({ date: '2025-03-03', action: 'add', name }, 1),
      override({ date: '2025-01-24', action: 'remove' }, 2),
      override({ date: '2025-08-15', action: 'rename', name: { ro: 'Sf. Maria', en: 'St Mary' } }, 3),
      override({ date: '2025-12-01', action: 'remove', deleted: true }, 4),
      override({ date: '2026-05-04', action: 'add', name }, 5), // other year
    ]);
    const byDate = new Map(result.map((h) => [h.date, h]));
    expect(byDate.get('2025-03-03')?.names).toEqual([name]);
    expect(byDate.has('2025-01-24')).toBe(false);
    expect(byDate.get('2025-08-15')?.names[0]?.ro).toBe('Sf. Maria');
    expect(byDate.has('2025-12-01')).toBe(true);
    expect(result).toHaveLength(17);
  });

  it('collects holidays across a year boundary', () => {
    expect([...holidaysBetween('2025-12-20', '2026-01-10').keys()]).toEqual([
      '2025-12-25', '2025-12-26', '2026-01-01', '2026-01-02', '2026-01-06', '2026-01-07',
    ]);
  });
});
