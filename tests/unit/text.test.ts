import { describe, expect, it } from 'vitest';
import { displayName } from '../../src/domain/text';

describe('displayName: names written by someone else', () => {
  it('keeps them on one line, in their own order', () => {
    expect(displayName('Mihai\nToți sunteți liberi')).toBe('Mihai Toți sunteți liberi');
    expect(displayName('ab\u202ecd\u061cef')).toBe('ab cd ef');
  });

  it('cuts at whole characters: an emoji is never split', () => {
    const family = '👨‍👩‍👧‍👦';
    expect(displayName(family.repeat(70))).toBe(`${family.repeat(59)}…`);
    expect(displayName('🇷🇴'.repeat(61))).toBe(`${'🇷🇴'.repeat(59)}…`);
  });

  it('treats a name of blank characters as no name, and stops accents piling up', () => {
    expect(displayName('\u3164\u2800\u00ad')).toBe('');
    expect(displayName(`a${'\u0301'.repeat(60)}`)).toBe('a\u0301\u0301');
  });
});
