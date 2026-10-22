/**
 * Google's file picker (PPL-3). With `drive.file` the app may read another person's plan file
 * only after I pick it here once; from then on it can read it like its own.
 */
const API_SRC = 'https://apis.google.com/js/api.js';

/** The small part of the Picker API (apis.google.com/js/api.js → gapi.load('picker')) the app uses. */
interface PickerApi {
  DocsView: new (viewId: string) => DocsView;
  PickerBuilder: new () => PickerBuilder;
  ViewId: { DOCS: string };
  Action: { PICKED: string; CANCEL: string };
}
interface DocsView {
  setOwnedByMe(ownedByMe: boolean): DocsView;
  setMimeTypes(types: string): DocsView;
  setQuery(query: string): DocsView;
  setIncludeFolders(include: boolean): DocsView;
}
interface PickerBuilder {
  addView(view: DocsView): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setLocale(locale: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(callback: (result: { action: string; docs?: { id: string; name?: string }[] }) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}
type WithPicker = Window & {
  gapi?: { load(name: string, options: { callback: () => void; onerror: () => void }): void };
  google?: { picker?: PickerApi };
};

/** Google's picker didn't load (offline, blocked by an extension, Google down). */
export class PickerLoadError extends Error {}

let loading: Promise<PickerApi> | null = null;
/** A picker script that loads but never calls back counts as a failure after this long. */
const LOAD_TIMEOUT_MS = 30_000;

function loadPicker(): Promise<PickerApi> {
  const w = window as WithPicker;
  if (w.google?.picker) return Promise.resolve(w.google.picker);
  loading ??= new Promise<PickerApi>((resolve, reject) => {
    const timer = setTimeout(() => fail(), LOAD_TIMEOUT_MS);
    const fail = () => {
      clearTimeout(timer);
      loading = null;
      reject(new PickerLoadError('Could not load the Google file picker'));
    };
    const done = () => {
      clearTimeout(timer);
      if (w.google?.picker) resolve(w.google.picker);
      else fail();
    };
    const script = document.createElement('script');
    script.src = API_SRC;
    script.async = true;
    script.addEventListener(
      'load',
      // gapi.load returns nothing and calls back later: only a missing gapi is a failure here.
      () => (w.gapi ? w.gapi.load('picker', { callback: done, onerror: fail }) : fail()),
      { once: true },
    );
    script.addEventListener('error', fail, { once: true });
    document.head.append(script);
  });
  return loading;
}

export interface PickerOptions {
  token: string;
  apiKey: string;
  appId: string;
  /** "ro" or "en": the picker's own language. */
  locale: string;
  title: string;
}

/**
 * Shows Google's picker on files shared with me, narrowed to plan files. Resolves with the
 * picked file, or null when the picker was closed without one.
 */
export async function pickSharedPlan({ token, apiKey, appId, locale, title }: PickerOptions): Promise<{ id: string; name: string } | null> {
  const picker = await loadPicker();
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS)
      .setOwnedByMe(false)
      .setIncludeFolders(false)
      .setMimeTypes('application/json')
      .setQuery('vacation-planner');
    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setLocale(locale)
      .setTitle(title)
      .setCallback((result) => {
        if (result.action === picker.Action.PICKED && result.docs?.[0]) resolve({ id: result.docs[0].id, name: result.docs[0].name ?? '' });
        else if (result.action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}
