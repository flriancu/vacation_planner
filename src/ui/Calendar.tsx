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
import { blockStats, type BlockStats } from '../domain/blocks';
import { buildDays } from '../domain/calendar';
import { addDays, maxDate, overlaps, yearOf, type ISODate } from '../domain/dates';
import { live, type Block, type PlanDoc } from '../domain/schema';
import { useI18n } from '../i18n';
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

const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/**
 * Mount one per year (`key={year}`), so selection and focus start fresh.
 *
 * The year as one continuous list of Monday-to-Sunday weeks (CAL-1..7).
 *
 * Selecting days: drag with a mouse; or click/tap the first day, then the last
 * (works on touch, where a drag scrolls); or arrows + Shift+arrows + Enter.
 * Activating a day that already has leave opens that leave instead.
 */
export function Calendar({ year, doc, personId, today, onCreate, onOpen }: Props) {
  const { t, date: fmt, name } = useI18n();
  const { from, to } = viewRange(year);

  const days = useMemo(() => buildDays(doc, personId, addDays(from, -40), addDays(to, 40)), [doc, personId, from, to]);
  const weeks = useMemo(() => buildWeeks(from, to, days), [from, to, days]);
  const stats = useMemo(() => {
    const out = new Map<string, BlockStats>();
    for (const b of live(doc.blocks)) if (b.personId === personId && overlaps(b.start, b.end, from, to)) out.set(b.id, blockStats(days, b));
    return out;
  }, [doc, personId, days, from, to]);

  const [selection, setSelection] = useState<Selection | null>(null);
  const [pending, setPending] = useState<ISODate | null>(null);
  const [focusDate, setFocusDate] = useState<ISODate>(() => (yearOf(today) === year ? today : `${year}-01-01`));
  const drag = useRef<{ anchor: ISODate; last: ISODate; moved: boolean } | null>(null);
  const swallowClick = useRef(false);
  const grid = useRef<HTMLDivElement>(null);

  // Move DOM focus with the roving focus, but only while the calendar has focus.
  useEffect(() => {
    if (grid.current?.contains(document.activeElement)) grid.current.querySelector<HTMLElement>(`[data-date="${focusDate}"]`)?.focus();
  }, [focusDate]);

  const finish = (a: ISODate, b: ISODate) => {
    const [start, end] = orderRange(a, b);
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

  const onPointerDown = (e: ReactPointerEvent, date: ISODate) => {
    // A drag that ends on another day sends its click to a parent, so clear the flag on every new press.
    swallowClick.current = false;
    if ((e.pointerType !== 'mouse' && e.pointerType !== 'pen') || e.button !== 0 || pending) return;
    e.preventDefault(); // no text selection while dragging
    drag.current = { anchor: date, last: date, moved: false };
    const move = (ev: PointerEvent) => {
      const d = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-date]')?.dataset
        .date;
      const dr = drag.current;
      if (d && dr && d !== dr.last) {
        dr.moved = true;
        dr.last = d;
        setSelection({ anchor: dr.anchor, focus: d });
      }
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      const dr = drag.current;
      drag.current = null;
      if (dr?.moved) {
        swallowClick.current = true;
        finish(dr.anchor, dr.last);
      }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
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
      setSelection(null);
      setPending(null);
    }
  };

  const [selStart, selEnd] = selection ? orderRange(selection.anchor, selection.focus) : ['', ''];
  const typeColor = (b: Block) => doc.leaveTypes[b.typeId]?.color ?? '#999';

  return (
    <section className="calendar-wrap">
      <p id="cal-help" className="cal-help" aria-live="polite">
        {pending ? t('calendar.pending', { date: fmt(pending, { day: 'numeric', month: 'long' }) }) : t('calendar.help')}
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
          <div className="notes" aria-hidden="true" />
        </div>

        {weeks.map((w) => (
          <div key={w.monday} className="week" role="row">
            <div className="month-col" role="rowheader">
              {w.month && <span className="month-name">{fmt(w.month, { month: 'long', year: 'numeric' })}</span>}
            </div>
            {w.days.map((d) => {
              const info = days.get(d)!;
              const firm = info.blocks.find((b) => b.status !== 'idea');
              const me = monthEdges(d);
              const selected = !!selection && d >= selStart && d <= selEnd;
              const labelled = info.blocks.filter((b) => maxDate(b.start, from) === d);
              const describe = [
                fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
                ...(info.holiday?.names.map(name) ?? []),
                ...info.blocks.map((b) => `${name(doc.leaveTypes[b.typeId]!.name)}: ${t(`status.${b.status}`)}`),
                ...(d === today ? [t('calendar.today')] : []),
              ].join(', ');
              const classes = [
                'day',
                `base-${info.base}`,
                yearOf(d) !== year && 'out-of-year',
                d === today && 'today',
                selected && 'selected',
                firm && `fill-${firm.status}`,
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
                  style={firm ? ({ '--c': typeColor(firm) } as CSSProperties) : undefined}
                  tabIndex={d === focusDate ? 0 : -1}
                  aria-selected={selected}
                  aria-label={describe}
                  onPointerDown={(e) => onPointerDown(e, d)}
                  onPointerEnter={() => pending && setSelection({ anchor: pending, focus: d })}
                  onClick={(e) => onClick(e, d)}
                >
                  <span className="num" aria-hidden="true">
                    {Number(d.slice(8))}
                  </span>
                  {info.blocks.map((b, i) => {
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
                  {labelled.map((b) => {
                    const s = stats.get(b.id);
                    return (
                      s && (
                        <span
                          key={b.id}
                          className={`badge st-${b.status}`}
                          title={t('calendar.costGainLong', { cost: s.cost, gain: s.gain })}
                          aria-hidden="true"
                        >
                          {t('calendar.costGain', { cost: s.cost, gain: s.gain })}
                          {b.status === 'approved' && ' ✓'}
                        </span>
                      )
                    );
                  })}
                </div>
              );
            })}
            <div className="notes" role="gridcell">
              {w.holidays.map((h) => (
                <span key={h.date} className="note">
                  {h.names.map(name).join(' · ')}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
