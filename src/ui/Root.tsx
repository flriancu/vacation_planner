import { useCallback, useEffect, useMemo, useState } from 'react';
import { DRIVE_FILE_SCOPE, GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from '../config';
import { GoogleAuth, SignInError, type Session } from '../google/auth';
import { DriveStorage } from '../storage/DriveStorage';
import { MemoryStorage } from '../storage/MemoryStorage';
import type { Account, AccountHint } from './account';
import { App } from './App';

const auth = new GoogleAuth(GOOGLE_CLIENT_ID, GOOGLE_SCOPES, DRIVE_FILE_SCOPE);
const HINT_KEY = 'vacation-planner.account';

function readHint(): AccountHint | null {
  try {
    const raw = localStorage.getItem(HINT_KEY);
    if (!raw) return null;
    if (!raw.startsWith('{')) return { email: raw, name: raw.split('@')[0]! }; // stored by an earlier build
    const v = JSON.parse(raw) as Partial<AccountHint>;
    return typeof v.email === 'string' ? { email: v.email, name: v.name || v.email.split('@')[0]! } : null;
  } catch {
    return null;
  }
}

function writeHint(hint: AccountHint | null) {
  try {
    if (hint) localStorage.setItem(HINT_KEY, JSON.stringify(hint));
    else localStorage.removeItem(HINT_KEY);
  } catch {
    // private mode: the user picks the account again next time
  }
}

function describe(e: unknown): string {
  if (e instanceof SignInError) return e.reason;
  return e instanceof Error ? e.message : String(e);
}

/**
 * Signed out: the demo year in memory (AUTH-3). Signed in: my plan in my Google Drive.
 * One click per visit (a reload in the same tab keeps the session, up to about an hour):
 * without a server there is no way to stay signed in across visits.
 */
export function Root() {
  const [session, setSession] = useState<Session | null>(() => auth.restore());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState(readHint);
  const demo = useMemo(() => new MemoryStorage(), []);
  const sub = session?.user.sub;
  const drive = useMemo(() => (sub ? new DriveStorage(() => auth.accessToken()) : null), [sub]);

  useEffect(() => {
    auth.preload().catch(() => setError('google'));
  }, []);

  const signIn = useCallback(
    (otherAccount = false) => {
      setBusy(true);
      setError(null);
      auth
        .signIn(otherAccount ? undefined : hint?.email)
        .then((s) => {
          const next = { email: s.user.email, name: s.user.name.split(' ')[0] || s.user.email };
          writeHint(next);
          setHint(next);
          setSession(s);
        })
        .catch((e: unknown) => setError(describe(e)))
        .finally(() => setBusy(false));
    },
    [hint],
  );

  const reconnect = useCallback(
    () =>
      auth.signIn(session?.user.email).then(
        (s) => {
          setSession(s);
          return true;
        },
        () => false,
      ),
    [session],
  );

  const signOut = useCallback(() => {
    auth.signOut();
    writeHint(null);
    setHint(null);
    setSession(null);
  }, []);

  const account: Account = session
    ? { kind: 'google', sub: session.user.sub, name: session.user.name, email: session.user.email, reconnect, signOut }
    : { kind: 'demo', hint, busy, error, signIn };

  return <App key={sub ?? 'demo'} storage={drive ?? demo} account={account} />;
}
