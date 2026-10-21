import type { PlanDoc } from '../domain/schema';

/** The UI's only way to load and save plans (DESIGN §4.1). Drive now, maybe DynamoDB later. */
export interface Storage {
  /** `memory` never outlives the page (demo, end-to-end tests). */
  readonly kind: 'memory' | 'drive';
  listCalendars(): Promise<CalendarRef[]>;
  load(calendarId: string): Promise<{ doc: PlanDoc; version: string }>;
  save(calendarId: string, doc: PlanDoc, baseVersion: string): Promise<SaveResult>;
  create(initial: PlanDoc): Promise<{ calendarId: string; version: string }>;
}

export interface CalendarRef {
  calendarId: string;
  ownerName: string;
  writable: boolean;
}

export type SaveResult = { ok: true; version: string } | { ok: false; conflict: true };
