import { AuthExpiredError } from './auth';

/** Drive REST v3 calls for the plan file (DESIGN §4.2). Every call takes a fresh access token. */
const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
export const PLAN_FILE_NAME = 'vacation-planner.json';
/** Marks files this app created, so it finds them again (`drive.file` sees only those). */
export const APP_PROPERTY = { key: 'app', value: 'vacation_planner' };

export class DriveError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`Google Drive answered ${status}: ${body.slice(0, 200)}`);
  }
}

export interface DriveFile {
  id: string;
  version: string;
}

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  if (response.status === 401) throw new AuthExpiredError();
  if (!response.ok) throw new DriveError(response.status, await response.text());
  return response;
}

/** My plan files, newest first. Normally there is exactly one. */
export async function findPlanFiles(token: string): Promise<DriveFile[]> {
  const q = `appProperties has { key='${APP_PROPERTY.key}' and value='${APP_PROPERTY.value}' } and 'me' in owners and trashed=false`;
  const url = `${FILES}?${new URLSearchParams({ q, spaces: 'drive', orderBy: 'modifiedTime desc', fields: 'files(id,version)' })}`;
  const body = (await (await call(token, url)).json()) as { files?: DriveFile[] };
  return body.files ?? [];
}

export async function getVersion(token: string, id: string): Promise<string> {
  const body = (await (await call(token, `${FILES}/${encodeURIComponent(id)}?fields=version`)).json()) as { version: string };
  return body.version;
}

/** Version first, then content: if the file changes in between, the next save sees a conflict and merges. */
export async function readPlanFile(token: string, id: string): Promise<{ raw: unknown; version: string }> {
  const version = await getVersion(token, id);
  const raw: unknown = await (await call(token, `${FILES}/${encodeURIComponent(id)}?alt=media`)).json();
  return { raw, version };
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
  return (await response.json()) as DriveFile;
}

/** Replaces the content; returns the new version. */
export async function writePlanFile(token: string, id: string, content: unknown): Promise<string> {
  const response = await call(token, `${UPLOAD}/${encodeURIComponent(id)}?uploadType=media&fields=version`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(content),
  });
  return ((await response.json()) as { version: string }).version;
}
