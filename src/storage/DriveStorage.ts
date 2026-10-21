import { migrate } from '../domain/migrate';
import type { PlanDoc } from '../domain/schema';
import { createPlanFile, findPlanFiles, getVersion, readPlanFile, writePlanFile } from '../google/drive';
import type { CalendarRef, SaveResult, Storage } from './Storage';

/**
 * Plans as JSON files in the user's own Google Drive (DESIGN §4.2). `token` returns a valid
 * access token or throws AuthExpiredError, which the UI turns into a "reconnect" prompt.
 */
export class DriveStorage implements Storage {
  readonly kind = 'drive';

  constructor(private readonly token: () => string) {}

  async listCalendars(): Promise<CalendarRef[]> {
    return (await findPlanFiles(this.token())).map((f) => ({ calendarId: f.id, ownerName: '', writable: true }));
  }

  async load(calendarId: string) {
    const { raw, version } = await readPlanFile(this.token(), calendarId);
    return { doc: migrate(raw), version };
  }

  /**
   * Drive has no compare-and-swap, so this checks the version first and then writes; the gap
   * is a few hundred milliseconds, and only my own devices write my file (DESIGN §4.2).
   */
  async save(calendarId: string, doc: PlanDoc, baseVersion: string): Promise<SaveResult> {
    const token = this.token();
    if ((await getVersion(token, calendarId)) !== baseVersion) return { ok: false, conflict: true };
    return { ok: true, version: await writePlanFile(token, calendarId, doc) };
  }

  async create(initial: PlanDoc) {
    const file = await createPlanFile(this.token(), initial);
    return { calendarId: file.id, version: file.version };
  }
}
