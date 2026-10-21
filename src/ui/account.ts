/** The last account in this browser: only for the sign-in label and as Google's login hint. */
export interface AccountHint {
  email: string;
  /** First name, so "Continuă ca Florin" fits in the header. */
  name: string;
}

/** Who is using the app, as the header and the plan document see it. */
export type Account =
  | {
      kind: 'demo';
      /** The Google account used last time in this browser, offered as "Continue as {name}". */
      hint: AccountHint | null;
      busy: boolean;
      error: string | null;
      /** Call from a click: Google's popup only opens from one. `otherAccount` skips the hint. */
      signIn: (otherAccount?: boolean) => void;
    }
  | {
      kind: 'google';
      sub: string;
      name: string;
      email: string;
      /** Call from a click. Resolves true once a fresh session is in place. */
      reconnect: () => Promise<boolean>;
      signOut: () => void;
    };
