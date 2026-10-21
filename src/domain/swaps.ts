import { buildDays, personBlocks } from './calendar';
import { addDays, isWeekend, weekday, yearEnd, yearStart, type ISODate } from './dates';
import { ALWAYS_SUNDAY, FIRST_YEAR, LAST_YEAR, publicHolidays, type Holiday } from './holidays';
import { live, type Block, type PlanDoc } from './schema';

export interface SwapReminder {
  /** The legal holiday that falls on a Saturday or Sunday. */
  holiday: Holiday;
  /** The Friday before and/or the Monday after, whichever are working days apart from this swap itself. */
  options: ISODate[];
  /** The planned/approved swap block entered for this holiday. */
  resolvedBy?: Block;
  dismissed: boolean;
  /** Still waiting for a choice: not resolved and not dismissed. */
  open: boolean;
}

/** A weekend holiday earns a swap day unless it is one of the always-Sunday holidays (DAY-4). */
export function earnsSwap(holiday: Holiday): boolean {
  return isWeekend(holiday.date) && (holiday.keys.length === 0 || holiday.keys.some((k) => !ALWAYS_SUNDAY.has(k)));
}

/** Swap reminders for every weekend holiday of `year` (DAY-4). */
export function swapReminders(doc: PlanDoc, personId: string, year: number): SwapReminder[] {
  if (year < FIRST_YEAR || year > LAST_YEAR) return [];
  const days = buildDays(doc, personId, addDays(yearStart(year), -2), addDays(yearEnd(year), 2));
  const blocks = personBlocks(doc, personId);
  const dismissed = new Set(
    live(doc.dismissals)
      .filter((d) => d.personId === personId && d.kind === 'swap')
      .map((d) => d.start),
  );

  return publicHolidays(year, live(doc.holidayOverrides))
    .filter(earnsSwap)
    .map((holiday) => {
      const wd = weekday(holiday.date); // 5 = Saturday, 6 = Sunday
      const friday = addDays(holiday.date, 4 - wd);
      const monday = addDays(holiday.date, 7 - wd);
      const resolvedBy = blocks.find((b) => b.swapFor === holiday.date && b.status !== 'idea');
      const options = [friday, monday].filter((date) => {
        const day = days.get(date);
        return day?.base === 'work' && day.blocks.every((b) => b.status === 'idea' || b === resolvedBy);
      });
      const isDismissed = dismissed.has(holiday.date);
      return { holiday, options, ...(resolvedBy && { resolvedBy }), dismissed: isDismissed, open: !resolvedBy && !isDismissed };
    });
}
