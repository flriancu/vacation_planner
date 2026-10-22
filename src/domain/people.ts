import { buildDays, type DayInfo } from './calendar';
import { addDays, daysBetween, type ISODate } from './dates';
import { live, STATUS_RANK, type Block, type BlockStatus, type Follow, type PlanDoc } from './schema';

/** A plan's own person: the one with the account, else the first alive. */
export function ownPerson(doc: PlanDoc): string | undefined {
  return live(doc.people).find((p) => p.hasAccount)?.id ?? live(doc.people)[0]?.id;
}

/** A Drive file id: letters, digits, "-" and "_" (anything else could only come from a hand-made file). */
export const isFileId = (id: string) => /^[\w-]{1,200}$/.test(id);

/**
 * The plans I follow (PPL-3), in their fixed order (PPL-4): the place I gave each, else the
 * order I started following them. Hidden ones included; the caller skips them where it draws.
 * Each file once (two devices, or two quick clicks, may each have followed it), never my own
 * plan (`ownFileId`; a copy of someone's plan may name it), and only real file ids.
 */
export function followed(doc: PlanDoc, ownFileId?: string): Follow[] {
  const seen = new Set<string>();
  return live(doc.following)
    .sort(byPlace)
    .filter((f) => {
      if (!isFileId(f.driveFileId) || f.driveFileId === ownFileId || seen.has(f.driveFileId)) return false;
      seen.add(f.driveFileId);
      return true;
    });
}

/**
 * A followed plan's place in the list: the place I gave it (small numbers), else when I started
 * following it, in seconds (far larger, so after every place I gave). The same number sorts the
 * list and places a move, so a move always lands where it says.
 */
export const placeOf = (f: Follow) => f.order ?? Date.parse(f.createdAt) / 1000;
const byPlace = (a: Follow, b: Follow) => placeOf(a) - placeOf(b) || a.id.localeCompare(b.id);

/**
 * The new `order` for one followed plan moved one place up (-1) or down (+1) among the shown
 * ones, or undefined when it can't move. Only that record changes, so moving someone on one
 * device never rewrites (or brings back) anyone else on another. Hidden ones are stepped over:
 * a move always changes what the calendar shows.
 */
export function movedOrder(list: readonly Follow[], id: string, by: -1 | 1): number | undefined {
  const places = list.map(placeOf);
  const i = list.findIndex((f) => f.id === id);
  if (i < 0) return undefined;
  const shown = list.map((_, k) => k).filter((k) => !list[k]!.hidden || k === i);
  const target = shown[shown.indexOf(i) + by];
  if (target === undefined) return undefined;
  // Just past the neighbour: halfway to the one beyond it, or one further at the end.
  const edge = places[target]!;
  const beyond = places[target + by];
  if (beyond === undefined) return edge + by;
  if (beyond === edge) return edge + by * Math.max(Math.abs(edge) * 1e-12, 1e-9); // two at one place: past both
  const middle = (edge + beyond) / 2;
  return middle === edge || middle === beyond ? undefined : middle;
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
 * The block that stands for someone's day on their line: their leave over an office closure
 * inside it (whatever either's status), so a line keeps its leave's look across a closed day;
 * then the surest (approved over planned over idea).
 */
function lineBlock(doc: PlanDoc, blocks: readonly Block[]): Block | undefined {
  const leave = (b: Block) => (doc.leaveTypes[b.typeId]?.key === 'closed' ? 0 : 1);
  const better = (a: Block, b: Block) => leave(a) - leave(b) || STATUS_RANK[a.status] - STATUS_RANK[b.status];
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
const STRETCH_PAD = 400;

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
      // Sure when any reason for the day off is: approved leave, or what needs no approval (the office's closure).
      const settled = day.blocks.some(
        (b) => b.status === 'approved' || (b.status === 'planned' && doc.leaveTypes[b.typeId]?.needsApproval === false),
      );
      if (!settled) sure = false;
    }
  }
  close();
  return out;
}
