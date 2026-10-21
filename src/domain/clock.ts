import { COLLECTION_KEYS, type Meta, type PlanDoc, type Stamp } from './schema';

/**
 * The `updatedAt` for an edit to `doc`: now, but never earlier than anything already in the
 * document. Merges pick the later stamp (merge.ts), and device clocks disagree: without the
 * floor, a phone whose clock runs fast would beat an edit made later, in real time, by a
 * device that had already seen the phone's change. Stamps stay ISO strings, so no schema change.
 */
export function nextStamp(doc: PlanDoc, now: number = Date.now()): Stamp {
  let latest = Date.parse(doc.settings.updatedAt) || 0;
  for (const key of COLLECTION_KEYS) {
    for (const r of Object.values(doc[key] as Record<string, Meta>)) {
      const t = Date.parse(r.updatedAt);
      if (t > latest) latest = t;
    }
  }
  return new Date(Math.max(now, latest + 1)).toISOString();
}
