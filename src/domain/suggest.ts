import { yearBalance } from './balance';
import { buildDays, type DayInfo } from './calendar';
import { addDays, daysBetween, overlaps, yearEnd, yearOf, yearStart, type ISODate } from './dates';
import type { Holiday } from './holidays';
import { live, type ExpiringBudget, type PlanDoc } from './schema';
import { swapReminders, type SwapReminder } from './swaps';

export interface Candidate {
  /** The whole break, from the first to the last day off (inclusive). */
  start: ISODate;
  end: ISODate;
  /** Days off gained: the length of the break. */
  gain: number;
  /** Leave days needed: the working days inside the break. */
  cost: number;
  ratio: number;
  leaveDays: ISODate[];
  /** How `cost` is paid: expiring days (excused leave) first, then annual leave (SUG-7). */
  split: { excused: number; annual: number };
  holidays: Holiday[];
  /** Set when the candidate relies on an open swap reminder being resolved this way (SUG-8). */
  assumesSwap?: { holiday: ISODate; date: ISODate };
}

export interface SuggestOptions {
  /** Most leave days in one candidate (SUG-1). */
  maxCost?: number;
}

const DEFAULT_MAX_COST = 5;
/** Days of context around the year, so breaks that cross 1 Jan or 31 Dec are seen whole. */
const PAD = 90;

type RawCandidate = Omit<Candidate, 'split'>;

/**
 * Ranked bridge candidates for `year` (SUG-1, SUG-2, SUG-7, SUG-8; DESIGN §6.3).
 * A candidate qualifies if it overlaps the year at all.
 */
export function suggest(doc: PlanDoc, personId: string, year: number, opts: SuggestOptions = {}): Candidate[] {
  const maxCost = opts.maxCost ?? DEFAULT_MAX_COST;
  const from = yearStart(year);
  const to = yearEnd(year);
  const days = buildDays(doc, personId, addDays(from, -PAD), addDays(to, PAD));
  const dismissed = new Set(
    live(doc.dismissals)
      .filter((d) => d.personId === personId && d.kind === 'suggestion')
      .map((d) => `${d.start}|${d.end}`),
  );

  const found = new Map<string, RawCandidate>();
  const add = (c: RawCandidate) => {
    const key = `${c.start}|${c.end}|${c.assumesSwap?.date ?? ''}`;
    if (!found.has(key) && !dismissed.has(`${c.start}|${c.end}`) && overlaps(c.start, c.end, from, to)) found.set(key, c);
  };

  for (const c of rawCandidates(days, maxCost)) add(c);
  for (const reminder of swapReminders(doc, personId, year)) {
    if (!reminder.open) continue;
    for (const date of reminder.options) {
      for (const c of rawCandidates(days, maxCost, date)) {
        if (c.start <= date && date <= c.end) add({ ...c, assumesSwap: { holiday: reminder.holiday.date, date } });
      }
    }
  }

  const balances = new Map<number, ReturnType<typeof yearBalance>>();
  const available = (y: number, budget: ExpiringBudget) => {
    if (!balances.has(y)) balances.set(y, yearBalance(doc, personId, y, yearStart(y)));
    return Math.max(0, balances.get(y)![budget].available);
  };

  return [...found.values()].map((c) => ({ ...c, split: split(c.leaveDays, available) })).sort(byRank);
}

export interface SwapOptionScore {
  date: ISODate;
  /** Length of the break this option creates with no extra leave. */
  runLength: number;
  /** The best candidate that contains this option, if any. */
  best?: Candidate;
}

