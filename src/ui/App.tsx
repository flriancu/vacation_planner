import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { nextStamp } from '../domain/clock';
import { yearOf, type ISODate } from '../domain/dates';
import { deleteRecord, restoreRecord, updateRecord } from '../domain/edit';
import { FIRST_YEAR, LAST_YEAR } from '../domain/holidays';
import { addRecord, live, newPlanDoc, STATUS_RANK, type Block, type PlanDoc, type RecordContext } from '../domain/schema';
import { AuthExpiredError } from '../google/auth';
import { PlanFileGoneError } from '../google/drive';
import { I18nProvider, useI18n, type Lang } from '../i18n';
import type { Storage } from '../storage/Storage';
import { PlanMissingError, PlanRemovedError, type DocumentSync } from '../sync/DocumentSync';
import type { ReplicaStore } from '../sync/Replica';
import type { Account } from './account';
import { BlockEditor, type Draft, type EditorTarget } from './BlockEditor';
import { Calendar } from './Calendar';
import { viewRange } from './calendarModel';
import { DemoStrip } from './DemoStrip';
import { errorDetail, errorMessage } from './errors';
import { Header } from './Header';
import { Notice } from './Notice';
import { SidePane } from './SidePane';
import { useTheme } from './theme';
import { Tooltips } from './Tooltips';
import { UndoToast, type UndoOffer } from './UndoToast';
import { useHideOnScroll, useWidthClass } from './useLayout';
import { useDocument, type SaveState, type SyncNotice } from './useDocument';
import { useToday } from './useToday';
import './app.css';

const LANG_KEY = 'vacation-planner.lang';

/** Record ids: random UUIDs. `randomUUID` exists only on secure origins (https, localhost), so not on a LAN address. */
function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function recordContext(doc: PlanDoc): RecordContext {
  return { now: nextStamp(doc), newId };
}

function storedLang(): Lang | null {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === 'ro' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

/** Remembered for the next first paint and for the privacy and terms pages (public/legal.js). */
function rememberLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // private mode: the choice still lives in the document
  }
}

interface AppProps {
  storage: Storage;
  account: Account;
  /** Signed in: this device's copy of the plan (sync/Replica.ts). */
  replica?: ReplicaStore;
  /** Signed in: the demo plan made just before, to add to mine once. */
  carry?: () => PlanDoc | null;
}

export function App({ storage, account, replica, carry }: AppProps) {
  const [lang, setLangState] = useState<Lang>(() => storedLang() ?? 'ro');
  const { doc, saveState, saveError, loadError, notices, sync } = useDocument({
    storage,
    init: () => {
      const owner =
        account.kind === 'google' ? { googleSub: account.sub, personName: account.name } : { googleSub: 'demo', personName: 'Me' };
      return newPlanDoc(owner, { now: new Date().toISOString(), newId }).doc;
    },
    ...(account.kind === 'google' && { owner: account.sub }),
    ...(replica && { replica }),
    ...(carry && { carry }),
  });

  // The document remembers the language too (I18N-1); local storage only makes the first paint right.
  useEffect(() => {
    if (doc && !storedLang()) {
      setLangState(doc.settings.lang);
      rememberLang(doc.settings.lang);
    }
    // only when the document first arrives
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [doc === null]);

  // Another tab changed the language: follow it (the choice is shared, I18N-1).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LANG_KEY && (e.newValue === 'ro' || e.newValue === 'en')) setLangState(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setLang = useCallback(
    (next: Lang) => {
      setLangState(next);
      rememberLang(next);
      sync.update((d) => ({ ...d, settings: { ...d.settings, lang: next, updatedAt: nextStamp(d) } }));
    },
    [sync],
  );

  // Signing out saves first; whatever didn't reach Drive stays on this device for the next sign-in.
  const shown: Account =
    account.kind === 'google' ? { ...account, signOut: () => void sync.close().then((clean) => account.signOut(!clean)) } : account;

  return (
    <I18nProvider lang={lang} setLang={setLang}>
      {loadError ? (
        <LoadError error={loadError} account={shown} sync={sync} />
      ) : doc ? (
        <Planner doc={doc} sync={sync} saveState={saveState} saveError={saveError} notices={notices} account={shown} />
      ) : (
        <LoadingState />
      )}
    </I18nProvider>
  );
}

function LoadingState() {
  const { t } = useI18n();
  return <p className="load-state">{t('save.loading')}</p>;
}

