import { merge } from './merge';
import { COLLECTION_KEYS, live, put, type Collections, type Meta, type PlanDoc } from './schema';

/** A plan's own person: the one with the account (alive or not), else the first alive. */
const own = (d: PlanDoc) => Object.values(d.people).find((p) => p.hasAccount)?.id ?? live(d.people)[0]?.id;

/** Collections whose records point at a person and, for blocks, a leave type. */
const PERSONAL: readonly (keyof Collections)[] = ['blocks', 'yearSettings', 'adjustments', 'dismissals'];

/**
 * Adds another version of my plan to mine, even one made with other ids: a second plan file
 * (two devices creating one at once), this device's copy of a file since replaced, or the demo
 * at sign-in. Its own person becomes mine and its built-in leave types become mine (by key);
 * anything else keeps its id. Then the two are merged by time, as any two versions are.
 * For two versions of the same file nothing is remapped, so this is exactly `merge`.
 */
export function absorb(into: PlanDoc, from: PlanDoc): PlanDoc {
  const me = live(into.people).find((p) => p.hasAccount)?.id ?? live(into.people)[0]?.id;
  const them = own(from);
  const person = (id: string) => (id === them && me ? me : id);
  const typeIds = new Map<string, string>();
  for (const t of Object.values(from.leaveTypes)) {
    const mine = t.key && live(into.leaveTypes).find((x) => x.key === t.key);
    if (mine && mine.id !== t.id) typeIds.set(t.id, mine.id);
  }
  // Settings come along only from a plan of the same account, never from the demo.
  const settings = from.owner.googleSub === into.owner.googleSub ? from.settings : into.settings;
  if ((!them || them === me) && typeIds.size === 0) return merge({ ...from, settings }, into);

  const mapped = { ...from, settings } as PlanDoc;
  for (const key of COLLECTION_KEYS) {
    const out: Record<string, Meta> = {};
    for (const [id, r] of Object.entries(from[key] as Record<string, Meta & { personId?: string; typeId?: string }>)) {
      if (key === 'people' && id === them && me) continue; // that person is me
      if (key === 'leaveTypes' && typeIds.has(id)) continue; // that type is one of mine
      const moved = PERSONAL.includes(key)
        ? { ...r, ...(r.personId && { personId: person(r.personId) }), ...(r.typeId && { typeId: typeIds.get(r.typeId) ?? r.typeId }) }
        : r;
      put(out, id, moved);
    }
    (mapped as Record<string, unknown>)[key] = out;
  }
  return merge(mapped, into);
}
