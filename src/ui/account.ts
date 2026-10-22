/** The last account in this browser: for the sign-in label, as Google's login hint, and to find this device's copy of the plan. */
export interface AccountHint {
  email: string;
  /** First name, so "Continuă ca Florin" fits in the header. */
  name: string;
  sub?: string;
}

/** Who is using the app, as the header and the plan document see it. */
export type Account =
  | {
      kind: 'demo';
      /** The Google account used last time in this browser, offered as "Continue as {name}". */
      hint: AccountHint | null;
      /** This device holds changes to that account's plan that haven't reached Drive yet. */
      unsavedOnDevice: boolean;
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
      /** Call from a click. Resolves null once a fresh session is in place, or the reason it failed. */
      reconnect: () => Promise<string | null>;
      /** `keepDeviceCopy`: some change didn't reach Drive, so this device keeps its copy for the next sign-in. */
      signOut: (keepDeviceCopy?: boolean) => void;
      /** Google's picker on plans shared with me (PPL-3): the picked file, or null if closed. */
      pickSharedPlan: (title: string, locale: string) => Promise<{ id: string; name: string } | null>;
    };
