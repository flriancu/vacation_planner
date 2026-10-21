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
import { live, type Block, type PlanDoc } from '../domain/schema';
import { useI18n } from '../i18n';
import { describeBlock } from './describe';
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

const FREE_TYPES: ReadonlySet<string> = new Set(['swap', 'closed']);

const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

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

  const days = useMemo(() => buildDays(doc, personId, addDays(from, -40), addDays(to, 40)), [doc, personId, from, to]);
  const weeks = useMemo(() => buildWeeks(from, to, days), [from, to, days]);
  // What each block costs and gives, in words: the days' tooltip and screen-reader text (CAL-7).
  const sentences = useMemo(() => {
    const out = new Map<string, string>();
    for (const b of live(doc.blocks)) {
      if (b.personId !== personId || !overlaps(b.start, b.end, from, to)) continue;
      out.set(b.id, describeBlock(i18n, blockStats(days, b), blockBudget(doc, b, yearOf(b.start))).sentence);
    }
    return out;
  }, [doc, personId, days, from, to, i18n]);

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
  // A day off is a day off: one accent for all leave; swap and office-closed days look like
  // any other day off anyway, with a neutral outline (theme.css).
  const isFree = (b: Block) => FREE_TYPES.has(doc.leaveTypes[b.typeId]?.key ?? '');
  const typeColor = (b: Block) => (isFree(b) ? 'var(--muted)' : 'var(--leave)');

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
              const describe = [
                fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
                ...(info.holiday?.names.map(name) ?? []),
                ...info.blocks.map(
                  (b) => `${name(doc.leaveTypes[b.typeId]!.name)} (${t(`status.${b.status}`)}): ${sentences.get(b.id) ?? ''}`,
                ),
                ...(d === today ? [t('calendar.today')] : []),
              ].join(', ');
              const classes = [
                'day',
                `base-${info.base}`,
                yearOf(d) !== year && 'out-of-year',
                d === today && 'today',
                d < today && 'past',
                !firm && info.blocks.some((b) => !isFree(b)) && 'idea-only',
                selected && 'selected',
                firm && (isFree(firm) ? 'free-block' : `fill-${firm.status}`),
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
                  title={
                    info.blocks
                      .map((b) => sentences.get(b.id))
                      .filter(Boolean)
                      .join('\n') || undefined
                  }
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
