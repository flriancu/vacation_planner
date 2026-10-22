import { MAX_IDEAS_PER_DAY } from './calendar';
import { daysBetween, overlaps, yearOf } from './dates';
import { FIRST_YEAR, LAST_YEAR } from './holidays';
import { migrate, toFile, UnsupportedPlanError } from './migrate';
import { ownPerson } from './people';
import { live, put, STATUS_RANK, type Block, type BlockStatus, type LeaveType, type PlanDoc, type Stamp } from './schema';
import { swapHolidaysFor } from './swaps';

/** A copy bigger than this isn't a plan anyone made by hand (a real one is a few hundred kB at most). */
export const MAX_COPY_BYTES = 5_000_000;
/** The demo's owner (ui/App.tsx): a copy of the demo is mine, not someone else's. */
export const DEMO_OWNER = 'demo';
/** Leave in one copy: years of a whole team's leave would still be far below this. */
export const MAX_COPY_BLOCKS = 5000;

/**
 * A copy of the plan as a file (IO-4): the same JSON as the Drive file, so a copy can be read
 * back with the same checks (migrate). Without the plans I follow (other people's file ids
 * and names, which a copy passed on shouldn't carry) and without records this version set
 * aside unread.
 */
export function toBackup(doc: PlanDoc): string {
  const { following: _following, skipped: _skipped, ...rest } = toFile(doc) as PlanDoc;
  return JSON.stringify({ ...rest, following: {} }, null, 2);
}

/** Reads a copy; anything that isn't one is an UnsupportedPlanError saying why (`reason`). */
export function readBackup(text: string): PlanDoc {
  // Characters first (cheap), then bytes: a text of 3-byte characters is three times longer on disk.
  if (text.length > MAX_COPY_BYTES || (text.length > MAX_COPY_BYTES / 3 && new TextEncoder().encode(text).length > MAX_COPY_BYTES)) {
    throw new UnsupportedPlanError('The file is too big for a plan.', 'tooBig');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new UnsupportedPlanError('The file is not valid JSON.', 'json');
  }
  const doc = migrate(raw);
  // Leave, not deletions: a copy the app saved must read back, however much was deleted.
  if (live(doc.blocks).length > MAX_COPY_BLOCKS) throw new UnsupportedPlanError('The copy has too many leaves.', 'tooBig');
  return doc;
}

/** What adding a copy would do, worked out once: the dialog shows it, and adding does exactly it. */
export interface CopyPlan {
  /** Leave to add, already moved to my person and my leave types. */
  blocks: Block[];
  /** Leave types of the copy that I don't have, to add first (their names are listed). */
  types: LeaveType[];
  /** Why the rest isn't added. */
  skipped: {
    /** Already in my plan, or deleted from it (a copy never brings back what I deleted). */
    existing: number;
    /** Would break the editor's rules: overlapping planned or approved leave, a fourth idea on a day, a swap day off its weekend. */
    conflicts: number;
    /** Not the copy owner's own leave, or outside the years the calendar covers. */
    other: number;
    /** Couldn't be read at all (impossible dates, a missing type…). */
    unreadable: number;
  };
  byStatus: Record<BlockStatus, number>;
  /** The years the added leave touches, in order. */
  years: number[];
  /** The name of the copy's person, when the copy is someone else's plan (not the demo's). */
  from?: string;
  /** Floating days of an old copy, which come in as annual leave. */
  converted: number;
}

const has = (records: object | undefined, id: string) => !!records && Object.hasOwn(records, id);

/** A custom type is the same as one of mine only if everything that counts matches: names, budget, approval. */
const sameType = (a: LeaveType, b: LeaveType) =>
  !a.key && !b.key && a.name.ro === b.name.ro && a.name.en === b.name.en && a.budget === b.budget && a.needsApproval === b.needsApproval;

/**
 * Plans adding a copy to my plan (IO-4). Only leave comes in, and only leave I don't have:
 * the copy owner's own blocks, each moved to me, its built-in leave types matched to mine by
 * key, its custom ones to an identical custom type of mine, or added as new types. Nothing
 * else of the copy is used, so a copy can never remove, change or replace anything of mine:
 * no deletions, holidays, adjustments, follows, settings or people, nor records my plan keeps
 * unread for a newer version. Each block must pass the editor's rules against my plan and the
 * blocks added before it, the surest first (approved, then planned, then ideas).
 */
