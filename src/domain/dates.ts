/**
 * Whole-day dates as `YYYY-MM-DD` strings. All arithmetic runs in UTC, so a
 * time zone can never shift a day. ISO strings also sort and compare correctly
 * with `<` and `>`.
 */
export type ISODate = string;

const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toUTC(date: ISODate): number {
  const m = ISO_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (fromUTC(t) !== date) throw new Error(`Invalid date: ${date}`);
  return t;
}

/** A real calendar date written as `YYYY-MM-DD` (not `2027-02-30`, not `2027-1-1`). */
export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return fromUTC(Date.UTC(y, m - 1, d)) === value;
}

export function fromUTC(time: number): ISODate {
  return new Date(time).toISOString().slice(0, 10);
}

/** `month` is 1-based. Out-of-range days roll over, like `Date.UTC`. */
export function makeDate(year: number, month: number, day: number): ISODate {
  return fromUTC(Date.UTC(year, month - 1, day));
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromUTC(toUTC(date) + days * DAY_MS);
}

/** Number of days from `a` to `b` (negative when `b` is earlier). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(date: ISODate): number {
  return (new Date(toUTC(date)).getUTCDay() + 6) % 7;
}

export function isWeekend(date: ISODate): boolean {
  return weekday(date) >= 5;
}

export function yearOf(date: ISODate): number {
  return Number(date.slice(0, 4));
}

export function yearStart(year: number): ISODate {
  return makeDate(year, 1, 1);
}

export function yearEnd(year: number): ISODate {
  return makeDate(year, 12, 31);
}

/** Every date from `from` to `to`, both included. */
export function daysBetween(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let t = toUTC(from), end = toUTC(to); t <= end; t += DAY_MS) out.push(fromUTC(t));
  return out;
}

export function overlaps(aStart: ISODate, aEnd: ISODate, bStart: ISODate, bEnd: ISODate): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}
