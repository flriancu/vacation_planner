import { buildDays } from './calendar';
import { daysBetween, type ISODate } from './dates';
import { live, STATUS_RANK, type Block, type BlockStatus, type Follow, type PlanDoc } from './schema';

/** A plan's own person: the one with the account, else the first alive. */
export function ownPerson(doc: PlanDoc): string | undefined {
  return live(doc.people).find((p) => p.hasAccount)?.id ?? live(doc.people)[0]?.id;
}

/**
 * The plans I follow (PPL-3), in their fixed order (PPL-4): the order I set, else the order I
 * started following them. Hidden ones included; the caller skips them where it draws.
 */
export function followed(doc: PlanDoc): Follow[] {
  return live(doc.following).sort(
    (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.createdAt.localeCompare(b.createdAt),
  );
}

/** One day of someone's leave, for drawing their line: which block, and whether it begins or ends that day. */
export interface LeaveDay {
  block: Block;
  status: BlockStatus;
  start: boolean;
  end: boolean;
}

/** A person's leave on each day of `from`–`to` (the block that owns the day, BLK-6), for their line in the overlay. */
export function leaveDays(doc: PlanDoc, personId: string, from: ISODate, to: ISODate): Map<ISODate, LeaveDay> {
  const out = new Map<ISODate, LeaveDay>();
  for (const day of buildDays(doc, personId, from, to).values()) {
    const block = day.blocks[0];
    if (!block) continue;
    out.set(day.date, { block, status: block.status, start: block.start === day.date, end: block.end === day.date });
  }
  return out;
}

/**
 * Days when everyone in `plans` is off together (PPL-4): each of them has the day off anyway or
 * planned or approved leave on it (ideas don't count). Only stretches where at least one of them
 * takes leave count, so an ordinary weekend is not marked. Each day of a stretch says how sure
 * it is: approved when every leave in the stretch is approved, else planned.
 */
export function offTogether(
  plans: readonly { doc: PlanDoc; personId: string }[],
  from: ISODate,
  to: ISODate,
): Map<ISODate, Exclude<BlockStatus, 'idea'>> {
  const out = new Map<ISODate, Exclude<BlockStatus, 'idea'>>();
  if (plans.length < 2) return out;
  const days = plans.map((p) => buildDays(p.doc, p.personId, from, to));
  let run: ISODate[] = [];
  let leave = false;
  let sure = true;
  const close = () => {
    if (leave) for (const d of run) out.set(d, sure ? 'approved' : 'planned');
    run = [];
    leave = false;
    sure = true;
  };
  for (const date of daysBetween(from, to)) {
    const each = days.map((m) => m.get(date)!);
    if (!each.every((d) => d.off)) {
      close();
      continue;
    }
    run.push(date);
    for (const d of each) {
      if (d.base !== 'work') continue;
      leave = true;
      const firm = d.blocks.filter((b) => b.status !== 'idea').sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status])[0];
      if (firm?.status !== 'approved') sure = false;
    }
  }
  close();
  return out;
}
