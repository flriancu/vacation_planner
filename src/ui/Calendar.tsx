import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { blockStats } from '../domain/blocks';
import { blockBudget, buildDays } from '../domain/calendar';
import { addDays, overlaps, yearOf, type ISODate } from '../domain/dates';
import { FIRST_YEAR, LAST_YEAR } from '../domain/holidays';
import { live, type Block, type PlanDoc } from '../domain/schema';
import { useI18n } from '../i18n';
import { describeBlock, type BlockDescription } from './describe';
import { buildWeeks, clampDate, monthEdges, orderRange, outlineEdges, viewRange } from './calendarModel';
import './calendar.css';

interface Props {
  year: number;
  doc: PlanDoc;
  personId: string;
  today: ISODate;
  /** A new range was selected (CAL-8). */
  onCreate: (start: ISODate, end: ISODate) => void;
  /** A day with leave on it was activated (CAL-9). */
  onOpen: (date: ISODate) => void;
}

interface Selection {
  anchor: ISODate;
  focus: ISODate;
}

// Only office-closed days look like days off anyway; swap days are chosen and requested, so they look like leave.
const FREE_TYPES: ReadonlySet<string> = new Set(['closed']);

/** Outlines drawn per day; more would crowd into the number (the tooltip still lists every block). */
const MAX_OUTLINES = 4;

const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
/** A press becomes a drag only past this distance, so a trembling click stays one day. */
const DRAG_PX = 10;

/** "Folosești …" mid-sentence, after a colon: "…: folosești …". */
const lower = (s: string) => s.charAt(0).toLocaleLowerCase() + s.slice(1);

/** The day under the pointer, if any. */
function dayAt(ev: PointerEvent): ISODate | undefined {
  return (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-date]')?.dataset.date;
}

/**
 * Mount one per year (`key={year}`), so selection and focus start fresh.
 *
 * The year as one continuous list of Monday-to-Sunday weeks (CAL-1..7).
 * A block's cost and break are not drawn on the calendar; they are the days' tooltip.
 *
 * Selecting days: drag with a mouse; or click/tap the first day, then the last
 * (works on touch, where a drag scrolls); or arrows + Shift+arrows + Enter.
 * Activating a day that already has leave opens that leave instead.
 */
