/**
 * Google sign-in with the GIS token client (DESIGN §5.1): browser only, no client secret,
 * no refresh token. Access tokens last about an hour. Google only opens its sign-in popup
 * from a click, so `signIn` must be called from a click handler, synchronously at its start.
 */
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';
/** Treat a token as expired a minute early, so a save never starts with a dying token. */
const EARLY_MS = 60_000;

export class AuthExpiredError extends Error {
  /** StorageFailure: the user has to sign in again. */
  readonly needsSignIn = true;
  constructor() {
    super('Google session expired');
  }
}

export class SignInError extends Error {
  constructor(
    /** `blocked`: Google's script couldn't load (an extension or network); `other_account`: a reconnect came back as someone else. */
    readonly reason: 'popup' | 'drive_denied' | 'not_ready' | 'blocked' | 'other_account' | 'google',
    message: string,
  ) {
    super(message);
  }
}

export interface GoogleUser {
  sub: string;
  name: string;
  email: string;
}

export interface Session {
  user: GoogleUser;
  expiresAt: number;
}

let gisLoading: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => {
        gisLoading = null;
        reject(new Error('Could not load Google sign-in'));
      },
      { once: true },
    );
    document.head.append(script);
  });
  return gisLoading;
}

export class GoogleAuth {
  private client: google.accounts.oauth2.TokenClient | null = null;
  private token: string | null = null;
  private session: Session | null = null;
  private loadFailed = false;

  constructor(
    private readonly clientId: string,
    private readonly scopes: string[],
    private readonly requiredScope: string,
  ) {}

  /** Loads Google's script ahead of the click, so the popup opens inside the click. Never rejects. */
  async preload(): Promise<void> {
    try {
      await loadGis();
      this.loadFailed = false;
      this.client ??= window.google!.accounts!.oauth2!.initTokenClient({
        client_id: this.clientId,
        scope: this.scopes.join(' '),
        callback: () => {},
      });
    } catch {
      this.loadFailed = true; // reported on the next click, as "blocked" rather than "still loading"
    }
  }

  get current(): Session | null {
    return this.session;
  }

  /**
   * A valid access token, or AuthExpiredError: then the user has to click "reconnect". With
   * `forSub`, only that account's: a storage made for one account never writes with another's.
   */
  accessToken(forSub?: string): string {
    if (!this.token || !this.session || Date.now() >= this.session.expiresAt) throw new AuthExpiredError();
    if (forSub && this.session.user.sub !== forSub) throw new AuthExpiredError();
    return this.token;
  }

  /**
   * Call from a click. `hint` pre-selects the account used last time. With `expectSub` (a
   * reconnect) a different account is refused, and the current session is left as it was.
   */
  async signIn(hint?: string, expectSub?: string): Promise<Session> {
    const client = this.client;
    if (!client) {
      const failed = this.loadFailed;
      void this.preload();
      throw failed
        ? new SignInError('blocked', 'Google sign-in could not load')
        : new SignInError('not_ready', 'Google sign-in is still loading');
    }
    const response = await new Promise<google.accounts.oauth2.TokenResponse>((resolve, reject) => {
      client.callback = (r) => (r.error ? reject(new SignInError('google', r.error_description || r.error)) : resolve(r));
      client.error_callback = (e) => reject(new SignInError('popup', e.message || e.type));
      client.requestAccessToken({ prompt: hint ? '' : 'select_account', ...(hint && { login_hint: hint }) });
    });
    if (!window.google!.accounts!.oauth2!.hasGrantedAllScopes(response, this.requiredScope)) {
      throw new SignInError('drive_denied', 'Google Drive access was not granted');
    }
    const user = await readUser(response.access_token);
    if (expectSub && user.sub !== expectSub) throw new SignInError('other_account', 'A different Google account answered');
    this.token = response.access_token;
    this.session = { user, expiresAt: Date.now() + response.expires_in * 1000 - EARLY_MS };
    keep({ token: this.token, session: this.session });
    return this.session;
  }

  /** The session of this tab from before a reload, if it hasn't expired. */
  restore(): Session | null {
    const kept = readKept();
    if (!kept || Date.now() >= kept.session.expiresAt) {
      keep(null);
      return null;
    }
    this.token = kept.token;
    this.session = kept.session;
    return this.session;
  }

  /** Forgets the session in this tab. The grant stays; revoke it in the Google account if wanted. */
  signOut() {
    this.token = null;
    this.session = null;
    keep(null);
  }
}

/** Who signed in. Without a `sub` there is no account to save for, so that is a failed sign-in. */
async function readUser(token: string): Promise<GoogleUser> {
  const info = await fetch(USERINFO, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!info.ok) throw new SignInError('google', `userinfo ${info.status}`);
  const u = (await info.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isUser({ sub: u.sub, name: '', email: '' })) throw new SignInError('google', 'userinfo without an account id');
  const email = typeof u.email === 'string' ? u.email : '';
  const name = typeof u.name === 'string' && u.name.trim() ? u.name : email || 'Me';
  return { sub: u.sub as string, name, email };
}

function isUser(u: unknown): u is GoogleUser {
  const v = u as Partial<GoogleUser> | null;
  return typeof v?.sub === 'string' && v.sub !== '' && typeof v.name === 'string' && typeof v.email === 'string';
}

/**
 * The session survives reloads in the same tab via sessionStorage, which the browser clears
 * when the tab closes. It is never written to localStorage.
 */
const SESSION_KEY = 'vacation-planner.session';

function keep(value: { token: string; session: Session } | null) {
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // storage blocked: reloads ask for a click again
  }
}

function readKept(): { token: string; session: Session } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const value = raw ? (JSON.parse(raw) as { token?: unknown; session?: Partial<Session> }) : null;
    const ok = typeof value?.token === 'string' && isUser(value.session?.user) && Number.isFinite(value.session?.expiresAt);
    return ok ? (value as { token: string; session: Session }) : null;
  } catch {
    return null;
  }
}
