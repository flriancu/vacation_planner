import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, diffDays, isWeekend, makeDate, overlaps, toUTC, weekday } from '../../src/domain/dates';

describe('dates', () => {
  it('counts weekdays from Monday = 0', () => {
    expect(weekday('2029-01-01')).toBe(0); // Monday
    expect(weekday('2029-01-07')).toBe(6); // Sunday
    expect(isWeekend('2029-01-06')).toBe(true);
    expect(isWeekend('2029-01-05')).toBe(false);
  });

  it('adds days across months, years and leap days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2028-12-31', 1)).toBe('2029-01-01');
    expect(addDays('2029-01-01', -1)).toBe('2028-12-31');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30'); // across the EU DST change
  });

  it('measures and lists ranges inclusively', () => {
    expect(diffDays('2025-12-21', '2026-01-07')).toBe(17);
    expect(daysBetween('2025-12-30', '2026-01-02')).toEqual(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
    expect(daysBetween('2025-01-02', '2025-01-01')).toEqual([]);
  });

  it('builds dates and rolls over like Date.UTC', () => {
    expect(makeDate(2025, 6, 1)).toBe('2025-06-01');
    expect(makeDate(2025, 1, 32)).toBe('2025-02-01');
  });

  it('rejects malformed and impossible dates', () => {
    expect(() => toUTC('2025-2-1')).toThrow();
    expect(() => toUTC('2025-02-30')).toThrow();
  });

  it('detects overlapping inclusive ranges', () => {
    expect(overlaps('2025-01-01', '2025-01-05', '2025-01-05', '2025-01-09')).toBe(true);
    expect(overlaps('2025-01-01', '2025-01-04', '2025-01-05', '2025-01-09')).toBe(false);
  });
});
