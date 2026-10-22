import { addDays, makeDate, overlaps, weekday, type ISODate } from '../domain/dates';
import type { Block } from '../domain/schema';

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

// Only office-closed days look like days off anyway; swap days are chosen and requested, so they look like leave.
const FREE_TYPES: ReadonlySet<string> = new Set(['closed']);

/** Whether leave of this type is drawn as a day off anyway (the calendar, the editor's swatches). */
export const looksFree = (typeKey: string | undefined) => FREE_TYPES.has(typeKey ?? '');

export interface Edges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
  /**
   * Inner corners: where the outline turns at a right angle around a neighbouring day, the
   * edge coming from the day above (or below) meets the edge of the day beside it inside this
   * day's corner, which neither of them draws.
   */
  corners: { tl: boolean; tr: boolean; bl: boolean; br: boolean };
}

/** Which sides of a day cell are on the outline of the range `start`–`end` (CAL-6). */
export function outlineEdges(date: ISODate, start: ISODate, end: ISODate): Edges {
  const inside = (d: ISODate) => d >= start && d <= end;
  const at = (n: number) => inside(addDays(date, n));
  const wd = weekday(date);
  const top = !at(-7);
  const bottom = !at(7);
  const left = wd === 0 || !at(-1);
  const right = wd === 6 || !at(1);
  return {
    top,
    bottom,
    left,
    right,
    corners: {
      tl: !top && !left && !at(-8),
      tr: !top && !right && !at(-6),
      bl: !bottom && !left && !at(6),
      br: !bottom && !right && !at(8),
    },
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

/**
 * Outlines nest by range, not by which block owns a day: earlier start first, then the longer
 * one, so the block that encloses another (leave around the office's closure) is outermost.
 */
export const byRange = (a: Block, b: Block) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end) || a.id.localeCompare(b.id);

/**
 * Each block's nesting level (0 = outermost), the same on every day it covers, so its outline
 * steps in by the same amount everywhere and stays one closed shape (CAL-6). In `byRange`
 * order, each block takes the lowest level that no block overlapping it has taken: an
 * enclosing block is outer, and two blocks that only partly overlap keep their levels from
 * one day to the next instead of swapping places where one of them begins.
 */
export function nestLevels(blocks: readonly Block[]): Map<string, number> {
  const levels = new Map<string, number>();
  const placed: Block[] = [];
  for (const b of [...blocks].sort(byRange)) {
    const taken = new Set(placed.filter((p) => overlaps(p.start, p.end, b.start, b.end)).map((p) => levels.get(p.id)));
    let level = 0;
    while (taken.has(level)) level++;
    levels.set(b.id, level);
    placed.push(b);
  }
  return levels;
}
