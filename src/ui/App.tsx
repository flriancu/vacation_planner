import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { yearOf, type ISODate } from '../domain/dates';
import { deleteRecord, restoreRecord, updateRecord } from '../domain/edit';
import { addRecord, live, newPlanDoc, STATUS_RANK, type PlanDoc, type RecordContext } from '../domain/schema';
import { I18nProvider, useI18n, type Lang } from '../i18n';
import type { Storage } from '../storage/Storage';
import type { Account } from './account';
import { BlockEditor, type Draft, type EditorTarget } from './BlockEditor';
import { Calendar } from './Calendar';
import { DemoStrip } from './DemoStrip';
import { Header } from './Header';
import { SidePane } from './SidePane';
import { useTheme } from './theme';
import { Tooltips } from './Tooltips';
import { UndoToast, type UndoOffer } from './UndoToast';
import { useHideOnScroll, useWidthClass } from './useLayout';
import { useDocument, type SaveState } from './useDocument';
import './app.css';

const LANG_KEY = 'vacation-planner.lang';

function recordContext(): RecordContext {
  return { now: new Date().toISOString(), newId: () => crypto.randomUUID() };
}

/** Today in the viewer's time zone, as a whole day. */
export function localToday(): ISODate {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function storedLang(): Lang | null {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === 'ro' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

export function App({ storage, account }: { storage: Storage; account: Account }) {
  const [lang, setLangState] = useState<Lang>(() => storedLang() ?? 'ro');
  const { doc, saveState, loadError, update, flush } = useDocument(storage, () => {
    const owner =
      account.kind === 'google' ? { googleSub: account.sub, personName: account.name } : { googleSub: 'demo', personName: 'Me' };
    return newPlanDoc(owner, recordContext()).doc;
  });

  // The document remembers the language too (I18N-1); local storage only makes the first paint right.
  useEffect(() => {
    if (doc && !storedLang()) setLangState(doc.settings.lang);
    // only when the document first arrives
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [doc === null]);

  const setLang = useCallback(
    (next: Lang) => {
      setLangState(next);
      try {
        localStorage.setItem(LANG_KEY, next);
      } catch {
        // private mode: the choice still lives in the document
      }
      update((d) => ({ ...d, settings: { ...d.settings, lang: next, updatedAt: new Date().toISOString() } }));
    },
    [update],
  );

  return (
    <I18nProvider lang={lang} setLang={setLang}>
      {loadError ? (
        <LoadError error={loadError} account={account} />
      ) : doc ? (
        <Planner doc={doc} update={update} saveState={saveState} flush={flush} account={account} />
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

function LoadError({ error, account }: { error: unknown; account: Account }) {
  const { t } = useI18n();
  return (
    <div className="load-state" role="alert">
      <p>{t('save.loadError')}</p>
      <p className="detail">{error instanceof Error ? error.message : String(error)}</p>
      {account.kind === 'google' && (
        <button type="button" onClick={account.signOut}>
          {t('auth.signOut')}
        </button>
      )}
    </div>
  );
}

interface PlannerProps {
  doc: PlanDoc;
  update: (change: (doc: PlanDoc) => PlanDoc) => void;
  saveState: SaveState;
  flush: () => Promise<void>;
  account: Account;
}

function Planner({ doc, update, saveState, flush, account }: PlannerProps) {
  const { t, lang } = useI18n();
  const { scheme, setScheme, mode, setMode } = useTheme();
  const [today] = useState(localToday);
  const [year, setYear] = useState(() => yearOf(today));
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const personId = live(doc.people)[0]!.id;

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t('app.title');
  }, [lang, t]);

  const openDay = (date: ISODate) => {
    const top = live(doc.blocks)
      .filter((b) => b.personId === personId && b.start <= date && date <= b.end)
      .sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || a.createdAt.localeCompare(b.createdAt))[0];
    if (top) setEditor({ mode: 'edit', blockId: top.id });
  };

  const save = (draft: Draft) => {
    const target = editor;
    setEditor(null);
    if (!target) return;
    const fields = { typeId: draft.typeId, status: draft.status, start: draft.start, end: draft.end };
    if (target.mode === 'new') {
      update(
        (d) =>
          addRecord(
            d,
            'blocks',
            { personId, ...fields, ...(draft.note && { note: draft.note }), ...(draft.swapFor && { swapFor: draft.swapFor }) },
            recordContext(),
          ).doc,
      );
    } else {
      update((d) =>
        updateRecord(
          d,
          'blocks',
          target.blockId,
          { ...fields, note: draft.note || undefined, swapFor: draft.swapFor },
          new Date().toISOString(),
        ),
      );
    }
  };

  const [undo, setUndo] = useState<UndoOffer | null>(null);
  const clearUndo = useCallback(() => setUndo(null), []);
  const remove = (blockId: string) => {
    setEditor(null);
    update((d) => deleteRecord(d, 'blocks', blockId, new Date().toISOString()));
    setUndo({
      id: Date.now(),
      message: t('undo.deleted'),
      undo: () => update((d) => restoreRecord(d, 'blocks', blockId, new Date().toISOString())),
    });
  };

  const { ref: headerRef, hidden, height, hold } = useHideOnScroll<HTMLElement>();
  const width = useWidthClass();

  // "Today": jump to this year and scroll to today's week; also once on first load, like calendar apps do.
  const [todayTick, setTodayTick] = useState(1);
  const goToday = () => {
    setYear(yearOf(today));
    setTodayTick((n) => n + 1);
  };
  useEffect(() => {
    if (!todayTick || year !== yearOf(today)) return;
    const smooth = todayTick > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    hold(1500); // our own scroll: keep the header shown
    const frame = requestAnimationFrame(() =>
      document.querySelector(`[data-date="${today}"]`)?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [todayTick, year, today, hold]);

  return (
    <div className="app" style={{ '--header-offset': `${hidden ? 0 : height}px` } as CSSProperties}>
      <Header
        ref={headerRef}
        year={year}
        setYear={setYear}
        onToday={goToday}
        account={account}
        saveState={saveState}
        flush={flush}
        theme={{ scheme, setScheme, mode, setMode }}
        width={width}
        hidden={hidden}
      />
      {account.kind === 'demo' && <DemoStrip account={account} />}

      <main className="layout">
        {width !== 'expanded' && <SidePane width={width} />}
        <Calendar
          key={year}
          year={year}
          doc={doc}
          personId={personId}
          today={today}
          onCreate={(start, end) => setEditor({ mode: 'new', start, end })}
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
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
