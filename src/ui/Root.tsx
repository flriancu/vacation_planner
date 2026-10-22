import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DRIVE_FILE_SCOPE, GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from '../config';
import { GoogleAuth, SignInError, type Session } from '../google/auth';
import { DriveStorage } from '../storage/DriveStorage';
import { MemoryStorage } from '../storage/MemoryStorage';
import { LocalReplica, replicaKey, unsavedCopies } from '../sync/Replica';
import type { Account, AccountHint } from './account';
import { App } from './App';

const auth = new GoogleAuth(GOOGLE_CLIENT_ID, GOOGLE_SCOPES, DRIVE_FILE_SCOPE);
const HINT_KEY = 'vacation-planner.account';

function readHint(): AccountHint | null {
  try {
    const raw = localStorage.getItem(HINT_KEY);
    if (!raw) return null;
    if (!raw.startsWith('{')) return { email: raw, name: raw.split('@')[0]! }; // stored by an earlier build
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v.email !== 'string' || !v.email) return null;
    const name = typeof v.name === 'string' && v.name.trim() ? v.name : v.email.split('@')[0]!;
    return { email: v.email, name, ...(typeof v.sub === 'string' && v.sub && { sub: v.sub }) };
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

/** "Continuă ca Florin" must fit in the header. */
const firstName = (u: { name: string; email: string }) => u.name.split(' ')[0] || u.email;

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
  const [demo, setDemo] = useState(() => new MemoryStorage());
  const demoRef = useRef(demo);
  /** Set at sign-in: the demo plan made before it, carried into the Drive plan once (AUTH-3). */
  const carryDemo = useRef(false);
  const sub = session?.user.sub;
  const drive = useMemo(() => (sub ? new DriveStorage(() => auth.accessToken(sub)) : null), [sub]);
  const replica = useMemo(
    () =>
      session
        ? new LocalReplica(replicaKey(session.user.sub), {
            sub: session.user.sub,
            email: session.user.email,
            name: firstName(session.user),
          })
        : null,
    // one copy per account; the session object changes on every reconnect
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [sub],
  );
  // Signed out: an account whose changes on this device haven't reached Drive comes first, so
  // "Continue as …" leads straight to saving them (another person's, on a shared computer, too).
  const waiting = useMemo(() => (sub ? undefined : (unsavedCopies().find((a) => a.sub === hint?.sub) ?? unsavedCopies()[0])), [sub, hint]);
  const offered = useMemo<AccountHint | null>(
    () => (waiting ? { email: waiting.email, name: waiting.name, sub: waiting.sub } : hint),
    [waiting, hint],
  );

  useEffect(() => void auth.preload(), []);

  const signIn = useCallback(
    (otherAccount = false) => {
      setBusy(true);
      setError(null);
      auth
        .signIn(otherAccount ? undefined : offered?.email)
        .then((s) => {
          const next = { email: s.user.email, name: firstName(s.user), sub: s.user.sub };
          writeHint(next);
          setHint(next);
          carryDemo.current = true;
          setSession(s);
        })
        .catch((e: unknown) => setError(describe(e)))
        .finally(() => setBusy(false));
    },
    [offered],
  );

  const reconnect = useCallback(
    () =>
      auth.signIn(session?.user.email, session?.user.sub).then(
        (s) => {
          setSession(s);
          return null;
        },
        (e: unknown) => describe(e),
      ),
    [session],
  );

  const signOut = useCallback(
    (keepDeviceCopy = false) => {
      // A copy with changes that never reached Drive stays, however the sign-out came (the
      // load-error screen too, where nothing was loaded and so nothing looked unsaved).
      const keep = keepDeviceCopy || !!replica?.hasUnsaved();
      if (!keep) replica?.clear();
      auth.signOut();
      if (!keep) {
        writeHint(null);
        setHint(null);
      }
      setSession(null);
    },
    [replica],
  );

  /** The demo plan, once, right after signing in; the demo starts over empty. */
  const takeDemo = useCallback(() => {
    if (!carryDemo.current) return null;
    carryDemo.current = false;
    const doc = demoRef.current.latest();
    const fresh = new MemoryStorage();
    demoRef.current = fresh;
    setDemo(fresh);
    return doc;
  }, []);

  const account: Account = session
    ? { kind: 'google', sub: session.user.sub, name: session.user.name, email: session.user.email, reconnect, signOut }
    : { kind: 'demo', hint: offered, unsavedOnDevice: !!waiting, busy, error, signIn };

  return drive ? (
    <App key={sub} storage={drive} account={account} replica={replica ?? undefined} carry={takeDemo} />
  ) : (
    <App key="demo" storage={demo} account={account} />
  );
}
