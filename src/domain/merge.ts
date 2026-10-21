import { COLLECTION_KEYS, type Meta, type PlanDoc } from './schema';

/**
 * Record-by-record merge of two versions of the same plan (DESIGN §4.3): for every id in
 * either version, the record with the later `updatedAt` wins. Deleted records are markers
 * with their own `updatedAt`, so a delete wins over an older edit. On a tie the remote
 * version wins. Pure; `local` is usually unsaved edits, `remote` what Drive has now.
 */
export function merge(local: PlanDoc, remote: PlanDoc): PlanDoc {
  const out: PlanDoc = { ...remote };
  for (const key of COLLECTION_KEYS) {
    const theirs = remote[key] as Record<string, Meta>;
    const merged: Record<string, Meta> = { ...theirs };
    for (const [id, mine] of Object.entries(local[key] as Record<string, Meta>)) {
      const other = theirs[id];
      if (!other || mine.updatedAt > other.updatedAt) merged[id] = mine;
    }
    (out as Record<string, unknown>)[key] = merged;
  }
  out.settings = local.settings.updatedAt > remote.settings.updatedAt ? local.settings : remote.settings;
  return out;
}
