import { nextStamp } from './clock';
import { addRecord, live, typeByKey, type PlanDoc, type RecordContext } from './schema';

/**
 * Adds every live block of `from` (the demo plan) to `into` (my plan) as new blocks of my
 * person, matching leave types by their built-in key. Blocks of a type `into` lacks are left
 * out. Returns how many were added.
 */
export function carryBlocks(into: PlanDoc, from: PlanDoc, newId: () => string): { doc: PlanDoc; count: number } {
  const personId = live(into.people)[0]?.id;
  if (!personId) return { doc: into, count: 0 };
  let doc = into;
  let count = 0;
  for (const b of live(from.blocks)) {
    const key = from.leaveTypes[b.typeId]?.key;
    const type = key && typeByKey(doc, key);
    if (!type) continue;
    const ctx: RecordContext = { now: nextStamp(doc), newId };
    const data = { personId, typeId: type.id, start: b.start, end: b.end, status: b.status };
    doc = addRecord(doc, 'blocks', { ...data, ...(b.note && { note: b.note }), ...(b.swapFor && { swapFor: b.swapFor }) }, ctx).doc;
    count++;
  }
  return { doc, count };
}
