import type { PlanDoc } from '../domain/schema';
import type { CalendarRef, SaveResult, Storage } from './Storage';

/** In-memory storage for the demo and the end-to-end tests (DESIGN §4.4). Nothing survives a reload. */
export class MemoryStorage implements Storage {
  readonly kind = 'memory';
  private readonly files = new Map<string, { doc: PlanDoc; version: number; removed?: true }>();
  private nextId = 1;

  constructor(seed: PlanDoc[] = []) {
    for (const doc of seed) this.files.set(`memory-${this.nextId++}`, { doc: structuredClone(doc), version: 1 });
  }

  async listCalendars(): Promise<CalendarRef[]> {
    return this.refs(false);
  }

  async listRemoved(): Promise<CalendarRef[]> {
    return this.refs(true);
  }

  async load(calendarId: string) {
    const file = this.get(calendarId);
    return { doc: structuredClone(file.doc), version: String(file.version) };
  }

  async version(calendarId: string) {
    return String(this.get(calendarId).version);
  }

  async save(calendarId: string, doc: PlanDoc, baseVersion: string): Promise<SaveResult> {
    const file = this.get(calendarId);
    if (String(file.version) !== baseVersion) return { ok: false, conflict: true };
    file.doc = structuredClone(doc);
    file.version++;
    return { ok: true, version: String(file.version) };
  }

  async create(initial: PlanDoc) {
    const calendarId = `memory-${this.nextId++}`;
    this.files.set(calendarId, { doc: structuredClone(initial), version: 1 });
    return { calendarId, version: '1' };
  }

  async remove(calendarId: string) {
    this.get(calendarId).removed = true;
  }

  /** The newest saved state of my calendar, or null (for carrying the demo plan into Drive). */
  latest(): PlanDoc | null {
    const file = [...this.files.values()].find((f) => !f.removed);
    return file ? structuredClone(file.doc) : null;
  }

  private refs(removed: boolean): CalendarRef[] {
    return [...this.files]
      .filter(([, f]) => !!f.removed === removed)
      .map(([calendarId]) => ({ calendarId, ownerName: '', writable: true }));
  }

  private get(calendarId: string) {
    const file = this.files.get(calendarId);
    if (!file || file.removed) throw new Error(`No calendar ${calendarId}`);
    return file;
  }
}
