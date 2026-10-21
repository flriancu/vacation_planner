import { addDays, makeDate, type ISODate } from './dates';
import type { HolidayOverride, Names } from './schema';

/** Romanian public holidays, Labor Code art. 139 (DAY-1). */
export type HolidayKey =
  | 'newYear'
  | 'newYear2'
  | 'epiphany'
  | 'stJohn'
  | 'unionDay'
  | 'goodFriday'
  | 'easter'
  | 'easterMonday'
  | 'labourDay'
  | 'childrensDay'
  | 'pentecost'
  | 'pentecostMonday'
  | 'dormition'
  | 'stAndrew'
  | 'nationalDay'
  | 'christmas'
  | 'christmas2';

export interface Holiday {
  date: ISODate;
  /** Rules that fall on this date; empty for a holiday added by an override. */
  keys: HolidayKey[];
  /** One entry per holiday on this date (two holidays can coincide, e.g. 1 Jun 2026). */
  names: Names[];
}

interface Rule {
  key: HolidayKey;
  names: Names;
  /** First year the day was a legal holiday. */
  since: number;
  date: (year: number, easter: ISODate) => ISODate;
}

const fixed = (month: number, day: number) => (year: number) => makeDate(year, month, day);
const fromEaster = (offset: number) => (_year: number, easter: ISODate) => addDays(easter, offset);

const RULES: readonly Rule[] = [
  { key: 'newYear', since: 0, date: fixed(1, 1), names: { ro: 'Anul Nou', en: "New Year's Day" } },
  { key: 'newYear2', since: 0, date: fixed(1, 2), names: { ro: 'A doua zi de Anul Nou', en: "Day after New Year's Day" } },
  { key: 'epiphany', since: 2024, date: fixed(1, 6), names: { ro: 'Boboteaza', en: 'Epiphany' } },
  { key: 'stJohn', since: 2024, date: fixed(1, 7), names: { ro: 'Sfântul Ioan Botezătorul', en: 'St John the Baptist' } },
  {
    key: 'unionDay',
    since: 2017,
    date: fixed(1, 24),
    names: { ro: 'Ziua Unirii Principatelor Române', en: 'Union of the Romanian Principalities' },
  },
  { key: 'goodFriday', since: 2018, date: fromEaster(-2), names: { ro: 'Vinerea Mare', en: 'Orthodox Good Friday' } },
  { key: 'easter', since: 0, date: fromEaster(0), names: { ro: 'Paștele', en: 'Orthodox Easter' } },
  { key: 'easterMonday', since: 0, date: fromEaster(1), names: { ro: 'A doua zi de Paște', en: 'Orthodox Easter Monday' } },
  { key: 'labourDay', since: 0, date: fixed(5, 1), names: { ro: 'Ziua Muncii', en: 'Labour Day' } },
  { key: 'childrensDay', since: 2017, date: fixed(6, 1), names: { ro: 'Ziua Copilului', en: "Children's Day" } },
  { key: 'pentecost', since: 2008, date: fromEaster(49), names: { ro: 'Rusaliile', en: 'Orthodox Pentecost' } },
  { key: 'pentecostMonday', since: 2008, date: fromEaster(50), names: { ro: 'A doua zi de Rusalii', en: 'Orthodox Pentecost Monday' } },
  { key: 'dormition', since: 2009, date: fixed(8, 15), names: { ro: 'Adormirea Maicii Domnului', en: 'Dormition of the Mother of God' } },
  { key: 'stAndrew', since: 2012, date: fixed(11, 30), names: { ro: 'Sfântul Andrei', en: "St Andrew's Day" } },
  { key: 'nationalDay', since: 0, date: fixed(12, 1), names: { ro: 'Ziua Națională a României', en: 'Romanian National Day' } },
  { key: 'christmas', since: 0, date: fixed(12, 25), names: { ro: 'Crăciunul', en: 'Christmas Day' } },
  { key: 'christmas2', since: 0, date: fixed(12, 26), names: { ro: 'A doua zi de Crăciun', en: 'Second day of Christmas' } },
];

/** Holidays that always fall on a Sunday, so they never earn a swap day. */
export const ALWAYS_SUNDAY: ReadonlySet<HolidayKey> = new Set(['easter', 'pentecost']);

/**
 * Orthodox Easter Sunday as a Gregorian date: Meeus' Julian algorithm, then
 * +13 days from the Julian to the Gregorian calendar (valid 1900–2099).
 */
export function orthodoxEaster(year: number): ISODate {
  if (year < 1900 || year > 2099) throw new Error(`Orthodox Easter is supported for 1900–2099, not ${year}`);
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return addDays(makeDate(year, month, day), 13);
}

/**
 * Public holidays of `year`, sorted by date, with the overrides for that year
 * applied in creation order (DAY-3). Deleted overrides are ignored.
 */
export function publicHolidays(year: number, overrides: readonly HolidayOverride[] = []): Holiday[] {
  const easter = orthodoxEaster(year);
  const byDate = new Map<ISODate, Holiday>();
  for (const rule of RULES) {
    if (year < rule.since) continue;
    const date = rule.date(year, easter);
    const h = byDate.get(date) ?? { date, keys: [], names: [] };
    h.keys.push(rule.key);
    h.names.push(rule.names);
    byDate.set(date, h);
  }

  const prefix = `${year}-`;
  const mine = overrides.filter((o) => !o.deleted && o.date.startsWith(prefix)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const o of mine) {
    if (o.action === 'remove') {
      byDate.delete(o.date);
    } else if (o.name) {
      const h = byDate.get(o.date);
      if (o.action === 'rename' && h) h.names = [o.name];
      else if (o.action === 'add')
        byDate.set(o.date, h ? { ...h, names: [...h.names, o.name] } : { date: o.date, keys: [], names: [o.name] });
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Holidays of every year that touches `from`–`to`, keyed by date. */
export function holidaysBetween(from: ISODate, to: ISODate, overrides: readonly HolidayOverride[] = []): Map<ISODate, Holiday> {
  const out = new Map<ISODate, Holiday>();
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const h of publicHolidays(y, overrides)) if (h.date >= from && h.date <= to) out.set(h.date, h);
  }
  return out;
}
