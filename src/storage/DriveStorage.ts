import { migrate, toFile } from '../domain/migrate';
import type { PlanDoc } from '../domain/schema';
import { createPlanFile, findPlanFiles, getVersion, readPlanFile, trashPlanFile, writePlanFile, type DriveFile } from '../google/drive';
import type { CalendarRef, SaveResult, Storage } from './Storage';

const ref = (f: DriveFile): CalendarRef => ({ calendarId: f.id, ownerName: '', writable: true });

/**
 * Plans as JSON files in the user's own Google Drive (DESIGN §4.2). `token` returns a valid
 * access token or throws AuthExpiredError, which the UI turns into a "reconnect" prompt.
 */
export class DriveStorage implements Storage {
  readonly kind = 'drive';

  constructor(private readonly token: () => string) {}

  async listCalendars(): Promise<CalendarRef[]> {
    return (await findPlanFiles(this.token())).map(ref);
  }

  async listRemoved(): Promise<CalendarRef[]> {
    return (await findPlanFiles(this.token(), true)).map(ref);
  }

  async load(calendarId: string) {
    const { raw, version } = await readPlanFile(this.token(), calendarId);
    return { doc: migrate(raw), version };
  }

  version(calendarId: string): Promise<string> {
    return getVersion(this.token(), calendarId);
  }

  /**
   * Drive has no compare-and-swap, so this checks the version first and then writes. Two
   * devices saving within that gap can overwrite each other; the loser still holds its records
   * (in memory and in the device's saved copy) and merges them back on its next save or open.
   */
  async save(calendarId: string, doc: PlanDoc, baseVersion: string): Promise<SaveResult> {
    const token = this.token();
    if ((await getVersion(token, calendarId)) !== baseVersion) return { ok: false, conflict: true };
    return { ok: true, version: await writePlanFile(token, calendarId, toFile(doc)) };
  }

  async create(initial: PlanDoc) {
    const file = await createPlanFile(this.token(), toFile(initial));
    return { calendarId: file.id, version: file.version };
  }

  remove(calendarId: string): Promise<void> {
    return trashPlanFile(this.token(), calendarId);
  }
}
