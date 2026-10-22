/**
 * Sharing my plan with other people, read-only (PPL-3). Separate from Storage: only storages
 * that live somewhere others can reach have it (Drive yes, the in-memory demo no).
 */
export interface Sharing {
  sharedWith(calendarId: string): Promise<SharedWith[]>;
  /** Lets `email` read my plan; they are told by their storage (Drive emails them). */
  share(calendarId: string, email: string): Promise<void>;
  /** Takes the access away; one already gone counts as done. */
  unshare(calendarId: string, sharedWithId: string): Promise<void>;
}

/** One kind of access to my plan: a person or group (by address), everyone in a domain, or anyone with the link. */
export interface SharedWith {
  id: string;
  kind: 'user' | 'group' | 'domain' | 'anyone';
  email?: string;
  domain?: string;
  name?: string;
  /** What they may do: only `reader` is what this app gives; the others were given elsewhere. */
  role: 'reader' | 'commenter' | 'writer';
}

export const canShare = (storage: object): storage is Sharing => typeof (storage as Partial<Sharing>).share === 'function';
