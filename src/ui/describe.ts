import type { BlockStats } from '../domain/blocks';
import type { Budget } from '../domain/schema';
import type { I18n } from '../i18n';
import type { PluralKey } from '../i18n/plurals';

const SPEND: Record<Budget, PluralKey | null> = { annual: 'leaveDays', excused: 'excusedDays', none: null };
const WEEKDAY: Intl.DateTimeFormatOptions = { weekday: 'long' };
const DAY_MONTH: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
const DAY_MONTH_YEAR: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };

export interface BlockDescription {
  /** "Folosești 1 zi de concediu"; absent for types that spend nothing (swap, office closed, sick…). */
  spend?: string;
  /** "→ ești liber 5 zile la rând: vineri 27 noiembrie – marți 1 decembrie" */
  get: string;
  /** Both on one line, for tooltips and screen readers. */
  sentence: string;
}

/** Plain-language summary of what a block costs and the break it gives. */
export function describeBlock({ t, plural, date }: I18n, stats: BlockStats, budget: Budget): BlockDescription {
  // Full names, no abbreviations; the year only when the break crosses New Year.
  // The weekday is formatted on its own: Romanian Intl would put a comma after it.
  const withYear = stats.breakStart.slice(0, 4) !== stats.breakEnd.slice(0, 4);
  const day = (d: string) => `${date(d, WEEKDAY)} ${date(d, withYear ? DAY_MONTH_YEAR : DAY_MONTH)}`;
  const range = stats.breakStart === stats.breakEnd ? day(stats.breakStart) : `${day(stats.breakStart)} – ${day(stats.breakEnd)}`;
  const get = stats.gain === 1 ? t('block.getOne', { range }) : t('block.get', { days: plural('days', stats.gain), range });
  const key = SPEND[budget];
  if (!key) {
    const sentence = get.charAt(0).toLocaleUpperCase() + get.slice(1);
    return { get: sentence, sentence };
  }
  const spend = stats.cost === 0 ? t('block.spendNone') : t('block.spend', { cost: plural(key, stats.cost) });
  return { spend, get: `→ ${get}`, sentence: `${spend} → ${get}` };
}
