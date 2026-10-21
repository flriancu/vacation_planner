import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { blockStats } from '../domain/blocks';
import { blockBudget, buildDays, findOverlaps } from '../domain/calendar';
import { addDays, overlaps, yearOf, type ISODate } from '../domain/dates';
import { updateRecord } from '../domain/edit';
import { addRecord, live, STATUS_RANK, typeByKey, type Block, type BlockStatus, type PlanDoc } from '../domain/schema';
import { swapReminders } from '../domain/swaps';
import { useI18n } from '../i18n';
import { describeBlock } from './describe';
import './editor.css';

export type EditorTarget = { mode: 'new'; start: ISODate; end: ISODate } | { mode: 'edit'; blockId: string };

export interface Draft {
  typeId: string;
  status: BlockStatus;
  start: ISODate;
  end: ISODate;
  note: string;
  swapFor?: ISODate;
}

interface Props {
  target: EditorTarget;
  doc: PlanDoc;
  personId: string;
  onSave: (draft: Draft) => void;
  onDelete: (blockId: string) => void;
  onSwitch: (blockId: string) => void;
  onClose: () => void;
}

const DRAFT_ID = '__draft';
const STATUSES: BlockStatus[] = ['idea', 'planned', 'approved'];

function initialDraft(target: EditorTarget, doc: PlanDoc): Draft {
  if (target.mode === 'edit') {
    const b = doc.blocks[target.blockId]!;
    return { typeId: b.typeId, status: b.status, start: b.start, end: b.end, note: b.note ?? '', ...(b.swapFor && { swapFor: b.swapFor }) };
  }
  return { typeId: typeByKey(doc, 'annual')!.id, status: 'idea', start: target.start, end: target.end, note: '' };
}