export function Calendar({ year, doc, personId, today, onCreate, onOpen }: Props) {
  const i18n = useI18n();
  const { t, date: fmt, name } = i18n;
  const { from, to } = viewRange(year);

  // The view plus 40 days each side for the breaks around it, stretched to whole blocks, so a
  // block's cost reads the same from every year it touches.
  const days = useMemo(() => {
    let lo = addDays(from, -40);
    let hi = addDays(to, 40);
    for (const b of live(doc.blocks)) {
      if (b.personId !== personId || !overlaps(b.start, b.end, from, to)) continue;
      if (b.start < lo) lo = b.start;
      if (b.end > hi) hi = b.end;
    }
    return buildDays(doc, personId, lo, hi);
  }, [doc, personId, from, to]);
  const weeks = useMemo(() => buildWeeks(from, to), [from, to]);
  // What each block costs and gives, in words: the days' tooltip and screen-reader text (CAL-7).
  const descriptions = useMemo(() => {
    const out = new Map<string, BlockDescription>();
    for (const b of live(doc.blocks)) {
      if (b.personId !== personId || !overlaps(b.start, b.end, from, to)) continue;
      out.set(b.id, describeBlock(i18n, blockStats(days, b), blockBudget(doc, b, yearOf(b.start))));
    }
    return out;
  }, [doc, personId, days, from, to, i18n]);
  const sentence = (b: Block) => descriptions.get(b.id)?.sentence ?? '';

  /**
   * A day's tooltip: its holiday, then one line per block saying which block it is and what it
   * costs, then the break they make, once (blocks on the same day usually share one):
   * "Birou închis (planificat): nu folosești zile de concediu / Concediu de odihnă (aprobat):
   * folosești 7 zile de concediu / → ești liber 23 de zile la rând: …".
   */
  const tooltip = (d: ISODate, blocks: Block[]) => {
    const lines = [holidayNames(d)];
    const stretches = new Set<string>();
    for (const b of blocks) {
      const desc = descriptions.get(b.id);
      if (!desc) continue;
      const which = `${name(doc.leaveTypes[b.typeId]!.name)} (${lower(t(`status.${b.status}`))})`;
      lines.push(`${which}: ${lower(desc.spend ?? t('block.spendNone'))}`);
      stretches.add(desc.stretch);
    }
    for (const s of stretches) lines.push(`→ ${s}`);
    return lines.filter(Boolean).join('\n') || undefined;
  };

  const [selection, setSelection] = useState<Selection | null>(null);
  const [pending, setPending] = useState<ISODate | null>(null);
  const [focusDate, setFocusDate] = useState<ISODate>(() => (yearOf(today) === year ? today : `${year}-01-01`));
  const drag = useRef<{ anchor: ISODate; last: ISODate; moved: boolean; x: number; y: number; stop: () => void } | null>(null);
  const swallowClick = useRef(false);
  const grid = useRef<HTMLDivElement>(null);

  // Move DOM focus with the roving focus, but only while the calendar has focus.
  useEffect(() => {
    if (grid.current?.contains(document.activeElement)) grid.current.querySelector<HTMLElement>(`[data-date="${focusDate}"]`)?.focus();
  }, [focusDate]);

  const finish = (a: ISODate, b: ISODate) => {
    // Days shown past 1900–2099 (the edges of those years' views) can't hold leave.
    const [start, end] = orderRange(a, b).map((d) => clampDate(d, `${FIRST_YEAR}-01-01`, `${LAST_YEAR}-12-31`)) as [ISODate, ISODate];
    if (start > end) return;
    setSelection(null);
    setPending(null);
    onCreate(start, end);
  };

  const activate = (date: ISODate) => {
    if (pending) return finish(pending, date);
    if (days.get(date)?.blocks.length) return onOpen(date);
    setPending(date);
    setSelection({ anchor: date, focus: date });
  };

  /** Ends a drag without creating anything (Escape, or the browser taking the pointer over). */
  const cancelDrag = () => {
    const dr = drag.current;
    if (!dr) return false;
    dr.stop();
    drag.current = null;
    swallowClick.current = dr.moved;
    setSelection(null);
    return true;
  };

  const onPointerDown = (e: ReactPointerEvent, date: ISODate) => {
    // A drag that ends on another day sends its click to a parent, so clear the flag on every new press.
    swallowClick.current = false;
    if ((e.pointerType !== 'mouse' && e.pointerType !== 'pen') || e.button !== 0) return;
    if (pending) {
      // The last day of a click-click selection: a shake onto the next day must not lose it.
      const release = (ev: PointerEvent) => {
        document.removeEventListener('pointerup', release);
        if (dayAt(ev) !== date) {
          swallowClick.current = true;
          activate(date);
        }
      };
      document.addEventListener('pointerup', release);
      return;
    }
    e.preventDefault(); // no text selection while dragging
    const move = (ev: PointerEvent) => {
      const dr = drag.current;
      if (!dr || (!dr.moved && Math.hypot(ev.clientX - dr.x, ev.clientY - dr.y) < DRAG_PX)) return;
      const d = dayAt(ev);
      if (d && d !== dr.last) {
        dr.moved = true;
        dr.last = d;
        setSelection({ anchor: dr.anchor, focus: d });
      }
    };
    const up = (ev: PointerEvent) => {
      const dr = drag.current;
      dr?.stop();
      drag.current = null;
      if (!dr) return;
      if (dr.moved) {
        swallowClick.current = true;
        finish(dr.anchor, dr.last);
        return;
      }
      // A press that shook onto the next day without becoming a drag: the browser sends its
      // click to the row, not to a day, so it counts here as a click on the day it began on.
      if (dayAt(ev) !== dr.anchor) {
        grid.current?.querySelector<HTMLElement>(`[data-date="${dr.anchor}"]`)?.focus({ preventScroll: true });
        setFocusDate(dr.anchor);
        activate(dr.anchor);
      }
    };
    // Escape ends a drag wherever keyboard focus is (the grid's own keys need focus inside it).
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === 'Escape') cancelDrag();
    };
    const stop = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancelDrag);
      document.removeEventListener('keydown', onKey);
    };
    drag.current = { anchor: date, last: date, moved: false, x: e.clientX, y: e.clientY, stop };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancelDrag);
    document.addEventListener('keydown', onKey);
  };

  const onClick = (e: MouseEvent, date: ISODate) => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    // onPointerDown prevents the default focus change, so focus the day here (Escape and arrows need it).
    (e.currentTarget as HTMLElement).focus({ preventScroll: true });
    setFocusDate(date);
    activate(date);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = STEPS[e.key];
    if (step) {
      e.preventDefault();
      const next = clampDate(addDays(focusDate, step), from, to);
      if (pending) setSelection({ anchor: pending, focus: next });
      else if (e.shiftKey) setSelection((s) => ({ anchor: s?.anchor ?? focusDate, focus: next }));
      else setSelection(null);
      setFocusDate(next);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (selection && selection.anchor !== selection.focus && !pending) finish(selection.anchor, selection.focus);
      else activate(focusDate);
    } else if (e.key === 'Escape') {
      cancelDrag();
      setSelection(null);
      setPending(null);
    }
  };

  const [selStart, selEnd] = selection ? orderRange(selection.anchor, selection.focus) : ['', ''];
  // A day off is a day off: one accent for all leave (swap days included); office-closed days
  // look like any other day off anyway, with a neutral outline (theme.css).
  const isFree = (b: Block) => FREE_TYPES.has(doc.leaveTypes[b.typeId]?.key ?? '');
  const typeColor = (b: Block) => (isFree(b) ? 'var(--muted)' : 'var(--leave)');

  // Holiday names aren't drawn on the calendar (only a dot): they're in the tooltip, the
  // screen-reader label and this hint line when a day is picked.
  const holidayNames = (d: ISODate) => days.get(d)?.holiday?.names.map(name).join(' · ');
  const dayWithHoliday = (d: ISODate) => {
    const h = holidayNames(d);
    return `${fmt(d, { weekday: 'long' })} ${fmt(d, { day: 'numeric', month: 'long' })}${h ? ` (${h})` : ''}`;
  };

  return (
    <section className="calendar-wrap">
      <p id="cal-help" className="cal-help" aria-live="polite">
        {pending ? (
          <span className="cal-pending">{t('calendar.pending', { date: dayWithHoliday(pending) })}</span>
        ) : (
          <span className="sr-only">{t('calendar.help')}</span>
        )}
      </p>
      {/* The grid itself isn't a tab stop: one day cell is (roving tabindex), and keys bubble up here. */}
      {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus */}
      <div
        className="calendar"
        role="grid"
        aria-label={t('calendar.label', { year })}
        aria-describedby="cal-help"
        onKeyDown={onKeyDown}
        ref={grid}
      >
        <div className="week cal-head" role="row">
          <div className="month-col" aria-hidden="true" />
          {weeks[0]!.days.map((d) => (
            <div key={d} className="weekday" role="columnheader">
              <span aria-hidden="true">{fmt(d, { weekday: 'narrow' })}</span>
              <span className="sr-only">{fmt(d, { weekday: 'long' })}</span>
            </div>
          ))}
        </div>

        {weeks.map((w) => (
          <div key={w.monday} className="week" role="row">
            <div className="month-col" role="rowheader">
              {w.month && (
                <span
                  className={`month-band${w === weeks[0] ? ' first' : ''}`}
                  style={{ '--span': w.span } as CSSProperties}
                  aria-label={fmt(w.month, { month: 'long', year: 'numeric' })}
                >
                  {/* Two-week bands (the view's edges) are too short for the year too. */}
                  <span aria-hidden="true">{fmt(w.month, w.span! >= 3 ? { month: 'long', year: 'numeric' } : { month: 'long' })}</span>
                </span>
              )}
            </div>
            {w.days.map((d) => {
              const info = days.get(d)!;
              const firm = info.blocks.find((b) => b.status !== 'idea');
              const me = monthEdges(d);
              const selected = !!selection && d >= selStart && d <= selEnd;
              const describe = [
                fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
                ...(info.holiday?.names.map(name) ?? []),
                ...info.blocks.map((b) => `${name(doc.leaveTypes[b.typeId]!.name)} (${t(`status.${b.status}`)}): ${sentence(b)}`),
                ...(d === today ? [t('calendar.today')] : []),
              ].join(', ');
              const classes = [
                'day',
                `base-${info.base}`,
                yearOf(d) !== year && 'out-of-year',
                d === today && 'today',
                d < today && 'past',
                // Days off anyway (weekend, holiday, office closed) keep their own fill inside leave:
                // the block's outline shows the range, the fill shows what each day is.
                info.base === 'work' && !firm && info.blocks.some((b) => !isFree(b)) && 'idea-only',
                selected && 'selected',
                firm && (isFree(firm) ? 'free-block' : info.base === 'work' && `fill-${firm.status}`),
                me.top && 'm-top',
                me.left && 'm-left',
              ];
              return (
                // Keys are handled once, on the grid (onKeyDown above).
                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
                <div
                  key={d}
                  role="gridcell"
                  data-date={d}
                  className={classes.filter(Boolean).join(' ')}
                  style={info.blocks[0] ? ({ '--c': typeColor(firm ?? info.blocks[0]) } as CSSProperties) : undefined}
                  tabIndex={d === focusDate ? 0 : -1}
                  aria-selected={selected}
                  aria-label={describe}
                  data-tip={tooltip(d, info.blocks)}
                  onPointerDown={(e) => onPointerDown(e, d)}
                  onPointerEnter={() => pending && setSelection({ anchor: pending, focus: d })}
                  // However a day got focus (click, script, a screen reader's cursor), arrows start from it.
                  onFocus={() => setFocusDate(d)}
                  onClick={(e) => onClick(e, d)}
                >
                  <span className="num" aria-hidden="true">
                    {Number(d.slice(8))}
                  </span>
                  {info.blocks.slice(0, MAX_OUTLINES).map((b, i) => {
                    const e = outlineEdges(d, b.start, b.end);
                    return (
                      <span
                        key={b.id}
                        className={`outline st-${b.status}${e.top ? ' e-t' : ''}${e.right ? ' e-r' : ''}${e.bottom ? ' e-b' : ''}${e.left ? ' e-l' : ''}`}
                        style={{ '--c': typeColor(b), '--i': i } as CSSProperties}
                        aria-hidden="true"
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
