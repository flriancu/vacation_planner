import type { ISODate } from './dates';

/** Document schema v1 (DESIGN.md §3). One document per Google account. */

export type Stamp = string; // ISO-8601 UTC timestamp

export interface Names {
  ro: string;
  en: string;
}

/** Every record carries these; deleted records stay as markers so merges see the delete. */
export interface Meta {
  id: string;
  createdAt: Stamp;
  updatedAt: Stamp;
  deleted?: true;
}

export interface Person extends Meta {
  name: string;
  color: string;
  hasAccount: boolean;
}

export type LeaveTypeKey = 'annual' | 'floating' | 'excused' | 'swap' | 'closed' | 'special' | 'sick' | 'unpaid';
export type Budget = 'annual' | 'floating' | 'excused' | 'none';
/** Budgets with a per-year quota that expires on 31 Dec (LT-6). */
export type ExpiringBudget = 'floating' | 'excused';

export interface LeaveType extends Meta {
  /** Set on built-in types only. */
  key?: LeaveTypeKey;
  name: Names;
  color: string;
  budget: Budget;
  needsApproval: boolean;
  hidden?: boolean;
}

export type BlockStatus = 'idea' | 'planned' | 'approved';

export interface Block extends Meta {
  personId: string;
  typeId: string;
  /** Inclusive range. */
  start: ISODate;
  end: ISODate;
  status: BlockStatus;
  note?: string;
  /** Swap days only: the weekend holiday this day replaces (DAY-4). */
  swapFor?: ISODate;
  gcalEventId?: string;
}

export interface HolidayOverride extends Meta {
  date: ISODate;
  action: 'add' | 'remove' | 'rename';
  name?: Names;
}

export interface YearSettings extends Meta {
  personId: string;
  year: number;
  annualOpening: number;
  floatingQuota: number;
  excusedQuota: number;
  closedCountsAgainstAnnual: boolean;
}

export interface Adjustment extends Meta {
  personId: string;
  year: number;
  date: ISODate;
  days: number;
  note: string;
}

/** A hidden suggestion (`start`–`end`), or a swap reminder (`start` = `end` = the weekend holiday). */
export interface Dismissal extends Meta {
  personId: string;
  kind: 'suggestion' | 'swap';
  start: ISODate;
  end: ISODate;
}

export interface Follow extends Meta {
  driveFileId: string;
  label: string;
}

export interface Settings {
  lang: 'ro' | 'en';
  gcalCalendarId?: string;
  updatedAt: Stamp;
}

export interface Collections {
  people: Person;
  leaveTypes: LeaveType;
  blocks: Block;
  holidayOverrides: HolidayOverride;
  yearSettings: YearSettings;
  adjustments: Adjustment;
  dismissals: Dismissal;
  following: Follow;
}

/** Every collection of a plan, in a fixed order (merge, migrate). */
export const COLLECTION_KEYS: readonly (keyof Collections)[] = [
  'people',
  'leaveTypes',
  'blocks',
  'holidayOverrides',
  'yearSettings',
  'adjustments',
  'dismissals',
  'following',
];

export type PlanDoc = {
  schemaVersion: 1;
  owner: { googleSub: string };
  settings: Settings;
  /**
   * Records from the file that this app can't read (migrate.ts). Kept out of the collections,
   * so they never reach the calendar, and written back unchanged (`toFile`).
   */
  skipped?: Partial<Record<keyof Collections, Record<string, unknown>>>;
} & { [K in keyof Collections]: Record<string, Collections[K]> };

export const SCHEMA_VERSION = 1;

export interface RecordContext {
  now: Stamp;
  newId: () => string;
}

export const STATUS_RANK: Record<BlockStatus, number> = { idea: 0, planned: 1, approved: 2 };

/** Built-in leave types (LT-1, LT-2). Colours follow the old spreadsheet where it had one. */
export const BUILTIN_TYPES: readonly Omit<LeaveType, keyof Meta>[] = [
  { key: 'annual', name: { ro: 'Concediu de odihnă', en: 'Annual leave' }, color: '#e05a9a', budget: 'annual', needsApproval: true },
  { key: 'floating', name: { ro: 'Zi flotantă', en: 'Floating day' }, color: '#ffbdda', budget: 'floating', needsApproval: false },
  { key: 'excused', name: { ro: 'Învoire', en: 'Excused leave' }, color: '#f7c6dc', budget: 'excused', needsApproval: true },
  { key: 'swap', name: { ro: 'Zi compensatorie', en: 'Swap day' }, color: '#ff96c4', budget: 'none', needsApproval: true },
  {
    key: 'closed',
    name: { ro: 'Birou închis', en: 'Office closed' },
    color: '#ff96c4',
    budget: 'none',
    needsApproval: false,
  },
  { key: 'special', name: { ro: 'Eveniment special', en: 'Special event' }, color: '#b48ce0', budget: 'none', needsApproval: true },
  { key: 'sick', name: { ro: 'Concediu medical', en: 'Sick leave' }, color: '#8cb4e0', budget: 'none', needsApproval: false },
  { key: 'unpaid', name: { ro: 'Concediu fără plată', en: 'Unpaid leave' }, color: '#a0a0a0', budget: 'none', needsApproval: true },
];

/** `obj[key] = value` that stays a plain own property even for ids like `__proto__`. */
export function put(obj: object, key: string, value: unknown) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

export function live<T extends Meta>(collection: Record<string, T>): T[] {
  return Object.values(collection).filter((r) => !r.deleted);
}

/** Returns a new document with `data` added as a fresh record of `key`. */
export function addRecord<K extends keyof Collections>(
  doc: PlanDoc,
  key: K,
  data: Omit<Collections[K], keyof Meta>,
  ctx: RecordContext,
): { doc: PlanDoc; record: Collections[K] } {
  const now = ctx.now;
  const record = { ...data, id: ctx.newId(), createdAt: now, updatedAt: now } as Collections[K];
  return { doc: { ...doc, [key]: { ...doc[key], [record.id]: record } }, record };
}

export function newPlanDoc(owner: { googleSub: string; personName: string }, ctx: RecordContext): { doc: PlanDoc; personId: string } {
  let doc: PlanDoc = {
    schemaVersion: 1,
    owner: { googleSub: owner.googleSub },
    settings: { lang: 'ro', updatedAt: ctx.now },
    people: {},
    leaveTypes: {},
    blocks: {},
    holidayOverrides: {},
    yearSettings: {},
    adjustments: {},
    dismissals: {},
    following: {},
  };
  for (const t of BUILTIN_TYPES) doc = addRecord(doc, 'leaveTypes', t, ctx).doc;
  const added = addRecord(doc, 'people', { name: owner.personName, color: '#e05a9a', hasAccount: true }, ctx);
  return { doc: added.doc, personId: added.record.id };
}

export function typeByKey(doc: PlanDoc, key: LeaveTypeKey): LeaveType | undefined {
  return live(doc.leaveTypes).find((t) => t.key === key);
}

export function getYearSettings(doc: PlanDoc, personId: string, year: number): YearSettings | undefined {
  return live(doc.yearSettings).find((s) => s.personId === personId && s.year === year);
}