/** Create or edit one block: type, status, dates, note (CAL-8, CAL-9, BLK-*). */
export function BlockEditor({ target, doc, personId, onSave, onDelete, onSwitch, onClose }: Props) {
  const i18n = useI18n();
  const { t, name, date: fmt } = i18n;
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(() => initialDraft(target, doc));
  const original: Block | undefined = target.mode === 'edit' ? doc.blocks[target.blockId] : undefined;

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  const types = live(doc.leaveTypes).filter((lt) => !lt.hidden || lt.id === draft.typeId);
  const type = doc.leaveTypes[draft.typeId]!;
  const valid = draft.start !== '' && draft.end !== '' && draft.start <= draft.end;

  // BLK-4: an existing block moves one stage at a time; types without approval stop at "planned".
  const allowed = STATUSES.filter(
    (s) => (type.needsApproval || s !== 'approved') && (!original || Math.abs(STATUS_RANK[s] - STATUS_RANK[original.status]) <= 1),
  );

  const preview = useMemo(() => {
    if (!valid) return null;
    const fields = { ...draft, note: draft.note || undefined, swapFor: type.key === 'swap' ? draft.swapFor : undefined };
    const withDraft =
      target.mode === 'edit'
        ? updateRecord(doc, 'blocks', target.blockId, fields, '')
        : addRecord(doc, 'blocks', { personId, ...fields }, { now: '', newId: () => DRAFT_ID }).doc;
    const id = target.mode === 'edit' ? target.blockId : DRAFT_ID;
    const days = buildDays(withDraft, personId, addDays(draft.start, -40), addDays(draft.end, 40));
    const block = withDraft.blocks[id]!;
    return {
      description: describeBlock(i18n, blockStats(days, block), blockBudget(withDraft, block, yearOf(block.start))),
      overlap: findOverlaps(withDraft, personId).some(([a, b]) => a.id === id || b.id === id),
    };
  }, [doc, personId, target, draft, type.key, valid, i18n]);

  const reminders = type.key === 'swap' && valid ? swapReminders(doc, personId, yearOf(draft.start)) : [];
  const alsoHere =
    original && valid
      ? live(doc.blocks).filter((b) => b.personId === personId && b.id !== original.id && overlaps(b.start, b.end, draft.start, draft.end))
      : [];

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const changeType = (typeId: string) => {
    const next = doc.leaveTypes[typeId]!;
    const status = !next.needsApproval && draft.status === 'approved' ? 'planned' : draft.status;
    const swapFor =
      next.key === 'swap'
        ? (draft.swapFor ?? swapReminders(doc, personId, yearOf(draft.start)).find((r) => r.options.includes(draft.start))?.holiday.date)
        : undefined;
    setDraft((d) => ({ ...d, typeId, status, ...(swapFor ? { swapFor } : { swapFor: undefined }) }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const datesChanged = original && (original.start !== draft.start || original.end !== draft.end);
    if (original?.status === 'approved' && datesChanged && !window.confirm(t('editor.confirmApprovedDates'))) return;
    onSave({ ...draft, ...(type.key !== 'swap' && { swapFor: undefined }) });
  };

  const remove = () => {
    if (original && window.confirm(t('editor.confirmDelete'))) onDelete(original.id);
  };

  return (
    <dialog ref={dialog} className="editor" aria-labelledby="editor-title" onClose={onClose}>
      <form onSubmit={submit}>
        <h2 id="editor-title">{t(target.mode === 'new' ? 'editor.new' : 'editor.edit')}</h2>

        <label>
          {t('editor.type')}
          <select value={draft.typeId} onChange={(e) => changeType(e.target.value)}>
            {types.map((lt) => (
              <option key={lt.id} value={lt.id}>
                {name(lt.name)}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="statuses">
          <legend>{t('editor.status')}</legend>
          {allowed.map((s) => (
            <label key={s} className={`status-option st-${s}`}>
              <input type="radio" name="status" value={s} checked={draft.status === s} onChange={() => set({ status: s })} />
              {t(`status.${s}`)}
            </label>
          ))}
        </fieldset>

        <div className="dates">
          <label>
            {t('editor.start')}
            <input type="date" required value={draft.start} onChange={(e) => set({ start: e.target.value })} />
          </label>
          <label>
            {t('editor.end')}
            <input type="date" required value={draft.end} onChange={(e) => set({ end: e.target.value })} />
          </label>
        </div>

        {type.key === 'swap' && (
          <label>
            {t('editor.swapFor')}
            <select value={draft.swapFor ?? ''} onChange={(e) => set({ swapFor: e.target.value || undefined })}>
              <option value="">{t('editor.swapNone')}</option>
              {reminders.map((r) => (
                <option key={r.holiday.date} value={r.holiday.date}>
                  {fmt(r.holiday.date, { weekday: 'short', day: 'numeric', month: 'long' })} — {r.holiday.names.map(name).join(' · ')}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          {t('editor.note')}
          <textarea rows={2} value={draft.note} onChange={(e) => set({ note: e.target.value })} />
        </label>

        <p className="summary" aria-live="polite">
          {!valid && <span className="error">{t('editor.errEnd')}</span>}
          {preview && (
            <span data-testid="editor-cost" className="describe">
              {preview.description.spend && <span className="spend">{preview.description.spend}</span>}
              <span>{preview.description.get}</span>
            </span>
          )}
          {preview?.overlap && draft.status !== 'idea' && <span className="warning">{t('editor.warnOverlap')}</span>}
        </p>

        {alsoHere.length > 0 && (
          <div className="also-here">
            {t('editor.alsoHere')}
            <ul>
              {alsoHere.map((b) => (
                <li key={b.id}>
                  <button type="button" className="link" onClick={() => onSwitch(b.id)}>
                    {name(doc.leaveTypes[b.typeId]!.name)} ({t(`status.${b.status}`)}), {fmt(b.start, { day: 'numeric', month: 'short' })} –{' '}
                    {fmt(b.end, { day: 'numeric', month: 'short' })}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="actions">
          {original && (
            <button type="button" className="danger" onClick={remove}>
              {t('editor.delete')}
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={() => dialog.current?.close()}>
            {t('editor.cancel')}
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            {t('editor.save')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
