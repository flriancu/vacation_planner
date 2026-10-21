import type { Collections, Meta, PlanDoc, Stamp } from './schema';

/** Returns a new document with `patch` applied to one record of `key`. */
export function updateRecord<K extends keyof Collections>(
  doc: PlanDoc,
  key: K,
  id: string,
  patch: Partial<Omit<Collections[K], keyof Meta>>,
  now: Stamp,
): PlanDoc {
  const current = doc[key][id];
  if (!current) throw new Error(`No ${key} record ${id}`);
  return { ...doc, [key]: { ...doc[key], [id]: { ...current, ...patch, updatedAt: now } } };
}

/** Marks a record deleted instead of removing it, so a merge still sees the delete (DESIGN §4.3). */
export function deleteRecord<K extends keyof Collections>(doc: PlanDoc, key: K, id: string, now: Stamp): PlanDoc {
  const current = doc[key][id];
  if (!current) throw new Error(`No ${key} record ${id}`);
  return { ...doc, [key]: { ...doc[key], [id]: { ...current, deleted: true, updatedAt: now } } };
}

/** Undoes a delete: clears the marker and bumps updatedAt, so the restore wins any merge. */
export function restoreRecord<K extends keyof Collections>(doc: PlanDoc, key: K, id: string, now: Stamp): PlanDoc {
  const current = doc[key][id];
  if (!current) throw new Error(`No ${key} record ${id}`);
  const { deleted: _deleted, ...rest } = current;
  return { ...doc, [key]: { ...doc[key], [id]: { ...rest, updatedAt: now } } };
}
