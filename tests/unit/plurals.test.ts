import { describe, expect, it } from 'vitest';
import { pluralize } from '../../src/i18n/plurals';

describe('pluralize', () => {
  it.each([
    [1, '1 zi de concediu'],
    [2, '2 zile de concediu'],
    [19, '19 zile de concediu'],
    [20, '20 de zile de concediu'],
    [101, '101 zile de concediu'],
  ])('ro %i → %s', (n, expected) => {
    expect(pluralize('ro', 'leaveDays', n)).toBe(expected);
  });

  it('uses one/other in English', () => {
    expect(pluralize('en', 'days', 1)).toBe('1 day');
    expect(pluralize('en', 'days', 5)).toBe('5 days');
    expect(pluralize('en', 'floatingDays', 2)).toBe('2 floating days');
  });
});
