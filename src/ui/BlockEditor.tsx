import { useEffect, useEffectEvent, useMemo, useRef, useState, type FormEvent, type SyntheticEvent } from 'react';
import { blockStats } from '../domain/blocks';
import { blockBudget, buildDays, findOverlaps, fullOfIdeas, MAX_IDEAS_PER_DAY } from '../domain/calendar';
import { addDays, overlaps, yearOf, type ISODate } from '../domain/dates';
import { updateRecord } from '../domain/edit';
import { addRecord, live, STATUS_RANK, typeByKey, type Block, type BlockStatus, type PlanDoc } from '../domain/schema';
import { swapHolidaysFor } from '../domain/swaps';
import { useI18n } from '../i18n';
import { looksFree } from './calendarModel';
import { describeBlock } from './describe';
import { DateRangeFields } from './DateRangeFields';
import { BlockSwatch } from './Legend';
import { Select } from './Select';
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

/** Create or edit one block: type, status, dates, note (CAL-8, CAL-9, BLK-*). */
export function BlockEditor({ target, doc, personId, onSave, onDelete, onSwitch, onClose }: Props) {
  const i18n = useI18n();
  const { t, name, date: fmt } = i18n;
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
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
    // The title takes focus when the dialog opens, not the first control: on iPhones a focused
    // drop-down opens its picker at once, over the dialog. (React doesn't put `autoFocus` into
    // the page, and the dialog looks for the attribute, so it is set here.)
    title.current?.setAttribute('autofocus', '');
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
  // The rules hold for what I change here: a block that already breaks one (from an older
  // version, a merge or an undo) can still get a note, but not new dates, status or type.
  const touched =
    !original ||
    original.deleted === true ||
    original.start !== draft.start ||
    original.end !== draft.end ||
    original.status !== draft.status ||
    original.typeId !== draft.typeId;
  const blocked = touched && !!preview?.overlap && draft.status !== 'idea';
  // ...and no day holds more than MAX_IDEAS_PER_DAY ideas.
  const crowded = touched && draft.status === 'idea' && valid ? fullOfIdeas(doc, personId, draft.start, draft.end, original?.id) : [];

  // DAY-4: a swap day is one working day, the Friday just before or the Monday just after a
  // weekend with a legal holiday; it stands for that holiday. The one chosen, else the first that
  // no other swap day stands for yet.
  const swapHolidays = type.key === 'swap' && valid && draft.start === draft.end ? swapHolidaysFor(doc, draft.start) : [];
  const misplacedSwap = touched && type.key === 'swap' && valid && swapHolidays.length === 0;
  const taken = new Set(
    live(doc.blocks)
      .filter((b) => b.personId === personId && b.id !== original?.id && b.status !== 'idea' && b.swapFor)
      .map((b) => b.swapFor),
  );
  // One swap day per holiday: a holiday another planned or approved swap day stands for is not on offer.
  const freeHolidays =
    draft.status === 'idea' ? swapHolidays : swapHolidays.filter((h) => !taken.has(h.date) || h.date === original?.swapFor);
  const swapTaken = touched && type.key === 'swap' && swapHolidays.length > 0 && freeHolidays.length === 0;
  const swapFor = freeHolidays.some((h) => h.date === draft.swapFor) ? draft.swapFor : freeHolidays[0]?.date;
  const cannotSave = !valid || blocked || crowded.length > 0 || misplacedSwap || swapTaken;
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
    setDraft((d) => ({ ...d, typeId, status, ...(next.key !== 'swap' && { swapFor: undefined }) }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (cannotSave) return;
    onSave({ ...draft, swapFor: type.key !== 'swap' ? undefined : touched ? swapFor : original?.swapFor });
  };

  /** Leaves the editor through `then`, asking first if there are unsaved changes. */
  const leave = (then: () => void) => (dirty ? setLeaving(() => then) : then());
  const close = () => dialog.current?.close();

  // Escape, one step at a time: close the month calendar, else answer "keep editing" to the
  // question, else ask about unsaved changes (or close when there are none).
  const escape = () => {
    if (pickerOpen) setPickerOpen(false);
    else if (leaving) setLeaving(null);
    else leave(close);
  };
  // Taken before the browser sees it: Escape on a modal dialog is a "close request", and Chrome
  // lets a page cancel only the first of two in a row, so a second Escape would close the editor
  // and drop the draft. A key some other part already handled (a tooltip closing) is left alone.
  const onEscape = useEffectEvent(escape);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onEscape();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
  // Other close requests (Android's back gesture): the same steps, when the browser lets us.
  const onCancel = (e: SyntheticEvent) => {
    if (!e.cancelable) return;
    e.preventDefault();
    escape();
  };

  // No "are you sure?": the delete can be undone from the message that follows (App).
  const remove = () => original && onDelete(original.id);

  return (
    <dialog ref={dialog} className="editor" aria-labelledby="editor-title" onClose={onClose} onCancel={onCancel}>
      <form onSubmit={submit}>
        <h2 id="editor-title" ref={title} tabIndex={-1}>
          {t(target.mode === 'new' ? 'editor.new' : 'editor.edit')}
        </h2>

        {original?.deleted && (
          <p className="warning" role="alert">
            {t('editor.deletedElsewhere')}
          </p>
        )}

        {/* Each type with its swatch in the chosen status, as the calendar will draw it. */}
        <Select
          label={t('editor.type')}
          value={draft.typeId}
          options={types.map((lt) => ({
            value: lt.id,
            label: name(lt.name),
            icon: <BlockSwatch status={draft.status} free={looksFree(lt.key)} />,
          }))}
          onChange={changeType}
        />

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
            <select value={swapFor ?? ''} onChange={(e) => set({ swapFor: e.target.value })} disabled={freeHolidays.length === 0}>
              {freeHolidays.length === 0 && <option value="">{t('editor.swapNone')}</option>}
              {freeHolidays.map((h) => (
                <option key={h.date} value={h.date}>
                  {fmt(h.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} — {h.names.map(name).join(' · ')}
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
          {misplacedSwap && <span className="warning">{t('editor.swapAdjacent')}</span>}
          {swapTaken && <span className="warning">{t('editor.swapTaken')}</span>}
          {crowded.length > 0 && (
            <span className="warning">
              {t('editor.tooManyIdeas', {
                max: MAX_IDEAS_PER_DAY,
                date: fmt(crowded[0]!, { weekday: 'long', day: 'numeric', month: 'long' }),
              })}
            </span>
          )}
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
            <button type="submit" className="primary" disabled={cannotSave}>
              {t('editor.save')}
            </button>
          </div>
        )}
      </form>
    </dialog>
  );
}
