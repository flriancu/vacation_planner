import { useEffect, useMemo, useRef, useState, type FormEvent, type SyntheticEvent } from 'react';
import { blockStats } from '../domain/blocks';
import { blockBudget, buildDays, findOverlaps } from '../domain/calendar';
import { addDays, overlaps, yearOf, type ISODate } from '../domain/dates';
import { updateRecord } from '../domain/edit';
import { addRecord, live, STATUS_RANK, typeByKey, type Block, type BlockStatus, type PlanDoc } from '../domain/schema';
import { swapReminders, type SwapReminder } from '../domain/swaps';
import { useI18n } from '../i18n';
import { describeBlock } from './describe';
import { DateRangeFields } from './DateRangeFields';
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
  const annual = typeByKey(doc, 'annual') ?? live(doc.leaveTypes)[0]!;
  return { typeId: annual.id, status: 'idea', start: target.start, end: target.end, note: '' };
}

const sameDraft = (a: Draft, b: Draft) =>
  a.typeId === b.typeId && a.status === b.status && a.start === b.start && a.end === b.end && a.note === b.note && a.swapFor === b.swapFor;

/**
 * Weekend holidays a swap day around `date` can stand for (DAY-4). A holiday on 1 January
 * can be made up on 31 December of the year before, so the neighbouring years count too.
 */
function nearbyReminders(doc: PlanDoc, personId: string, date: ISODate): SwapReminder[] {
  const y = yearOf(date);
  return [y - 1, y, y + 1].flatMap((year) => swapReminders(doc, personId, year));
}

