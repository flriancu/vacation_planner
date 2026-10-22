import { AuthExpiredError } from './auth';

/** Drive REST v3 calls for the plan file (DESIGN §4.2). Every call takes a fresh access token. */
const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
export const PLAN_FILE_NAME = 'vacation-planner.json';
/** Marks files this app created, so it finds them again (`drive.file` sees only those). */
export const APP_PROPERTY = { key: 'app', value: 'vacation_planner' };
/** One person has one plan file, rarely two: a list longer than this many pages is broken. */
const MAX_PAGES = 20;
/** A call that hasn't answered by then never will: give up, so the next save can run. */
export const CALL_TIMEOUT_MS = 30_000;

/**
 * Drive answered with an error, or didn't answer. `status` 0 means no answer (network,
 * timeout); `retryable` says whether trying again later can help.
 */
export class DriveError extends Error {
  constructor(
    readonly status: number,
    private readonly body: string,
  ) {
    super(status ? `Google Drive answered ${status}: ${body.slice(0, 200)}` : `Google Drive did not answer: ${body}`);
  }

  /** StorageFailure: whether trying again later can help. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500 || this.rateLimited;
  }

  /** Google answers "slow down" with 403 and a reason (handle-errors guide): that passes. */
  get rateLimited(): boolean {
    return this.status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(this.body);
  }
}

/** The plan file is in the Drive trash (or gone): writing to it would save into the bin. */
export class PlanFileGoneError extends Error {
  /** StorageFailure: look for the plan file again. */
  readonly fileGone = true;
  constructor(readonly reason: 'trashed' | 'missing') {
    super(reason === 'trashed' ? 'The plan file is in the Google Drive trash' : 'The plan file no longer exists in Google Drive');
  }
}

export interface DriveFile {
  id: string;
  version: string;
}

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      // Versions and content must come from Drive itself, never from the HTTP cache: a cached
      // version would make a stale write look safe. Redirects never come from Drive's API.
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (e) {
    throw new DriveError(0, e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network');
  }
  if (response.status === 401) throw new AuthExpiredError();
  if (!response.ok) throw new DriveError(response.status, await response.text().catch(() => ''));
  return response;
}

async function json<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new DriveError(502, 'an answer that is not JSON');
  }
}

/** Drive versions are numbers sent as strings; anything else is a broken answer. */
function versionOf(body: { version?: unknown }): string {
  const v = body.version;
  if ((typeof v === 'string' && /^\d+$/.test(v)) || (typeof v === 'number' && Number.isInteger(v))) return String(v);
  throw new DriveError(502, 'an answer without a file version');
}

/**
 * My plan files (`trashed`: the ones in the bin instead), oldest first, every page of the list.
 * An incomplete list is an error, never "no plan": the app would create an empty one over it.
 */
export async function findPlanFiles(token: string, trashed = false): Promise<DriveFile[]> {
  const q = `appProperties has { key='${APP_PROPERTY.key}' and value='${APP_PROPERTY.value}' } and 'me' in owners and trashed=${trashed}`;
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    if (++pages > MAX_PAGES) throw new DriveError(502, 'a list of files that never ends');
    const params = new URLSearchParams({
      q,
      spaces: 'drive',
      orderBy: 'createdTime',
      fields: 'nextPageToken,incompleteSearch,files(id,version,ownedByMe)',
      ...(pageToken && { pageToken }),
    });
    const body = await json<{ files?: unknown; nextPageToken?: unknown; incompleteSearch?: unknown }>(
      await call(token, `${FILES}?${params}`),
    );
    if (!Array.isArray(body.files) || body.incompleteSearch === true) throw new DriveError(502, 'an incomplete list of files');
    for (const f of body.files as { id?: unknown; version?: unknown; ownedByMe?: unknown }[]) {
      if (typeof f.id !== 'string' || !f.id) throw new DriveError(502, 'a listed file without an id');
      if (f.ownedByMe !== false) out.push({ id: f.id, version: versionOf(f) });
    }
    pageToken = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : undefined;
  } while (pageToken);
  return out;
}

export async function getVersion(token: string, id: string): Promise<string> {
  let response: Response;
  try {
    response = await call(token, `${FILES}/${encodeURIComponent(id)}?fields=version,trashed`);
  } catch (e) {
    if (e instanceof DriveError && e.status === 404) throw new PlanFileGoneError('missing');
    throw e;
  }
  const body = await json<{ version?: unknown; trashed?: unknown }>(response);
  if (body.trashed === true) throw new PlanFileGoneError('trashed');
  return versionOf(body);
}

