/** Longest name shown whole, in characters as people see them; longer ones end in "…" (a name is a label, not a text). */
export const MAX_NAME = 60;

// Control characters (a newline would start a fake line in a tooltip), bidirectional marks,
// overrides and isolates (they turn the rest of a line around), and invisible ones: zero-width
// space, word joiner and invisible operators, the byte-order mark, the Mongolian vowel separator.
// The zero-width joiner and non-joiner stay: emoji sequences and some scripts need them.
const HIDDEN = /[\p{Cc}؜᠎​‎‏‪-‮⁠-⁩﻿]/gu;
// Blank but not spaces: a name of only these would look empty.
const BLANK = /^[\s­⠀ㅤﾠᅟᅠ\u{e0000}-\u{e007f}]*$/u;
/** More combining marks than this on one letter pile up over the lines around it. */
const MAX_MARKS = 2;

const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/**
 * A name written by someone else (a person, a leave type, a holiday, a file), made safe to show
 * on one line: no characters that hide, reorder or break the text around it, spaces collapsed,
 * at most two accents on a letter, and at most `max` characters (whole emoji and letters, never
 * half of one). Empty when nothing visible is left.
 */
export function displayName(text: string, max = MAX_NAME): string {
  const clean = text
    .replace(HIDDEN, ' ')
    .replace(new RegExp(`(\\p{M}{${MAX_MARKS}})\\p{M}+`, 'gu'), '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (BLANK.test(clean)) return '';
  const chars = graphemes ? [...graphemes.segment(clean)].map((s) => s.segment) : [...clean];
  return chars.length > max
    ? `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
    : clean;
}
