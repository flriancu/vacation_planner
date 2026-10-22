import type { Page, Route } from '@playwright/test';

/**
 * Signed in, with Google Drive faked in the test process: never a request to Google (the
 * Playwright config also points Google's hosts nowhere, for anything a route would miss).
 */
export class FakeDrive {
  readonly files = new Map<string, { content: unknown; version: number; trashed?: boolean; owner?: string }>();
  /** Who each file is shared with (PPL-3). */
  readonly shares = new Map<string, { id: string; emailAddress: string }[]>();
  /** Writes that answer 503 before the next one succeeds. */
  failWrites = 0;
  /** File lists that answer 503 (a load that fails). */
  failLists = 0;
  writes = 0;
  private nextId = 1;

  constructor(seed?: unknown) {
    if (seed) this.files.set(`f${this.nextId++}`, { content: seed, version: 1 });
  }

  /** A plan someone else owns and shared with me: not in my own file list, readable by id. */
  addShared(content: unknown, owner = 'mihai'): string {
    const id = `shared-${this.nextId++}`;
    this.files.set(id, { content, version: 1, owner });
    return id;
  }

  async attach(page: Page) {
    // Google's picker (apis.google.com), faked: it "picks" whatever the test put in window.fakePick.
    await page.route('https://apis.google.com/js/api.js', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_PICKER }));
    // A signed-in tab: what google/auth.ts keeps in sessionStorage after a sign-in.
    await page.addInitScript(() => {
      const session = { user: { sub: 'u1', name: 'Ana Test', email: 'ana@example.test' }, expiresAt: 9e15 };
      sessionStorage.setItem('vacation-planner.session', JSON.stringify({ token: 'tok', session }));
    });
    await page.route('https://www.googleapis.com/**', (route) => this.answer(route));
  }

  content(): Record<string, unknown> {
    return [...this.files.values()].find((f) => !f.trashed && !f.owner)?.content as Record<string, unknown>;
  }

  private async answer(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

    const perm = /^\/drive\/v3\/files\/([^/]+)\/permissions(?:\/([^/]+))?$/.exec(url.pathname);
    if (perm) {
      const list = this.shares.get(perm[1]!) ?? [];
      this.shares.set(perm[1]!, list);
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData()!) as { emailAddress: string };
        const share = { id: `perm-${list.length + 1}`, emailAddress: body.emailAddress };
        list.push(share);
        return json({ id: share.id });
      }
      if (req.method() === 'DELETE') {
        this.shares.set(
          perm[1]!,
          list.filter((x) => x.id !== perm[2]),
        );
        return route.fulfill({ status: 200, headers: cors, body: '' });
      }
      return json({
        permissions: [
          { id: 'owner', type: 'user', role: 'owner', emailAddress: 'ana@example.test' },
          ...list.map((x) => ({ ...x, type: 'user', role: 'reader' })),
        ],
      });
    }
    const id = url.pathname.split('/').pop()!;
    if (url.pathname === '/drive/v3/files' && req.method() === 'GET') {
      if (this.failLists > 0) {
        this.failLists--;
        return json({ error: 'backend error' }, 503);
      }
      const trashed = url.searchParams.get('q')!.includes('trashed=true');
      const files = [...this.files]
        .filter(([, f]) => !!f.trashed === trashed && !f.owner) // 'me' in owners
        .map(([fid, f]) => ({ id: fid, version: String(f.version) }));
      return json({ files });
    }
    if (url.pathname.startsWith('/drive/v3/files/') && req.method() === 'GET') {
      const file = this.files.get(id);
      if (!file) return json({ error: 'not found' }, 404);
      return url.searchParams.get('alt') === 'media'
        ? json(file.content)
        : json({ version: String(file.version), trashed: !!file.trashed });
    }
    if (url.pathname === '/upload/drive/v3/files' && req.method() === 'POST') {
      const parts = req.postData()!.split(/--vp-[^\r\n]*/);
      const content: unknown = JSON.parse(parts[2]!.split('\r\n\r\n')[1]!.trim());
      const fid = `f${this.nextId++}`;
      this.files.set(fid, { content, version: 1 });
      return json({ id: fid, version: '1' });
    }
    if (url.pathname.startsWith('/upload/drive/v3/files/') && req.method() === 'PATCH') {
      this.writes++;
      if (this.failWrites > 0) {
        this.failWrites--;
        return json({ error: 'backend error' }, 503);
      }
      const file = this.files.get(id)!;
      file.content = JSON.parse(req.postData()!);
      file.version++;
      return json({ version: String(file.version) });
    }
    return json({ error: `unexpected ${req.method()} ${url.pathname}` }, 400);
  }
}

/** The parts of Google's picker the app uses; picks `window.fakePick` ({ id, name }) or cancels. */
const FAKE_PICKER = `
window.gapi = { load(name, o) {
  window.google = window.google || {};
  class View { setOwnedByMe() { return this } setMimeTypes() { return this } setQuery() { return this } setIncludeFolders() { return this } }
  class Builder {
    addView() { return this } setOAuthToken() { return this } setDeveloperKey() { return this } setAppId() { return this }
    setLocale() { return this } setTitle() { return this } setCallback(cb) { this.cb = cb; return this }
    build() { const cb = this.cb; return { setVisible() { setTimeout(() => cb(window.fakePick ? { action: 'picked', docs: [window.fakePick] } : { action: 'cancel' }), 0) } } }
  }
  window.google.picker = { ViewId: { DOCS: 'all' }, Action: { PICKED: 'picked', CANCEL: 'cancel' }, DocsView: View, PickerBuilder: Builder };
  o.callback();
} };
`;
