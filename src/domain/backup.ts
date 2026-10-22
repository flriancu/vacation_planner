import { findOverlaps, fullOfIdeas } from './calendar';
import { yearOf } from './dates';
import { FIRST_YEAR, LAST_YEAR } from './holidays';
import { migrate, toFile, UnsupportedPlanError } from './migrate';
import { ownPerson } from './people';
import { addRecord, live, put, type Block, type BlockStatus, type LeaveType, type PlanDoc, type RecordContext } from './schema';

/** A copy bigger than this isn't a plan anyone made by hand (a real one is a few hundred kB at most). */
export const MAX_COPY_BYTES = 5_000_000;
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
  if (text.length > MAX_COPY_BYTES) throw new UnsupportedPlanError('The file is too big for a plan.', 'tooBig');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new UnsupportedPlanError('The file is not valid JSON.', 'json');
  }
  const doc = migrate(raw);
  if (Object.keys(doc.blocks).length > MAX_COPY_BLOCKS) throw new UnsupportedPlanError('The copy has too many leaves.', 'tooBig');
  return doc;
}

/** What adding a copy would do, worked out once: the dialog shows it, and adding does exactly it. */
export interface CopyPlan {
  /** Leave to add, already moved to my person and my leave types. */
  blocks: Block[];
  /** Leave types of the copy that I don't have (custom ones), to add first. */
  types: LeaveType[];
  /** Why the rest isn't added. */
  skipped: {
    /** Already in my plan, or deleted from it (a copy never brings back what I deleted). */
    existing: number;
    /** Would break the editor's rules: overlapping planned or approved leave, a fourth idea on a day. */
    conflicts: number;
    /** Not the copy owner's own leave, or outside the years the calendar covers. */
    other: number;
  };
  byStatus: Record<BlockStatus, number>;
  /** The years the added leave touches, in order. */
  years: number[];
  /** The name of the copy's person, when the copy is someone else's plan. */
  from?: string;
}

/**
 * Plans adding a copy to my plan (IO-4). Only leave comes in, and only leave I don't have:
 * the copy owner's own blocks, each moved to me, its built-in leave types matched to mine by
 * key and custom ones by name (or added). Nothing else of the copy is used, so a copy can
 * never remove, change or replace anything of mine: no deletions, holidays, adjustments,
 * follows, settings or people. Each block must pass the editor's rules against my plan and
 * the blocks added before it.
 */
export function planCopy(mine: PlanDoc, copy: PlanDoc, personId: string): CopyPlan {
  const plan: CopyPlan = {
    blocks: [],
    types: [],
    skipped: { existing: 0, conflicts: 0, other: 0 },
    byStatus: { idea: 0, planned: 0, approved: 0 },
    years: [],
  };
  const them = ownPerson(copy);
  if (copy.owner.googleSub !== mine.owner.googleSub && them) plan.from = copy.people[them]?.name;

  const typeIds = new Map<string, string>();
  for (const t of Object.values(copy.leaveTypes)) {
    const match = live(mine.leaveTypes).find((x) => (t.key ? x.key === t.key : x.name.ro === t.name.ro || x.name.en === t.name.en));
    if (match) typeIds.set(t.id, match.id);
  }

  // The rules are checked against my plan as it would be with every block accepted so far.
  let trial: PlanDoc = mine;
  const years = new Set<number>();
  const sorted = live(copy.blocks).sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  for (const b of sorted) {
    if (b.personId !== them || yearOf(b.start) < FIRST_YEAR || yearOf(b.end) > LAST_YEAR) {
      plan.skipped.other++;
      continue;
    }
    if (mine.blocks[b.id]) {
      plan.skipped.existing++;
      continue;
    }
    const sourceType = copy.leaveTypes[b.typeId];
    if (!sourceType) {
      plan.skipped.other++;
      continue;
    }
    let typeId = typeIds.get(b.typeId);
    if (!typeId) {
      // A custom type I don't have: added under the copy's id, unless that id is taken.
      typeId = mine.leaveTypes[sourceType.id] ? `${sourceType.id}-copy` : sourceType.id;
      const { id: _id, createdAt, updatedAt, deleted: _deleted, ...fields } = sourceType;
      const type = { ...fields, id: typeId, createdAt, updatedAt } as LeaveType;
      plan.types.push(type);
      typeIds.set(b.typeId, typeId);
      trial = { ...trial, leaveTypes: withRecord(trial.leaveTypes, typeId, type) };
    }
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
    const next = { ...trial, blocks: withRecord(trial.blocks, block.id, block) };
    const overlap = block.status !== 'idea' && findOverlaps(next, personId).some(([x, y]) => x.id === block.id || y.id === block.id);
    const crowded = block.status === 'idea' && fullOfIdeas(trial, personId, block.start, block.end).length > 0;
    if (overlap || crowded) {
      plan.skipped.conflicts++;
      continue;
    }
    trial = next;
    plan.blocks.push(block);
    plan.byStatus[block.status]++;
    for (let y = yearOf(block.start); y <= yearOf(block.end); y++) years.add(y);
  }
  plan.years = [...years].sort((a, b) => a - b);
  return plan;
}

/** Adds what `planCopy` found to my plan, with fresh stamps so the additions win merges. */
export function addCopy(mine: PlanDoc, plan: CopyPlan, ctx: RecordContext): PlanDoc {
  let doc = mine;
  for (const t of plan.types) {
    if (doc.leaveTypes[t.id]) continue;
    const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = t;
    doc = addRecord(doc, 'leaveTypes', fields, { now: ctx.now, newId: () => t.id }).doc;
  }
  for (const b of plan.blocks) {
    if (doc.blocks[b.id]) continue;
    const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = b;
    doc = addRecord(doc, 'blocks', fields, { now: ctx.now, newId: () => b.id }).doc;
  }
  return doc;
}

/** A copy of `records` with one more, safe for any id (`put`). */
function withRecord<T>(records: Record<string, T>, id: string, record: T): Record<string, T> {
  const out = { ...records };
  put(out, id, record);
  return out;
}
