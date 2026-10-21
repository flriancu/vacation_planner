import { daysBetween, isWeekend, maxDate, minDate, overlaps, type ISODate } from './dates';
import { holidaysBetween, type Holiday } from './holidays';
import { getYearSettings, live, STATUS_RANK, type Block, type Budget, type LeaveTypeKey, type PlanDoc } from './schema';

export type BaseKind = 'work' | 'weekend' | 'holiday';

export interface DayInfo {
  date: ISODate;
  /** What the calendar alone says, before any leave. */
  base: BaseKind;
  holiday?: Holiday;
  /** This person's live blocks covering the day, highest status first, then oldest first. */
  blocks: Block[];
  /** Not a working day: weekend, holiday, or covered by a planned/approved block. */
  off: boolean;
  /** Can start a bridge: a holiday, or a planned/approved floating, swap or office-closed day (DESIGN §6.3). */
  anchor: boolean;
}

const ANCHOR_TYPES: ReadonlySet<LeaveTypeKey> = new Set(['floating', 'swap', 'closed']);

/** Day-by-day view of one person's calendar from `from` to `to` (DESIGN §6.2). */
export function buildDays(doc: PlanDoc, personId: string, from: ISODate, to: ISODate): Map<ISODate, DayInfo> {
  const holidays = holidaysBetween(from, to, live(doc.holidayOverrides));
  const days = new Map<ISODate, DayInfo>();
  for (const date of daysBetween(from, to)) {
    const holiday = holidays.get(date);
    const base: BaseKind = holiday ? 'holiday' : isWeekend(date) ? 'weekend' : 'work';
    days.set(date, { date, base, ...(holiday && { holiday }), blocks: [], off: base !== 'work', anchor: base === 'holiday' });
  }

  const blocks = personBlocks(doc, personId).sort(
    (a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || a.createdAt.localeCompare(b.createdAt),
  );
  for (const block of blocks) {
    if (!overlaps(block.start, block.end, from, to)) continue;
    const anchorType = ANCHOR_TYPES.has(doc.leaveTypes[block.typeId]?.key as LeaveTypeKey);
    for (const date of daysBetween(maxDate(block.start, from), minDate(block.end, to))) {
      const day = days.get(date)!;
      day.blocks.push(block);
      if (block.status !== 'idea') {
        day.off = true;
        if (anchorType) day.anchor = true;
      }
    }
  }
  return days;
}

export function personBlocks(doc: PlanDoc, personId: string): Block[] {
  return live(doc.blocks).filter((b) => b.personId === personId);
}

/** Which balance a block's working days are charged to in `year` (LT-2, LT-3). */
export function blockBudget(doc: PlanDoc, block: Block, year: number): Budget {
  const type = doc.leaveTypes[block.typeId];
  if (!type) return 'none';
  if (type.key === 'closed' && getYearSettings(doc, block.personId, year)?.closedCountsAgainstAnnual) return 'annual';
  return type.budget;
}

/**
 * Pairs of planned/approved blocks of the same person that overlap (BLK-5). Office-closed days
 * are days off anyway, so leave may span them (BLK-6) and they never count as an overlap.
 */
export function findOverlaps(doc: PlanDoc, personId: string): [Block, Block][] {
  const firm = personBlocks(doc, personId)
    .filter((b) => b.status !== 'idea' && doc.leaveTypes[b.typeId]?.key !== 'closed')
    .sort((a, b) => a.start.localeCompare(b.start));
  const out: [Block, Block][] = [];
  for (let i = 0; i < firm.length; i++) {
    for (let j = i + 1; j < firm.length && firm[j]!.start <= firm[i]!.end; j++) out.push([firm[i]!, firm[j]!]);
  }
  return out;
}
