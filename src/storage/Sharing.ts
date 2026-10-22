/**
 * Sharing my plan with other people, read-only (PPL-3). Separate from Storage: only storages
 * that live somewhere others can reach have it (Drive yes, the in-memory demo no).
 */
export interface Sharing {
  sharedWith(calendarId: string): Promise<SharedWith[]>;
  /** Lets `email` read my plan; they are told by their storage (Drive emails them). */
  share(calendarId: string, email: string): Promise<void>;
  unshare(calendarId: string, sharedWithId: string): Promise<void>;
}

export interface SharedWith {
  id: string;
  email: string;
  name?: string;
}

export const canShare = (storage: object): storage is Sharing => typeof (storage as Partial<Sharing>).share === 'function';