export function planCopy(mine: PlanDoc, copy: PlanDoc, personId: string): CopyPlan {
  const plan: CopyPlan = {
    blocks: [],
    types: [],
    skipped: { existing: 0, conflicts: 0, other: 0, unreadable: Object.keys(copy.skipped?.blocks ?? {}).length },
    byStatus: { idea: 0, planned: 0, approved: 0 },
    years: [],
    converted: copy.converted ?? 0,
  };
  const them = ownPerson(copy);
  if (copy.owner.googleSub !== mine.owner.googleSub && copy.owner.googleSub !== DEMO_OWNER && them) plan.from = copy.people[them]?.name;

  // An id is taken when my plan has it, alive, deleted or kept unread, or the copy uses it for something else.
  const takenType = (id: string) => has(mine.leaveTypes, id) || has(mine.skipped?.leaveTypes, id) || plan.types.some((t) => t.id === id);
  const typeIds = new Map<string, string>();
  const typeFor = (sourceId: string): string | undefined => {
    const known = typeIds.get(sourceId);
    if (known) return known;
    const source = copy.leaveTypes[sourceId];
    if (!source) return undefined;
    const match = live(mine.leaveTypes).find((x) => (source.key ? x.key === source.key : sameType(x, source)));
    let id = match?.id;
    if (!id) {
      if (source.key && live(mine.leaveTypes).every((x) => x.key !== source.key)) return undefined; // a built-in this version doesn't have
      id = source.id;
      for (let n = 2; takenType(id) || (id !== source.id && has(copy.leaveTypes, id)); n++) id = `${source.id}-${n}`;
      const { id: _id, ...fields } = source; // a deleted type stays deleted: its leave keeps it, my list doesn't show it
      plan.types.push({ ...fields, id } as LeaveType);
    }
    typeIds.set(sourceId, id);
    return id;
  };

  // The editor's rules (BLK-5), checked against my leave and the leave accepted so far. Kept as
  // running lists, not a copy of the plan per block: a copy of thousands stays quick.
  const leaveTypes = { ...mine.leaveTypes };
  const closed = (x: Block) => leaveTypes[x.typeId]?.key === 'closed';
  const minePerson = live(mine.blocks).filter((x) => x.personId === personId);
  const firm = minePerson.filter((x) => x.status !== 'idea' && !closed(x));
  const ideas = minePerson.filter((x) => x.status === 'idea');
  // One swap day per holiday: the holidays my planned or approved swap days already make up for.
  const swapped = new Set(minePerson.filter((x) => x.status !== 'idea' && x.swapFor).map((x) => x.swapFor!));
  const crowded = (x: Block) => {
    const near = ideas.filter((i) => overlaps(i.start, i.end, x.start, x.end));
    return (
      near.length >= MAX_IDEAS_PER_DAY &&
      daysBetween(x.start, x.end).some((d) => near.filter((i) => i.start <= d && d <= i.end).length >= MAX_IDEAS_PER_DAY)
    );
  };

  const years = new Set<number>();
  const surest = live(copy.blocks).sort(
    (x, y) => STATUS_RANK[y.status] - STATUS_RANK[x.status] || x.start.localeCompare(y.start) || x.id.localeCompare(y.id),
  );
  for (const b of surest) {
    if (b.personId !== them || yearOf(b.start) < FIRST_YEAR || yearOf(b.end) > LAST_YEAR) {
      plan.skipped.other++;
      continue;
    }
    if (has(mine.blocks, b.id) || has(mine.skipped?.blocks, b.id)) {
      plan.skipped.existing++;
      continue;
    }
    const typeId = typeFor(b.typeId);
    if (!typeId) {
      plan.skipped.other++;
      continue;
    }
    for (const t of plan.types) if (!has(leaveTypes, t.id)) put(leaveTypes, t.id, t);
    // Known fields only: whatever else a copy carries stays behind.
    const block: Block = {
      id: b.id,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      personId,
      typeId,
      start: b.start,
      end: b.end,
      status: b.status,
      ...(b.note && { note: b.note }),
      ...(b.swapFor && { swapFor: b.swapFor }),
    };
    const overlap = block.status !== 'idea' && !closed(block) && firm.some((f) => overlaps(f.start, f.end, block.start, block.end));
    // A swap day: one working day next to a weekend with a holiday, for a holiday no other swap day takes.
    let swapOk = true;
    if (leaveTypes[typeId]?.key === 'swap') {
      const holidays = block.start === block.end ? swapHolidaysFor(mine, block.start).map((h) => h.date) : [];
      const forDay = block.swapFor ?? holidays.find((h) => block.status === 'idea' || !swapped.has(h));
      swapOk = !!forDay && holidays.includes(forDay) && (block.status === 'idea' || !swapped.has(forDay));
      if (swapOk && forDay) block.swapFor = forDay;
    }
    if (overlap || (block.status === 'idea' && crowded(block)) || !swapOk) {
      plan.skipped.conflicts++;
      continue;
    }
    if (block.status === 'idea') ideas.push(block);
    else if (!closed(block)) firm.push(block);
    if (block.status !== 'idea' && block.swapFor) swapped.add(block.swapFor);
    plan.blocks.push(block);
    plan.byStatus[block.status]++;
    for (let y = yearOf(block.start); y <= yearOf(block.end); y++) years.add(y);
  }
  // Only the types the added leave uses.
  plan.types = plan.types.filter((t) => plan.blocks.some((b) => b.typeId === t.id));
  plan.blocks.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  plan.years = [...years].sort((a, b) => a - b);
  return plan;
}

/**
 * Adds what `planCopy` found to my plan. The records keep the copy's own times (never later
 * than now): a copy is old news, so a newer edit or delete of the same leave, made on another
 * device or already in Drive, still wins when the versions meet.
 */
export function addCopy(mine: PlanDoc, plan: CopyPlan, now: Stamp): PlanDoc {
  const at = (s: Stamp) => (s > now ? now : s);
  const leaveTypes = { ...mine.leaveTypes };
  for (const t of plan.types)
    if (!has(leaveTypes, t.id)) put(leaveTypes, t.id, { ...t, createdAt: at(t.createdAt), updatedAt: at(t.updatedAt) });
  const blocks = { ...mine.blocks };
  for (const b of plan.blocks) if (!has(blocks, b.id)) put(blocks, b.id, { ...b, createdAt: at(b.createdAt), updatedAt: at(b.updatedAt) });
  return { ...mine, leaveTypes, blocks };
}
