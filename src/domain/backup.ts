import { absorb } from './absorb';
import { yearOf } from './dates';
import { migrate, toFile, UnsupportedPlanError } from './migrate';
import { live, type BlockStatus, type PlanDoc } from './schema';

/**
 * A copy of the plan as a file (IO-4): the same JSON as the Drive file, so a copy can be read
 * back with the same checks (migrate) and added to any plan, mine or another account's.
 */
export function toBackup(doc: PlanDoc): string {
  return JSON.stringify(toFile(doc), null, 2);
}

/** Reads a copy; anything that isn't one is an UnsupportedPlanError saying why. */
export function readBackup(text: string): PlanDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new UnsupportedPlanError('The file is not valid JSON.');
  }
  return migrate(raw);
}

export interface BackupSummary {
  /** Live blocks in the copy. */
  blocks: number;
  byStatus: Record<BlockStatus, number>;
  /** The years its blocks touch, in order. */
  years: number[];
}

export function summarize(doc: PlanDoc): BackupSummary {
  const blocks = live(doc.blocks);
  const byStatus: Record<BlockStatus, number> = { idea: 0, planned: 0, approved: 0 };
  const years = new Set<number>();
  for (const b of blocks) {
    byStatus[b.status]++;
    for (let y = yearOf(b.start); y <= yearOf(b.end); y++) years.add(y);
  }
  return { blocks: blocks.length, byStatus, years: [...years].sort((a, b) => a - b) };
}

/**
 * Adds a copy to my plan: its records join mine (its person becomes me, its built-in leave
 * types mine), and a record in both keeps its newer version. Nothing of mine is removed.
 */
export function addFromBackup(mine: PlanDoc, copy: PlanDoc): PlanDoc {
  return absorb(mine, copy);
}