/** Version first, then content: if the file changes in between, the next save sees a conflict and merges. */
export async function readPlanFile(token: string, id: string): Promise<{ text: string; version: string }> {
  const version = await getVersion(token, id);
  const text = await (await call(token, `${FILES}/${encodeURIComponent(id)}?alt=media`)).text();
  return { text, version };
}

export async function createPlanFile(token: string, content: unknown): Promise<DriveFile> {
  const boundary = `vp-${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name: PLAN_FILE_NAME,
    mimeType: 'application/json',
    appProperties: { [APP_PROPERTY.key]: APP_PROPERTY.value },
  };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(content)}\r\n--${boundary}--`;
  const response = await call(token, `${UPLOAD}?uploadType=multipart&fields=id,version`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const file = await json<{ id?: unknown; version?: unknown }>(response);
  if (typeof file.id !== 'string') throw new DriveError(502, 'an answer without a file id');
  return { id: file.id, version: versionOf(file) };
}

/** Replaces the content; returns the new version. */
export async function writePlanFile(token: string, id: string, content: unknown): Promise<string> {
  const response = await call(token, `${UPLOAD}/${encodeURIComponent(id)}?uploadType=media&fields=version`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(content),
  });
  return versionOf(await json(response));
}

/** Moves a file to the Drive trash (recoverable for 30 days). */
export async function trashPlanFile(token: string, id: string): Promise<void> {
  await call(token, `${FILES}/${encodeURIComponent(id)}?fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}

/** Someone a plan file is shared with (PPL-3). */
export interface Share {
  id: string;
  kind: 'user' | 'group' | 'domain' | 'anyone';
  email?: string;
  domain?: string;
  name?: string;
  role: 'reader' | 'commenter' | 'writer';
}

const KINDS = new Set(['user', 'group', 'domain', 'anyone']);

const permissions = (fileId: string) => `${FILES}/${encodeURIComponent(fileId)}/permissions`;

/**
 * Everyone a file is shared with, however they got it (here or in Drive): people and groups by
 * address, a whole domain, anyone with the link; reading, commenting or editing. Not the owner.
 */
export async function listShares(token: string, fileId: string): Promise<Share[]> {
  const url = `${permissions(fileId)}?${new URLSearchParams({ fields: 'permissions(id,type,role,emailAddress,domain,displayName)' })}`;
  const body = await json<{ permissions?: unknown }>(await call(token, url));
  if (!Array.isArray(body.permissions)) throw new DriveError(502, 'a list of permissions that is not a list');
  type Raw = { id?: unknown; type?: unknown; role?: unknown; emailAddress?: unknown; domain?: unknown; displayName?: unknown };
  return (body.permissions as Raw[])
    .filter((p) => typeof p.id === 'string' && typeof p.type === 'string' && KINDS.has(p.type) && p.role !== 'owner')
    .filter((p) => (p.type === 'user' || p.type === 'group' ? typeof p.emailAddress === 'string' : true))
    .map((p) => ({
      id: p.id as string,
      kind: p.type as Share['kind'],
      role: p.role === 'reader' || p.role === 'commenter' ? p.role : 'writer',
      ...(typeof p.emailAddress === 'string' && { email: p.emailAddress }),
      ...(typeof p.domain === 'string' && { domain: p.domain }),
      ...(typeof p.displayName === 'string' && { name: p.displayName }),
    }));
}

/**
 * Lets `email` read the file (never change it). Google tells them by email. `drive.file` allows
 * this on files the app created, so no broader permission is needed.
 */
export async function shareFile(token: string, fileId: string, email: string): Promise<void> {
  await call(token, `${permissions(fileId)}?${new URLSearchParams({ sendNotificationEmail: 'true', fields: 'id' })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'reader', emailAddress: email }),
  });
}

/** Takes one access away; one that is already gone (404) counts as done. */
export async function unshareFile(token: string, fileId: string, shareId: string): Promise<void> {
  try {
    await call(token, `${permissions(fileId)}/${encodeURIComponent(shareId)}`, { method: 'DELETE' });
  } catch (e) {
    if (!(e instanceof DriveError && e.status === 404)) throw e;
  }
}