/** Why the plan couldn't be opened, in words, and what can be done about it: always a way on. */
function LoadError({ error, account, sync }: { error: unknown; account: Account; sync: DocumentSync }) {
  const { t } = useI18n();
  const [reason, setReason] = useState<string | null>(null);
  const reconnect = async () => {
    if (account.kind !== 'google') return;
    const failed = await account.reconnect();
    setReason(failed);
    if (!failed) void sync.open();
  };
  return (
    <div className="load-state" role="alert">
      <p>{t('save.loadError')}</p>
      <p>{t(errorMessage(error))}</p>
      {reason && (
        <p className="auth-error">
          {t(reason === 'other_account' ? 'auth.errOtherAccount' : 'auth.reconnectFailed', {
            email: account.kind === 'google' ? account.email : '',
          })}
        </p>
      )}
      <div className="load-actions">
        {error instanceof AuthExpiredError ? (
          <button type="button" className="primary" onClick={() => void reconnect()}>
            {t('auth.reconnectShort')}
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => void sync.open()}>
            {t('load.retry')}
          </button>
        )}
        {error instanceof PlanMissingError && (
          <button type="button" onClick={() => void sync.open('restore')}>
            {t('load.restore')}
          </button>
        )}
        {(error instanceof PlanRemovedError ||
          error instanceof PlanMissingError ||
          (error instanceof PlanFileGoneError && error.reason === 'trashed')) && (
          <button type="button" onClick={() => void sync.open('new')}>
            {t('load.startNew')}
          </button>
        )}
        {account.kind === 'google' && (
          <button type="button" onClick={() => account.signOut()}>
            {t('auth.signOut')}
          </button>
        )}
      </div>
      <details className="detail">
        <summary>{t('load.details')}</summary>
        {errorDetail(error)}
      </details>
    </div>
  );
}

interface PlannerProps {
  doc: PlanDoc;
  sync: DocumentSync;
  saveState: SaveState;
  saveError: unknown;
  notices: readonly SyncNotice[];
  account: Account;
}

const clampYear = (y: number) => Math.min(LAST_YEAR, Math.max(FIRST_YEAR, y));

