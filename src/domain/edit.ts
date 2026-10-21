import type { Collections, Meta, PlanDoc, Stamp } from './schema';

/**
 * Returns a new document with `patch` applied to one record of `key`. Editing a record that
 * another device deleted meanwhile brings it back: the edit is newer than the delete, and the
 * person saving it clearly still wants it (an edit wins over a concurrent delete).
 */
export function updateRecord<K extends keyof Collections>(
  doc: PlanDoc,
  key: K,
  id: string,
  patch: Partial<Omit<Collections[K], keyof Meta>>,
  now: Stamp,
): PlanDoc {
  const current = doc[key][id];
  if (!current) throw new Error(`No ${key} record ${id}`);
  const { deleted: _deleted, ...rest } = current;
  return { ...doc, [key]: { ...doc[key], [id]: { ...rest, ...patch, id, createdAt: current.createdAt, updatedAt: now } } };
}

/**
 * Marks a record deleted instead of removing it, so a merge still sees the delete (DESIGN §4.3).
 * A deleted block keeps no note: the marker stays in the file for good, private text shouldn't.
 */
export function deleteRecord<K extends keyof Collections>(doc: PlanDoc, key: K, id: string, now: Stamp): PlanDoc {
  const current = doc[key][id];
  if (!current) throw new Error(`No ${key} record ${id}`);
  const { note: _note, ...rest } = current as Collections[K] & { note?: string };
  return { ...doc, [key]: { ...doc[key], [id]: { ...rest, deleted: true, updatedAt: now } } };
}

/**
 * Undoes a delete: clears the marker and bumps updatedAt, so the restore wins a merge against
 * anything older. `previous` is the record as it was before the delete, to bring its note back.
 */
export function restoreRecord<K extends keyof Collections>(
  doc: PlanDoc,
  key: K,
  id: string,
  now: Stamp,
  previous?: Collections[K],
): PlanDoc {
  const current = doc[key][id];
  if (!current) throw new Error(`No ${key} record ${id}`);
  const { deleted: _deleted, ...rest } = { ...previous, ...current };
  return { ...doc, [key]: { ...doc[key], [id]: { ...rest, updatedAt: now } } };
}
