import { useCallback, useEffect, useState } from 'react';
import { yearOf, type ISODate } from '../domain/dates';
import { deleteRecord, updateRecord } from '../domain/edit';
import { addRecord, live, newPlanDoc, STATUS_RANK, type PlanDoc, type RecordContext } from '../domain/schema';
import { I18nProvider, useI18n, type Lang } from '../i18n';
import type { Storage } from '../storage/Storage';
import { BlockEditor, type Draft, type EditorTarget } from './BlockEditor';
import { Calendar } from './Calendar';
import { Legend } from './Legend';
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

export function App({ storage }: { storage: Storage }) {
  const [lang, setLangState] = useState<Lang>(() => storedLang() ?? 'ro');
  const { doc, saveState, loadError, update } = useDocument(
    storage,
    () => newPlanDoc({ googleSub: 'local', personName: 'Me' }, recordContext()).doc,
  );

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
        <p className="load-state">{String(loadError)}</p>
      ) : doc ? (
        <Planner doc={doc} update={update} saveState={saveState} demo={storage.kind === 'memory'} />
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

interface PlannerProps {
  doc: PlanDoc;
  update: (change: (doc: PlanDoc) => PlanDoc) => void;
  saveState: SaveState;
  demo: boolean;
}

function Planner({ doc, update, saveState, demo }: PlannerProps) {
  const { t, lang, setLang } = useI18n();
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

  const remove = (blockId: string) => {
    setEditor(null);
    update((d) => deleteRecord(d, 'blocks', blockId, new Date().toISOString()));
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>{t('app.title')}</h1>
        <nav className="year-nav" aria-label={t('year.label')}>
          <button type="button" onClick={() => setYear((y) => y - 1)} aria-label={t('year.prev')}>
            ‹
          </button>
          <span className="year" aria-live="polite">
            {year}
          </span>
          <button type="button" onClick={() => setYear((y) => y + 1)} aria-label={t('year.next')}>
            ›
          </button>
        </nav>
        <output className={`save-state save-${demo ? 'demo' : saveState}`}>{demo ? t('app.demo') : t(`save.${saveState}`)}</output>
        <button type="button" className="lang" onClick={() => setLang(lang === 'ro' ? 'en' : 'ro')} aria-label={t('lang.otherLabel')}>
          {t('lang.other')}
        </button>
      </header>

      <main>
        <Legend doc={doc} />
        <Calendar
          key={year}
          year={year}
          doc={doc}
          personId={personId}
          today={today}
          onCreate={(start, end) => setEditor({ mode: 'new', start, end })}
          onOpen={openDay}
        />
      </main>

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
