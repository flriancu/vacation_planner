import { useState } from 'react';
import { summarize, type BackupSummary } from '../domain/backup';
import { blocksForCalendar, eventUid, toIcs, type IcsEvent } from '../domain/ics';
import type { BlockStatus, PlanDoc } from '../domain/schema';
import { useI18n } from '../i18n';
import { Dialog } from './Dialog';
import { saveFile } from './download';

const STATUSES: BlockStatus[] = ['idea', 'planned', 'approved'];

/** The .ics file, stamped with the moment of the download. */
function saveCalendar(fileName: string, events: IcsEvent[], calendarName: string) {
  saveFile(fileName, toIcs(events, calendarName, new Date()), 'text/calendar');
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
  const { t, name, plural } = useI18n();
  const [chosenYear, setYear] = useState(year);
  const [statuses, setStatuses] = useState<BlockStatus[]>(['planned', 'approved']);
  const blocks = blocksForCalendar(doc, personId, chosenYear, statuses);

  const download = () => {
    const events = blocks.map((b) => ({
      uid: eventUid(b),
      start: b.start,
      end: b.end,
      // The leave type, and the status while it isn't settled: "Concediu de odihnă (planificat)".
      summary: `${name(doc.leaveTypes[b.typeId]!.name)}${b.status === 'approved' ? '' : ` (${t(`status.${b.status}`).toLocaleLowerCase()})`}`,
      ...(b.note && { description: b.note }),
      confirmed: b.status === 'approved',
      updatedAt: b.updatedAt,
    }));
    saveCalendar(`concedii-${chosenYear}.ics`, events, t('ics.calendarName', { year: chosenYear }));
  };

  const years = [year - 1, year, year + 1];
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

/** What a picked copy holds, before it is added to my plan (IO-4). */
export function ImportDialog({
  copy,
  fileName,
  onAdd,
  onClose,
}: {
  copy: PlanDoc;
  fileName: string;
  onAdd: () => void;
  onClose: () => void;
}) {
  const { t, plural } = useI18n();
  const s: BackupSummary = summarize(copy);
  const parts = (['approved', 'planned', 'idea'] as const)
    .filter((st) => s.byStatus[st] > 0)
    .map((st) => `${t(`status.${st}`).toLocaleLowerCase()}: ${s.byStatus[st]}`)
    .join(', ');
  return (
    <Dialog title={t('import.title')} onClose={onClose}>
      <p className="dialog-help">
        <strong>{fileName}</strong>
      </p>
      {s.blocks ? (
        <p>{t('import.summary', { count: plural('leaves', s.blocks), years: s.years.join(', '), parts })}</p>
      ) : (
        <p>{t('import.empty')}</p>
      )}
      <p className="dialog-help">{t('import.explain')}</p>
      <div className="actions">
        <span className="spacer" />
        <button type="button" onClick={onClose}>
          {t('editor.cancel')}
        </button>
        <button type="button" className="primary" onClick={onAdd}>
          {t('import.add')}
        </button>
      </div>
    </Dialog>
  );
}
