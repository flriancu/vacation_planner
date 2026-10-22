import type { DayInfo } from './calendar';
import { addDays, daysBetween, type ISODate } from './dates';
import type { Block } from './schema';

export interface BlockStats {
  /** Working days this block charges (CAL-7, BLK-6). */
  cost: number;
  /** Working days it doesn't charge because other leave already takes them. */
  covered: number;
  /** Length of the whole break the block is part of, free days around it included. */
  gain: number;
  breakStart: ISODate;
  breakEnd: ISODate;
}

/**
 * Cost and gain of one block, as on its "3 → 9" label (CAL-7).
 *
 * An idea is costed as if it were accepted: it charges the working days no
 * planned or approved block already covers. A planned or approved block
 * charges the working days where it is the top block, as in `yearBalance`.
 * `days` must contain the block (build it from a document that has it).
 */
export function blockStats(days: Map<ISODate, DayInfo>, block: Block): BlockStats {
  let cost = 0;
  let covered = 0;
  for (const date of daysBetween(block.start, block.end)) {
    const day = days.get(date);
    if (!day || day.base !== 'work') continue;
    const charged = block.status === 'idea' ? day.blocks.every((b) => b.status === 'idea') : day.blocks[0]?.id === block.id;
    if (charged) cost++;
    else covered++;
  }

  const off = (d: ISODate) => (d >= block.start && d <= block.end) || (days.get(d)?.off ?? false);
  let breakStart = block.start;
  let breakEnd = block.end;
  while (days.has(addDays(breakStart, -1)) && off(addDays(breakStart, -1))) breakStart = addDays(breakStart, -1);
  while (days.has(addDays(breakEnd, 1)) && off(addDays(breakEnd, 1))) breakEnd = addDays(breakEnd, 1);
  return { cost, covered, gain: daysBetween(breakStart, breakEnd).length, breakStart, breakEnd };
}
