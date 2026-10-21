import type { DayInfo } from '../domain/calendar';
import { addDays, makeDate, weekday, type ISODate } from '../domain/dates';
import type { Holiday } from '../domain/holidays';

/**
 * The weeks shown for `year` (CAL-2): from the week of 15 Dec before to the
 * week of 15 Jan after, so the Christmas–Epiphany break is whole at both ends.
 */
export function viewRange(year: number): { from: ISODate; to: ISODate } {
  const dec15 = makeDate(year - 1, 12, 15);
  const jan15 = makeDate(year + 1, 1, 15);
  return { from: addDays(dec15, -weekday(dec15)), to: addDays(jan15, 6 - weekday(jan15)) };
}

export interface WeekModel {
  monday: ISODate;
  days: ISODate[];
  /** First day of the month named beside this week: the month starting in it, or the first week's month. */
  month?: ISODate;
  /** Holidays in this week, for the notes column (CAL-5). */
  holidays: Holiday[];
}

export function buildWeeks(from: ISODate, to: ISODate, days: Map<ISODate, DayInfo>): WeekModel[] {
  const weeks: WeekModel[] = [];
  for (let monday = from; monday <= to; monday = addDays(monday, 7)) {
    const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const first = week.find((d) => d.endsWith('-01')) ?? (weeks.length === 0 ? `${monday.slice(0, 7)}-01` : undefined);
    weeks.push({
      monday,
      days: week,
      ...(first && { month: first }),
      holidays: week.flatMap((d) => days.get(d)?.holiday ?? []),
    });
  }
  return weeks;
}

export interface Edges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

/** Which sides of a day cell are on the outline of the range `start`–`end` (CAL-6). */
export function outlineEdges(date: ISODate, start: ISODate, end: ISODate): Edges {
  const inside = (d: ISODate) => d >= start && d <= end;
  const wd = weekday(date);
  return {
    top: !inside(addDays(date, -7)),
    bottom: !inside(addDays(date, 7)),
    left: wd === 0 || !inside(addDays(date, -1)),
    right: wd === 6 || !inside(addDays(date, 1)),
  };
}

/** The stepped month separator (CAL-3): a line above the first week's days of a month and left of its first day. */
export function monthEdges(date: ISODate): { top: boolean; left: boolean } {
  const month = date.slice(0, 7);
  return {
    top: addDays(date, -7).slice(0, 7) !== month,
    left: weekday(date) > 0 && addDays(date, -1).slice(0, 7) !== month,
  };
}

export function orderRange(a: ISODate, b: ISODate): [ISODate, ISODate] {
  return a <= b ? [a, b] : [b, a];
}

export function clampDate(date: ISODate, from: ISODate, to: ISODate): ISODate {
  return date < from ? from : date > to ? to : date;
}