function Planner({ doc, sync, saveState, saveError, notices, account }: PlannerProps) {
  const { t, lang, plural } = useI18n();
  const { scheme, setScheme, mode, setMode } = useTheme();
  const today = useToday();
  const [year, setYearState] = useState(() => clampYear(yearOf(today)));
  const setYear = useCallback((update: (y: number) => number) => setYearState((y) => clampYear(update(y))), []);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  /** The day to give focus back to when the editor closes (WCAG 2.4.3). */
  const returnTo = useRef<ISODate | null>(null);
  const personId = live(doc.people)[0]!.id;
  const { update } = sync;

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t('app.title');
  }, [lang, t]);

  const openEditor = (target: EditorTarget, from: ISODate) => {
    returnTo.current = from;
    setEditor(target);
  };

  const closeEditor = () => {
    setEditor(null);
    focusReturn();
  };

  /** Focus to the day in `returnTo` once it's drawn, or to the calendar. */
  const focusReturn = () => {
    const date = returnTo.current;
    requestAnimationFrame(() => {
      const cell = date ? document.querySelector<HTMLElement>(`[data-date="${date}"]`) : null;
      (cell ?? document.querySelector<HTMLElement>('main'))?.focus({ preventScroll: true });
    });
  };

  const openDay = (date: ISODate) => {
    const top = live(doc.blocks)
      .filter((b) => b.personId === personId && b.start <= date && date <= b.end)
      .sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || a.createdAt.localeCompare(b.createdAt))[0];
    if (top) openEditor({ mode: 'edit', blockId: top.id }, date);
  };

  const save = (draft: Draft) => {
    const target = editor;
    if (!target) return closeEditor();
    const fields = { typeId: draft.typeId, status: draft.status, start: draft.start, end: draft.end };
    if (target.mode === 'new') {
      update(
        (d) =>
          addRecord(
            d,
            'blocks',
            { personId, ...fields, ...(draft.note && { note: draft.note }), ...(draft.swapFor && { swapFor: draft.swapFor }) },
            recordContext(d),
          ).doc,
      );
    } else {
      update((d) =>
        updateRecord(d, 'blocks', target.blockId, { ...fields, note: draft.note || undefined, swapFor: draft.swapFor }, nextStamp(d)),
      );
    }
    // Moved out of this view (to another year): follow it there, so it doesn't seem to vanish.
    const view = viewRange(year);
    if (draft.end < view.from || draft.start > view.to) {
      setYear(() => yearOf(draft.start));
      returnTo.current = draft.start;
    }
    closeEditor();
  };

  // Deletes made while the message shows are undone together: a second delete doesn't lose the first one's undo.
  const [undo, setUndo] = useState<UndoOffer | null>(null);
  const deleted = useRef<Block[]>([]);
  const clearUndo = useCallback(() => {
    deleted.current = [];
    setUndo(null);
  }, []);
  const remove = (blockId: string) => {
    const before = doc.blocks[blockId];
    closeEditor();
    if (!before) return;
    update((d) => deleteRecord(d, 'blocks', blockId, nextStamp(d)));
    deleted.current = [...deleted.current, before];
    const batch = deleted.current;
    setUndo({
      id: Date.now(),
      message: batch.length === 1 ? { key: 'undo.deleted' } : { key: 'undo.deletedMany', count: batch.length },
      undo: () => {
        update((d) => batch.reduce((acc, b) => restoreRecord(acc, 'blocks', b.id, nextStamp(acc), b), d));
        // The message with the button goes: focus moves to what came back (WCAG 2.4.3).
        returnTo.current = batch.at(-1)!.start;
        focusReturn();
      },
    });
  };

  const { ref: headerRef, hidden, height, hold } = useHideOnScroll<HTMLElement>();
  const width = useWidthClass();

  // The page opens on today's week, like calendar apps do, and "Today" goes back there; going
  // back to this year by the arrows doesn't jump to today.
  const [todayTick, setTodayTick] = useState(1);
  const scrolledTick = useRef(0);
  const goToday = () => {
    setYear(() => yearOf(today));
    setTodayTick((n) => n + 1);
  };
  useEffect(() => {
    if (scrolledTick.current === todayTick || year !== yearOf(today)) return;
    scrolledTick.current = todayTick;
    const smooth = todayTick > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    hold(1500); // our own scroll: keep the header shown
    const frame = requestAnimationFrame(() =>
      document.querySelector(`[data-date="${today}"]`)?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [todayTick, year, today, hold]);

  // The sticky header covers the top of the page: keyboard focus scrolled into view must land below it (WCAG 2.4.11).
  useEffect(() => {
    document.documentElement.style.scrollPaddingTop = `${(hidden ? 0 : height) + 40}px`;
  }, [hidden, height]);

  const noticeText = (n: SyncNotice) =>
    n.kind === 'carried'
      ? t('notice.carried', { count: plural('leaves', n.count) })
      : t(n.kind === 'floating' ? 'notice.floating' : 'notice.skipped', { count: n.count });

  return (
    <div className="app" style={{ '--header-offset': `${hidden ? 0 : height}px` } as CSSProperties}>
      <Header
        ref={headerRef}
        year={year}
        setYear={setYear}
        minYear={FIRST_YEAR}
        maxYear={LAST_YEAR}
        onToday={goToday}
        account={account}
        saveState={saveState}
        saveError={saveError}
        flush={sync.flush}
        theme={{ scheme, setScheme, mode, setMode }}
        width={width}
        hidden={hidden}
      />
      {account.kind === 'demo' && <DemoStrip account={account} />}
      {notices.map((n) => (
        <Notice key={n.kind} scope="page" onClose={() => sync.dismissNotice(n.kind)} closeLabel={t('strip.close')}>
          <p>{noticeText(n)}</p>
        </Notice>
      ))}

      <main className="layout" tabIndex={-1}>
        {width !== 'expanded' && <SidePane width={width} />}
        <Calendar
          key={year}
          year={year}
          doc={doc}
          personId={personId}
          today={today}
          onCreate={(start, end) => openEditor({ mode: 'new', start, end }, start)}
          onOpen={openDay}
        />
        {width === 'expanded' && <SidePane width={width} />}
      </main>

      <footer className="app-footer">
        <a href="privacy.html">{t('app.privacy')}</a>
        <a href="terms.html">{t('app.terms')}</a>
        <a href="https://github.com/flriancu/vacation_planner">{t('app.source')}</a>
      </footer>

      <UndoToast offer={undo} onDone={clearUndo} />
      <Tooltips />

      {editor && (
        <BlockEditor
          key={editor.mode === 'edit' ? editor.blockId : `${editor.start}|${editor.end}`}
          target={editor}
          doc={doc}
          personId={personId}
          onSave={save}
          onDelete={remove}
          onSwitch={(blockId) => setEditor({ mode: 'edit', blockId })}
          onClose={closeEditor}
        />
      )}
    </div>
  );
}