/** For a swap reminder, how good each of its options is as a bridge (DAY-5). */
export function swapOptionScores(doc: PlanDoc, personId: string, reminder: SwapReminder, opts: SuggestOptions = {}): SwapOptionScore[] {
  const maxCost = opts.maxCost ?? DEFAULT_MAX_COST;
  const year = yearOf(reminder.holiday.date);
  const days = buildDays(doc, personId, addDays(yearStart(year), -PAD), addDays(yearEnd(year), PAD));
  return reminder.options.map((date) => {
    const off = isOff(days, date);
    let start = date;
    let end = date;
    while (days.has(addDays(start, -1)) && off(addDays(start, -1))) start = addDays(start, -1);
    while (days.has(addDays(end, 1)) && off(addDays(end, 1))) end = addDays(end, 1);
    const best = rawCandidates(days, maxCost, date)
      .filter((c) => c.start <= date && date <= c.end)
      .map((c) => ({ ...c, split: { excused: 0, annual: c.cost } }))
      .sort(byRank)[0];
    return { date, runLength: daysBetween(start, end).length, ...(best && { best }) };
  });
}

function isOff(days: Map<ISODate, DayInfo>, swap?: ISODate) {
  return (d: ISODate) => d === swap || (days.get(d)?.off ?? false);
}

/**
 * Every candidate in `days`, optionally pretending `swap` is already a day off.
 * Anchors are maximal runs of days off that contain an anchor day; each is
 * widened by `l` working days to the left and `r` to the right, absorbing the
 * days off it reaches, so the result always has working days on both sides.
 */
function rawCandidates(days: Map<ISODate, DayInfo>, maxCost: number, swap?: ISODate): RawCandidate[] {
  const off = isOff(days, swap);
  const anchor = (d: ISODate) => d === swap || (days.get(d)?.anchor ?? false);

  const runs: [ISODate, ISODate][] = [];
  let runStart: ISODate | undefined;
  let prev: ISODate | undefined;
  let hasAnchor = false;
  for (const date of days.keys()) {
    if (off(date)) {
      if (!runStart) {
        runStart = date;
        hasAnchor = false;
      }
      hasAnchor ||= anchor(date);
    } else if (runStart) {
      if (hasAnchor) runs.push([runStart, prev!]);
      runStart = undefined;
    }
    prev = date;
  }

  const extend = (edge: ISODate, dir: 1 | -1) => {
    const steps = [{ edge, leave: [] as ISODate[] }];
    let cur = edge;
    let leave: ISODate[] = [];
    for (let i = 0; i < maxCost; i++) {
      const next = addDays(cur, dir);
      if (!days.has(next)) break;
      leave = [...leave, next];
      cur = next;
      while (days.has(addDays(cur, dir)) && off(addDays(cur, dir))) cur = addDays(cur, dir);
      steps.push({ edge: cur, leave });
    }
    return steps;
  };

  const out: RawCandidate[] = [];
  for (const [runFrom, runTo] of runs) {
    const left = extend(runFrom, -1);
    const right = extend(runTo, 1);
    for (let l = 0; l < left.length; l++) {
      for (let r = 0; r < right.length && l + r <= maxCost; r++) {
        if (l + r === 0) continue;
        const start = left[l]!.edge;
        const end = right[r]!.edge;
        const range = daysBetween(start, end);
        const leaveDays = [...left[l]!.leave, ...right[r]!.leave].sort();
        out.push({
          start,
          end,
          gain: range.length,
          cost: leaveDays.length,
          ratio: range.length / leaveDays.length,
          leaveDays,
          holidays: range.flatMap((d) => days.get(d)?.holiday ?? []),
        });
      }
    }
  }
  return out;
}

function split(leaveDays: ISODate[], available: (year: number, budget: ExpiringBudget) => number): Candidate['split'] {
  const perYear = new Map<number, number>();
  for (const d of leaveDays) perYear.set(yearOf(d), (perYear.get(yearOf(d)) ?? 0) + 1);
  let excused = 0;
  for (const [y, n] of perYear) excused += Math.min(n, available(y, 'excused'));
  return { excused, annual: leaveDays.length - excused };
}

function byRank(a: Candidate, b: Candidate): number {
  return b.ratio - a.ratio || b.gain - a.gain || a.start.localeCompare(b.start);
}
