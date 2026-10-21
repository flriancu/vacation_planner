import { addDays, makeDate, weekday, type ISODate } from '../domain/dates';

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
  /**
   * Set on the first week of a month band: the first of that month. A band is the run of weeks
   * whose Monday falls in the month, so it starts where the stepped month line meets the left edge.
   */
  month?: ISODate;
  /** Length of the band in weeks (on the band's first week only). */
  span?: number;
}

export function buildWeeks(from: ISODate, to: ISODate): WeekModel[] {
  const weeks: WeekModel[] = [];
  for (let monday = from; monday <= to; monday = addDays(monday, 7)) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const startsBand = weeks.length === 0 || weeks.at(-1)!.monday.slice(0, 7) !== monday.slice(0, 7);
    weeks.push({ monday, days, ...(startsBand && { month: `${monday.slice(0, 7)}-01`, span: 0 }) });
  }
  let band: WeekModel | undefined;
  for (const w of weeks) {
    if (w.month) band = w;
    band!.span! += 1;
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
