import { useState } from 'react';
import type { CopyPlan } from '../domain/backup';
import { FIRST_YEAR, LAST_YEAR } from '../domain/holidays';
import { blocksForCalendar, eventUid, toIcs, type IcsEvent } from '../domain/ics';
import type { BlockStatus, PlanDoc } from '../domain/schema';
import { displayName } from '../domain/text';
import { useI18n } from '../i18n';
import { Dialog } from './Dialog';
import { saveFile } from './download';

const STATUSES: BlockStatus[] = ['idea', 'planned', 'approved'];

/** The .ics file, stamped with the moment of the download. */
function saveCalendar(fileName: string, events: IcsEvent[], calendarName: string, lang: 'ro' | 'en') {
  saveFile(fileName, toIcs(events, calendarName, new Date(), lang), 'text/calendar');
}

/** Export one year to an .ics file (IO-2): planned and approved by default. */
export function CalendarExportDialog({
  doc,
  personId,
  year,
  onClose,
}: {
  doc: PlanDoc;
  personId: string;
  year: number;
  onClose: () => void;
}) {
  const { t, name, plural, lang } = useI18n();
  const [chosenYear, setYear] = useState(year);
  const [statuses, setStatuses] = useState<BlockStatus[]>(['planned', 'approved']);
  // Notes stay out unless asked for: a calendar is often shared at work, and notes can be private.
  const [withNotes, setWithNotes] = useState(false);
  const blocks = blocksForCalendar(doc, personId, chosenYear, statuses);

  const download = () => {
    const events = blocks.map((b) => ({
      uid: eventUid(b),
      start: b.start,
      end: b.end,
      // The leave type, and the status while it isn't settled: "Concediu de odihnă (planificat)".
      summary: `${doc.leaveTypes[b.typeId] ? name(doc.leaveTypes[b.typeId]!.name) : t('type.unknown')}${b.status === 'approved' ? '' : ` (${t(`status.${b.status}`).toLocaleLowerCase(lang)})`}`,
      ...(withNotes && b.note && { description: b.note }),
      confirmed: b.status === 'approved',
      busy: b.status !== 'idea',
      updatedAt: b.updatedAt,
    }));
    saveCalendar(t('file.calendar', { year: chosenYear }), events, t('ics.calendarName', { year: chosenYear }), lang);
  };

  const years = [year - 1, year, year + 1].filter((y) => y >= FIRST_YEAR && y <= LAST_YEAR);
  return (
    <Dialog title={t('ics.title')} onClose={onClose}>
      <p className="dialog-help">{t('ics.help')}</p>
      <label>
        {t('ics.year')}
        <select value={chosenYear} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="statuses">
        <legend>{t('ics.statuses')}</legend>
        {STATUSES.map((s) => (
          <label key={s} className={`status-option st-${s}`}>
            <input
              type="checkbox"
              checked={statuses.includes(s)}
              onChange={(e) => setStatuses((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))}
            />
            {t(`status.${s}`)}
          </label>
        ))}
      </fieldset>
      <label className="checkbox">
        <input type="checkbox" checked={withNotes} onChange={(e) => setWithNotes(e.target.checked)} />
        {t('ics.notes')}
      </label>
      <p className="summary" aria-live="polite">
        {blocks.length ? t('ics.count', { count: plural('leaves', blocks.length) }) : t('ics.none')}
      </p>
      <div className="actions">
        <span className="spacer" />
        <button type="button" onClick={onClose}>
          {t('editor.cancel')}
        </button>
        <button type="button" className="primary" disabled={blocks.length === 0} onClick={download}>
          {t('ics.download')}
        </button>
      </div>
    </Dialog>
  );
}

/**
 * What adding a picked copy will do, before it is done (IO-4): the leave it adds, whose copy
 * it is, and what it leaves out and why. Adding does exactly this (domain/backup.ts planCopy).
 */
export function ImportDialog({
  plan,
  fileName,
  onAdd,
  onClose,
}: {
  plan: CopyPlan;
  fileName: string;
  onAdd: () => void;
  onClose: () => void;
}) {
  const { t, plural, lang, name } = useI18n();
  const parts = (['approved', 'planned', 'idea'] as const)
    .filter((st) => plan.byStatus[st] > 0)
    .map((st) => `${t(`status.${st}`).toLocaleLowerCase(lang)}: ${plan.byStatus[st]}`)
    .join(', ');
  const left = (
    [
      ['existing', 'import.leftExisting'],
      ['conflicts', 'import.leftConflicts'],
      ['other', 'import.leftOther'],
      ['unreadable', 'import.leftUnreadable'],
    ] as const
  )
    .filter(([k]) => plan.skipped[k] > 0)
    .map(([k, key]) => t(key, { count: plan.skipped[k] }))
    .join('; ');
  const from = plan.from && displayName(plan.from);
  return (
    <Dialog title={t('import.title')} onClose={onClose}>
      <p className="dialog-help file-name">
        <strong>{displayName(fileName, 120)}</strong>
      </p>
      {from && <p>{t('import.from', { name: from })}</p>}
      {plan.blocks.length ? (
        <p>{t('import.summary', { count: plural('leaves', plan.blocks.length), years: plan.years.join(', '), parts })}</p>
      ) : (
        <p>{t('import.nothing')}</p>
      )}
      {plan.types.length > 0 && <p>{t('import.types', { names: plan.types.map((x) => name(x.name)).join(', ') })}</p>}
      {plan.converted > 0 && <p>{t('import.converted', { count: plan.converted })}</p>}
      {left && <p className="dialog-help">{t('import.left', { list: left })}</p>}
      <p className="dialog-help">{t('import.explain')}</p>
      <div className="actions">
        <span className="spacer" />
        <button type="button" onClick={onClose}>
          {t('editor.cancel')}
        </button>
        <button type="button" className="primary" onClick={onAdd} disabled={plan.blocks.length === 0}>
          {t('import.add')}
        </button>
      </div>
    </Dialog>
  );
}
