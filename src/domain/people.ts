import { buildDays, type DayInfo } from './calendar';
import { addDays, daysBetween, type ISODate } from './dates';
import { live, STATUS_RANK, type Block, type BlockStatus, type Follow, type PlanDoc } from './schema';

/** A plan's own person: the one with the account, else the first alive. */
export function ownPerson(doc: PlanDoc): string | undefined {
  return live(doc.people).find((p) => p.hasAccount)?.id ?? live(doc.people)[0]?.id;
}

/** A Drive file id: letters, digits, "-" and "_" (anything else could only come from a hand-made file). */
const FILE_ID = /^[\w-]{1,200}$/;

/**
 * The plans I follow (PPL-3), in their fixed order (PPL-4): the order I set, else the order I
 * started following them. Hidden ones included; the caller skips them where it draws.
 * Each file once (two devices, or two quick clicks, may each have followed it), never my own
 * plan (`ownFileId`; a copy of someone's plan may name it), and only real file ids.
 */
export function followed(doc: PlanDoc, ownFileId?: string): Follow[] {
  const seen = new Set<string>();
  return live(doc.following)
    .sort(byPlace)
    .filter((f) => {
      if (!FILE_ID.test(f.driveFileId) || f.driveFileId === ownFileId || seen.has(f.driveFileId)) return false;
      seen.add(f.driveFileId);
      return true;
    });
}

const byPlace = (a: Follow, b: Follow) =>
  (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
  a.createdAt.localeCompare(b.createdAt) ||
  a.id.localeCompare(b.id);

/**
 * The new `order` for one followed plan moved one place up (-1) or down (+1) among the shown
 * ones, or undefined when it can't move. Only that record changes, so moving someone on one
 * device never rewrites (or brings back) anyone else on another. Hidden ones are stepped over:
 * a move always changes what the calendar shows.
 */
export function movedOrder(list: readonly Follow[], id: string, by: -1 | 1): number | undefined {
  // Places as numbers: the stored order, else one after the one before, so unset ones keep their place.
  const places: number[] = [];
  list.forEach((f, i) => places.push(f.order ?? (i ? places[i - 1]! + 1 : 1)));
  const i = list.findIndex((f) => f.id === id);
  if (i < 0) return undefined;
  const shown = list.map((f, k) => k).filter((k) => !list[k]!.hidden || k === i);
  const at = shown.indexOf(i);
  const target = shown[at + by];
  if (target === undefined) return undefined;
  // Just past the neighbour, halfway to the one beyond it.
  const beyond = by < 0 ? (target > 0 ? places[target - 1] : undefined) : target < list.length - 1 ? places[target + 1] : undefined;
  const edge = places[target]!;
  if (beyond === undefined) return edge + by;
  return beyond === edge ? edge + by / 2 : (edge + beyond) / 2;
}

/** One day of someone's leave, for drawing their line: which block, and whether it begins or ends that day. */
export interface LeaveDay {
  block: Block;
  status: BlockStatus;
  start: boolean;
  end: boolean;
}

// Plans never change in place (every edit makes a new one), so a plan's days can be kept per
// plan object: my edits then never recompute the plans I follow.
const dayCache = new WeakMap<PlanDoc, Map<string, Map<ISODate, DayInfo>>>();
function days(doc: PlanDoc, personId: string, from: ISODate, to: ISODate) {
  let byRange = dayCache.get(doc);
  if (!byRange) dayCache.set(doc, (byRange = new Map()));
  const key = `${personId}|${from}|${to}`;
  let result = byRange.get(key);
  if (!result) byRange.set(key, (result = buildDays(doc, personId, from, to)));
  return result;
}

/**
 * The block that stands for someone's day on their line: the surest one (approved over planned
 * over idea), and leave over an office closure inside it, so a line keeps one look across a
 * closed day in the middle of approved leave.
 */
function lineBlock(doc: PlanDoc, blocks: readonly Block[]): Block | undefined {
  const closed = (b: Block) => (doc.leaveTypes[b.typeId]?.key === 'closed' ? 0 : 1);
  const better = (a: Block, b: Block) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || closed(a) - closed(b);
  let best: Block | undefined;
  for (const b of blocks) if (!best || better(b, best) > 0) best = b;
  return best;
}

/** A person's leave on each day of `from`–`to`, for their line in the overlay. */
export function leaveDays(doc: PlanDoc, personId: string, from: ISODate, to: ISODate): Map<ISODate, LeaveDay> {
  const out = new Map<ISODate, LeaveDay>();
  for (const day of days(doc, personId, from, to).values()) {
    const block = lineBlock(doc, day.blocks);
    if (!block) continue;
    out.set(day.date, { block, status: block.status, start: block.start === day.date, end: block.end === day.date });
  }
  return out;
}

/** How far around the view stretches are followed, so a day says the same in every view that shows it. */
const STRETCH_PAD = 62;

/**
 * Days when everyone in `plans` is off together (PPL-4): each of them has the day off anyway or
 * planned or approved leave on it (ideas don't count). Only stretches where at least one of them
 * takes leave count, so an ordinary weekend is not marked. Each day of a stretch says how sure
 * it is: approved when every leave in the stretch is sure (approved, or of a type that needs
 * no approval, such as the office's closure), else planned.
 */
export function offTogether(
  plans: readonly { doc: PlanDoc; personId: string }[],
  from: ISODate,
  to: ISODate,
): Map<ISODate, Exclude<BlockStatus, 'idea'>> {
  const out = new Map<ISODate, Exclude<BlockStatus, 'idea'>>();
  if (plans.length < 2) return out;
  const wideFrom = addDays(from, -STRETCH_PAD);
  const wideTo = addDays(to, STRETCH_PAD);
  const all = plans.map((p) => ({ doc: p.doc, days: days(p.doc, p.personId, wideFrom, wideTo) }));
  let run: ISODate[] = [];
  let leave = false;
  let sure = true;
  const close = () => {
    if (leave) for (const d of run) if (d >= from && d <= to) out.set(d, sure ? 'approved' : 'planned');
    run = [];
    leave = false;
    sure = true;
  };
  for (const date of daysBetween(wideFrom, wideTo)) {
    const each = all.map((p) => ({ doc: p.doc, day: p.days.get(date)! }));
    if (!each.every((p) => p.day.off)) {
      close();
      continue;
    }
    run.push(date);
    for (const { doc, day } of each) {
      if (day.base !== 'work') continue;
      leave = true;
      const firm = lineBlock(
        doc,
        day.blocks.filter((b) => b.status !== 'idea'),
      );
      const settled = firm && (firm.status === 'approved' || doc.leaveTypes[firm.typeId]?.needsApproval === false);
      if (!settled) sure = false;
    }
  }
  close();
  return out;
}
