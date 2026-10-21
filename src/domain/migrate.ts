import { isISODate, yearOf } from './dates';
import { FIRST_YEAR, LAST_YEAR } from './holidays';
import {
  BUILTIN_TYPES,
  COLLECTION_KEYS,
  put,
  SCHEMA_VERSION,
  STATUS_RANK,
  type Collections,
  type Meta,
  type PlanDoc,
  type Settings,
} from './schema';

export class UnsupportedPlanError extends Error {}

/** For records repaired here: older than anything real, so any real edit wins a merge against them. */
const EPOCH = '1970-01-01T00:00:00.000Z';

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string';
const isStamp = (v: unknown): v is string => isText(v) && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const isNames = (v: unknown) => isObject(v) && isText(v.ro) && isText(v.en);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isYear = (v: unknown) => Number.isInteger(v) && (v as number) >= FIRST_YEAR && (v as number) <= LAST_YEAR;
/** A date the holiday rules cover, so every view of it can be drawn. */
const isDay = (v: unknown) => isISODate(v) && yearOf(v) >= FIRST_YEAR && yearOf(v) <= LAST_YEAR;
const isRange = (r: Raw) => isDay(r.start) && isDay(r.end) && (r.start as string) <= (r.end as string);
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);

/**
 * What a live record of each collection must look like for the app to use it. `types` are the
 * ids of the readable leave types, so a block never points at a type the app can't show.
 */
const VALID: { [K in keyof Collections]: (r: Raw, types: ReadonlySet<string>) => boolean } = {
  people: (r) => isText(r.name),
  leaveTypes: (r) =>
    isNames(r.name) &&
    ['annual', 'floating', 'excused', 'none'].includes(r.budget as string) &&
    typeof r.needsApproval === 'boolean' &&
    optional(r.key, (k) => BUILTIN_TYPES.some((b) => b.key === k)),
  blocks: (r, types) =>
    isText(r.personId) &&
    types.has(r.typeId as string) &&
    isRange(r) &&
    Object.hasOwn(STATUS_RANK, r.status as string) &&
    optional(r.note, isText) &&
    optional(r.swapFor, isDay),
  holidayOverrides: (r) => isDay(r.date) && ['add', 'remove', 'rename'].includes(r.action as string) && optional(r.name, isNames),
  yearSettings: (r) =>
    isText(r.personId) &&
    isYear(r.year) &&
    isNumber(r.annualOpening) &&
    isNumber(r.floatingQuota) &&
    isNumber(r.excusedQuota) &&
    typeof r.closedCountsAgainstAnnual === 'boolean',
  adjustments: (r) => isText(r.personId) && isYear(r.year) && isDay(r.date) && isNumber(r.days) && isText(r.note),
  dismissals: (r) => isText(r.personId) && ['suggestion', 'swap'].includes(r.kind as string) && isRange(r),
  following: (r) => isText(r.driveFileId) && isText(r.label),
};

/**
 * Checks a plan file read from storage and brings it to the current schema (§6.4 of the
 * requirements). The file comes from outside the app (another device, another build, a hand
 * edit), so nothing in it is trusted: a record the app can't use is set aside in `skipped`
 * and written back unchanged, instead of breaking the calendar on every device. Timestamps that
 * aren't timestamps become 1970, so they can't win merges. A plan without its owner's person or
 * a built-in leave type gets them back, with fixed ids so two devices add the same record.
 */
export function migrate(raw: unknown): PlanDoc {
  if (!isObject(raw)) throw new UnsupportedPlanError('The plan file is not a JSON object.');
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    throw new UnsupportedPlanError(
      `The plan file has schema version ${String(raw.schemaVersion)}; this app reads version ${SCHEMA_VERSION}.`,
    );
  }
  if (!isObject(raw.owner) || !isText(raw.owner.googleSub) || !isObject(raw.settings)) {
    throw new UnsupportedPlanError('The plan file is missing its owner or settings.');
  }

  const out: Raw = { ...raw, owner: { ...raw.owner }, settings: readSettings(raw.settings) };
  const skipped: NonNullable<PlanDoc['skipped']> = {};
  const types = new Set<string>();
  // Leave types first: blocks are checked against them (deleted types too: old blocks keep theirs).
  for (const key of ['leaveTypes', ...COLLECTION_KEYS.filter((k) => k !== 'leaveTypes')] as const) {
    const source = isObject(raw[key]) ? raw[key] : {};
    const kept: Record<string, Meta> = {};
    const set: Raw = { ...(isObject(raw.skipped) && isObject(raw.skipped[key]) ? raw.skipped[key] : {}) };
    for (const [id, record] of Object.entries(source)) {
      if (!isObject(record) || (record.id !== undefined && record.id !== id)) {
        put(set, id, record);
        continue;
      }
      const meta = {
        id,
        createdAt: isStamp(record.createdAt) ? record.createdAt : EPOCH,
        updatedAt: isStamp(record.updatedAt) ? record.updatedAt : EPOCH,
      };
      const valid = VALID[key](record, types);
      if (record.deleted === true) put(kept, id, { ...record, ...meta, deleted: true });
      else if (valid) put(kept, id, { ...record, ...meta });
      else put(set, id, record);
      if (key === 'leaveTypes' && valid) types.add(id);
    }
    out[key] = kept;
    if (Object.keys(set).length) skipped[key] = set;
  }
  if (Object.keys(skipped).length) out.skipped = skipped;
  else delete out.skipped;

  return withEssentials(out as PlanDoc);
}

function readSettings(s: Raw): Settings {
  return { ...s, lang: s.lang === 'en' ? 'en' : 'ro', updatedAt: isStamp(s.updatedAt) ? s.updatedAt : EPOCH } as Settings;
}

const alive = <T extends Meta>(c: Record<string, T>) => Object.values(c).filter((r) => !r.deleted);

/** The owner's person and every built-in leave type, which the screens rely on. */
function withEssentials(doc: PlanDoc): PlanDoc {
  let people = doc.people;
  if (alive(people).length === 0) {
    const id = `person-${doc.owner.googleSub}`;
    people = { ...people, [id]: { id, createdAt: EPOCH, updatedAt: EPOCH, name: 'Me', color: '#e05a9a', hasAccount: true } };
  }
  let leaveTypes = doc.leaveTypes;
  for (const t of BUILTIN_TYPES) {
    if (alive(leaveTypes).some((lt) => lt.key === t.key)) continue;
    const id = `type-${t.key}`;
    leaveTypes = { ...leaveTypes, [id]: { ...t, id, createdAt: EPOCH, updatedAt: EPOCH } };
  }
  return people === doc.people && leaveTypes === doc.leaveTypes ? doc : { ...doc, people, leaveTypes };
}

/** The document as it is stored: the skipped records go back where they came from. */
export function toFile(doc: PlanDoc): Omit<PlanDoc, 'skipped'> {
  const { skipped, ...rest } = doc;
  if (!skipped) return rest;
  const out: Raw = { ...rest };
  for (const [key, records] of Object.entries(skipped)) {
    const merged: Raw = { ...records };
    for (const [id, record] of Object.entries(out[key] as Raw)) put(merged, id, record);
    out[key] = merged;
  }
  return out as Omit<PlanDoc, 'skipped'>;
}

/** How many records of the file the app had to set aside. */
export function skippedCount(doc: PlanDoc): number {
  return Object.values(doc.skipped ?? {}).reduce((n, records) => n + Object.keys(records ?? {}).length, 0);
}
