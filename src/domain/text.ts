/** Longest name shown whole; longer ones end in "…" (a name is a label, not a text). */
export const MAX_NAME = 60;

// Control characters (a newline would start a fake line in a tooltip), bidirectional overrides
// and isolates (they turn the rest of a line around), and zero-width characters (invisible names).
const HIDDEN = /[\p{Cc}​-‏‪-‮⁠-⁩﻿]/gu;

/**
 * A name written by someone else (a person, a leave type, a holiday, a file), made safe to show
 * on one line: no characters that hide, reorder or break the text around it, spaces collapsed,
 * and at most `max` characters. Empty when nothing visible is left.
 */
export function displayName(text: string, max = MAX_NAME): string {
  const clean = text.replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...clean];
  return chars.length > max
    ? `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
    : clean;
}
