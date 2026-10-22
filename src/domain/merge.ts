import { COLLECTION_KEYS, put, type Collections, type Meta, type PlanDoc } from './schema';

/**
 * Record-by-record merge of two versions of the same plan (DESIGN §4.3): for every id in
 * either version, the record with the later `updatedAt` wins. Deleted records are markers
 * with their own `updatedAt`, so a delete wins over an older edit. On a tie the remote
 * version wins. Pure; `local` is usually unsaved edits, `remote` what Drive has now.
 */
export function merge(local: PlanDoc, remote: PlanDoc): PlanDoc {
  const out: PlanDoc = { ...remote };
  for (const key of COLLECTION_KEYS) {
    const merged: Record<string, Meta> = { ...(remote[key] as Record<string, Meta>) };
    for (const [id, mine] of Object.entries(local[key] as Record<string, Meta>)) if (wins(mine, id, remote, key)) put(merged, id, mine);
    (out as Record<string, unknown>)[key] = merged;
  }
  out.settings = local.settings.updatedAt > remote.settings.updatedAt ? local.settings : remote.settings;
  return out;
}

/** True when `merge(local, remote)` keeps something of `local` that `remote` lacks: it needs saving. */
export function hasLocalWins(local: PlanDoc, remote: PlanDoc): boolean {
  if (local.settings.updatedAt > remote.settings.updatedAt) return true;
  return COLLECTION_KEYS.some((key) =>
    Object.entries(local[key] as Record<string, Meta>).some(([id, mine]) => wins(mine, id, remote, key)),
  );
}

/**
 * Whether my version of record `id` beats the remote's: it is newer, or the remote lacks it.
 * Records the remote has but this build can't read (migrate.ts `skipped`) still count as there,
 * so an older readable copy never replaces what a newer build wrote. Own properties only: an
 * id like `constructor` is not Object.prototype's.
 */
function wins(mine: Meta, id: string, remote: PlanDoc, key: keyof Collections): boolean {
  const theirs = remote[key] as Record<string, Meta>;
  const other = Object.hasOwn(theirs, id) ? theirs[id] : undefined;
  if (other) return mine.updatedAt > other.updatedAt;
  const unread = remote.skipped?.[key] as Record<string, { updatedAt?: unknown }> | undefined;
  return !(unread && Object.hasOwn(unread, id) && String(unread[id]?.updatedAt ?? '') >= mine.updatedAt);
}