/** Create or edit one block: type, status, dates, note (CAL-8, CAL-9, BLK-*). */
export function BlockEditor({ target, doc, personId, onSave, onDelete, onSwitch, onClose }: Props) {
  const i18n = useI18n();
  const { t, name, date: fmt } = i18n;
  const dialog = useRef<HTMLDialogElement>(null);
  const [initial] = useState(() => initialDraft(target, doc));
  const [draft, setDraft] = useState(initial);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Set while asking whether to drop unsaved changes: what to do if the answer is yes. */
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  /** Approval dropped only because the type moved to one without approval; given back if it moves back. */
  const [demoted, setDemoted] = useState(false);
  const original: Block | undefined = target.mode === 'edit' ? doc.blocks[target.blockId] : undefined;
  const dirty = !sameDraft(draft, initial);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  const types = live(doc.leaveTypes).filter((lt) => !lt.hidden || lt.id === draft.typeId);
  const type = doc.leaveTypes[draft.typeId]!;
  const valid = draft.start !== '' && draft.end !== '' && draft.start <= draft.end;

  // BLK-4: types without approval stop at "planned"; an existing block moves one stage at a time,
  // so the stage two steps away is shown but disabled (with the reason), not hidden.
  const shown = STATUSES.filter((s) => type.needsApproval || s !== 'approved');
  const reachable = (s: BlockStatus) => !original || Math.abs(STATUS_RANK[s] - STATUS_RANK[original.status]) <= 1;
  const datesChanged = !!original && (original.start !== draft.start || original.end !== draft.end);

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

  // BLK-5: planned and approved leave can't overlap other planned or approved leave; ideas can.
  const blocked = !!preview?.overlap && draft.status !== 'idea';

  // The holidays this swap day can stand for: still open, or already the one this block stands for.
  const ownId = original?.id;
  const reminders =
    type.key === 'swap' && valid
      ? nearbyReminders(doc, personId, draft.start).filter((r) => r.open || (r.resolvedBy && r.resolvedBy.id === ownId))
      : [];
  const alsoHere =
    original && valid
      ? live(doc.blocks).filter((b) => b.personId === personId && b.id !== original.id && overlaps(b.start, b.end, draft.start, draft.end))
      : [];

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const changeType = (typeId: string) => {
    const next = doc.leaveTypes[typeId]!;
    let status = draft.status;
    if (!next.needsApproval && status === 'approved') {
      status = 'planned';
      setDemoted(true);
    } else if (next.needsApproval && demoted && status === 'planned') {
      status = 'approved';
      setDemoted(false);
    }
    const swapFor =
      next.key === 'swap'
        ? (draft.swapFor ??
          nearbyReminders(doc, personId, draft.start).find((r) => r.open && r.options.includes(draft.start))?.holiday.date)
        : undefined;
    setDraft((d) => ({ ...d, typeId, status, ...(swapFor ? { swapFor } : { swapFor: undefined }) }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || blocked) return;
    // A holiday no longer on offer (the dates moved away from it) is not kept out of sight.
    const swapFor = type.key === 'swap' && reminders.some((r) => r.holiday.date === draft.swapFor) ? draft.swapFor : undefined;
    onSave({ ...draft, swapFor });
  };

  /** Leaves the editor through `then`, asking first if there are unsaved changes. */
  const leave = (then: () => void) => (dirty ? setLeaving(() => then) : then());
  const close = () => dialog.current?.close();

  // Escape (the dialog's "cancel"): close the month calendar first, then ask about unsaved changes.
  // Handled here rather than on the calendar's keydown, because Safari closes the dialog regardless.
  const onCancel = (e: SyntheticEvent) => {
    e.preventDefault();
    if (pickerOpen) setPickerOpen(false);
    else if (leaving) setLeaving(null);
    else leave(close);
  };

  // No "are you sure?": the delete can be undone from the message that follows (App).
  const remove = () => original && onDelete(original.id);

  return (
    <dialog ref={dialog} className="editor" aria-labelledby="editor-title" onClose={onClose} onCancel={onCancel}>
      <form onSubmit={submit}>
        <h2 id="editor-title">{t(target.mode === 'new' ? 'editor.new' : 'editor.edit')}</h2>

        {original?.deleted && (
          <p className="warning" role="alert">
            {t('editor.deletedElsewhere')}
          </p>
        )}

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
          {shown.map((s) => (
            <label key={s} className={`status-option st-${s}`} data-tip={reachable(s) ? undefined : t('editor.oneStep')}>
              <input
                type="radio"
                name="status"
                value={s}
                checked={draft.status === s}
                disabled={!reachable(s)}
                onChange={() => {
                  setDemoted(false);
                  set({ status: s });
                }}
              />
              {t(`status.${s}`)}
            </label>
          ))}
        </fieldset>

        <DateRangeFields
          start={draft.start}
          end={draft.end}
          onChange={(start, end) => set({ start, end })}
          overrides={live(doc.holidayOverrides)}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
        />

        {type.key === 'swap' && (
          <label>
            {t('editor.swapFor')}
            <select value={draft.swapFor ?? ''} onChange={(e) => set({ swapFor: e.target.value || undefined })}>
              <option value="">{t('editor.swapNone')}</option>
              {reminders.map((r) => (
                <option key={r.holiday.date} value={r.holiday.date}>
                  {fmt(r.holiday.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} —{' '}
                  {r.holiday.names.map(name).join(' · ')}
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
          {preview && (
            <span data-testid="editor-cost" className="describe">
              {preview.description.spend && <span className="spend">{preview.description.spend}</span>}
              <span>{preview.description.get}</span>
            </span>
          )}
          {blocked && <span className="warning">{t('editor.overlap')}</span>}
          {original?.status === 'approved' && datesChanged && <span className="warning">{t('editor.warnApprovedDates')}</span>}
        </p>

        {alsoHere.length > 0 && (
          <div className="also-here">
            {t('editor.alsoHere')}
            <ul>
              {alsoHere.map((b) => (
                <li key={b.id}>
                  <button type="button" className="link" onClick={() => leave(() => onSwitch(b.id))}>
                    {name(doc.leaveTypes[b.typeId]!.name)} ({t(`status.${b.status}`)}), {fmt(b.start, { day: 'numeric', month: 'long' })} –{' '}
                    {fmt(b.end, { day: 'numeric', month: 'long' })}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {leaving ? (
          <div className="actions confirm" role="alert">
            <span>{t('editor.unsaved')}</span>
            <span className="spacer" />
            <button type="button" onClick={() => setLeaving(null)}>
              {t('editor.keepEditing')}
            </button>
            <button type="button" className="danger" onClick={leaving}>
              {t('editor.discard')}
            </button>
          </div>
        ) : (
          <div className="actions">
            {original && !original.deleted && (
              <button type="button" className="danger" onClick={remove}>
                {t('editor.delete')}
              </button>
            )}
            <span className="spacer" />
            <button type="button" onClick={() => leave(close)}>
              {t('editor.cancel')}
            </button>
            <button type="submit" className="primary" disabled={!valid || blocked}>
              {t('editor.save')}
            </button>
          </div>
        )}
      </form>
    </dialog>
  );
}
