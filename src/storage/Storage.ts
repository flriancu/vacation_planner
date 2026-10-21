import type { PlanDoc } from '../domain/schema';

/** The UI's only way to load and save plans (DESIGN §4.1). Drive now, maybe DynamoDB later. */
export interface Storage {
  /** `memory` never outlives the page (demo, end-to-end tests). */
  readonly kind: 'memory' | 'drive';
  /** My calendars, oldest first. Normally there is exactly one. */
  listCalendars(): Promise<CalendarRef[]>;
  /** Calendars I removed (Drive: in the trash), so the app doesn't start an empty one over them. */
  listRemoved(): Promise<CalendarRef[]>;
  load(calendarId: string): Promise<{ doc: PlanDoc; version: string }>;
  /** The current version only: cheap, to see whether another device saved. */
  version(calendarId: string): Promise<string>;
  save(calendarId: string, doc: PlanDoc, baseVersion: string): Promise<SaveResult>;
  create(initial: PlanDoc): Promise<{ calendarId: string; version: string }>;
  remove(calendarId: string): Promise<void>;
}

export interface CalendarRef {
  calendarId: string;
  ownerName: string;
  writable: boolean;
}

export type SaveResult = { ok: true; version: string } | { ok: false; conflict: true };

/**
 * What a storage's errors may say about themselves, so callers react to the meaning (try again
 * later, ask the user to sign in) without knowing Drive's errors.
 */
export interface StorageFailure {
  readonly retryable?: boolean;
  readonly needsSignIn?: boolean;
  /** The calendar is gone (trashed or deleted): look for it again. */
  readonly fileGone?: boolean;
}

export const isRetryable = (e: unknown): boolean => (e as StorageFailure | null)?.retryable === true;
export const needsSignIn = (e: unknown): boolean => (e as StorageFailure | null)?.needsSignIn === true;
export const fileGone = (e: unknown): boolean => (e as StorageFailure | null)?.fileGone === true;
