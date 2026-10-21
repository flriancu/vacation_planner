// The calendar's Escape handling sits on the panel (role="dialog"), as the WAI-ARIA APG date picker does.
/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions */
import { DayPicker, type DayButtonProps } from '@daypicker/react';
import { enUS, ro } from '@daypicker/react/locale';
import '@daypicker/react/style.css';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { isWeekend, makeDate, type ISODate } from '../domain/dates';
import { holidaysBetween } from '../domain/holidays';
import type { HolidayOverride } from '../domain/schema';
import { useI18n } from '../i18n';
import { orderRange } from './calendarModel';

interface Props {
  start: ISODate;
  end: ISODate;
  onChange: (start: ISODate, end: ISODate) => void;
  overrides: readonly HolidayOverride[];
}

/** DayPicker works with local Date objects; the app with whole-day ISO strings. */
function toDate(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

function toIso(date: Date): ISODate {
  return makeDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Holiday names for a day (`ro`/`en` already picked), for the day buttons below. */
const HolidayNames = createContext<(iso: ISODate) => string | undefined>(() => undefined);

/**
 * DayPicker's day button, plus the holiday name in the label and the app's tooltip. Like
 * DayPicker's own button, it takes DOM focus when DayPicker marks the day focused (arrow keys).
 */
function HolidayDayButton({ day, modifiers, ...button }: DayButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const names = useContext(HolidayNames)(day.isoDate);
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);
  const label = button['aria-label'];
  return <button ref={ref} {...button} aria-label={names && label ? `${label}, ${names}` : label} data-tip={names} />;
}

/**
 * The editor's dates, with DayPicker (the same library as the dm app): one field showing the
 * range in words, and an inline month calendar where you click the first day, then the last (in
 * either order), with the range previewed in between. Inline, so the editor dialog never clips it.
 * Marked like the main calendar: off-anyway tint, holiday dots (name in the tooltip), today.
 */
export function DateRangeFields({ start, end, onChange, overrides }: Props) {
  const { t, lang, date: fmt, name } = useI18n();
  const [open, setOpen] = useState(false);
  /** Set after the first click: the day the new range starts from. */
  const [anchor, setAnchor] = useState<ISODate | null>(null);
  const [hover, setHover] = useState<ISODate | null>(null);
  const [month, setMonth] = useState<Date>(() => toDate(start));
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const year = Number(start.slice(0, 4));
  const holidays = useMemo(() => holidaysBetween(`${year - 1}-01-01`, `${year + 1}-12-31`, overrides), [year, overrides]);

  // Keyboard users land on the range's first day when the calendar opens (APG date picker).
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      panel.current?.querySelector<HTMLButtonElement>(`[data-day="${start}"] button`)?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
    // only when it opens
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const show = () => {
    setOpen(true);
    setAnchor(null);
    setHover(null);
    setMonth(toDate(start));
  };

  const close = () => {
    setOpen(false);
    setAnchor(null);
    setHover(null);
    trigger.current?.focus();
  };

  const pick = (day: Date) => {
    const d = toIso(day);
    if (!anchor) {
      setAnchor(d);
      return;
    }
    const [s, e] = orderRange(anchor, d);
    onChange(s, e);
    close();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // Cancel the calendar only (nothing changes), not the editor dialog around it.
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  const holidayNames = useCallback((iso: ISODate) => holidays.get(iso)?.names.map(name).join(' · '), [holidays, name]);

  const long = (d: ISODate) => `${fmt(d, { weekday: 'long' })} ${fmt(d, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  const range = start === end ? long(start) : `${long(start)} – ${long(end)}`;
  // While choosing the last day the range runs from the first click to the day under the
  // pointer or keyboard focus; otherwise it is the current range.
  const [lo, hi] = anchor ? orderRange(anchor, hover ?? anchor) : [start, end];

  return (
    <div className="date-range">
      <div className="dp-field">
        <span className="dp-label" id="dp-label">
          {t('editor.dates')}
        </span>
        <button
          ref={trigger}
          type="button"
          className={`dp-button${open ? ' active' : ''}`}
          aria-labelledby="dp-label dp-value"
          aria-expanded={open}
          data-start={start}
          data-end={end}
          onClick={() => (open ? close() : show())}
        >
          <span id="dp-value">{range}</span>
          <span className="dp-icon" aria-hidden="true">
            📅
          </span>
        </button>
      </div>

      {open && (
        <div ref={panel} className={`dp-panel${anchor ? ' choosing' : ''}`} role="dialog" aria-label={t('dp.panel')} onKeyDown={onKeyDown}>
          <p className="dp-step" aria-live="polite">
            {anchor ? t('dp.pickEnd', { date: long(anchor) }) : t('dp.pickStart')}
          </p>
          <HolidayNames.Provider value={holidayNames}>
            <DayPicker
              mode="range"
              resetOnSelect
              locale={lang === 'ro' ? ro : enUS}
              weekStartsOn={1}
              month={month}
              onMonthChange={setMonth}
              selected={{ from: toDate(lo), to: toDate(hi) }}
              onSelect={() => {}}
              onDayClick={pick}
              onDayMouseEnter={(d) => anchor && setHover(toIso(d))}
              onDayFocus={(d) => anchor && setHover(toIso(d))}
              modifiers={{
                off: (d: Date) => isWeekend(toIso(d)) || holidays.has(toIso(d)),
                holiday: (d: Date) => holidays.has(toIso(d)),
              }}
              modifiersClassNames={{ off: 'dp-off', holiday: 'dp-holiday' }}
              components={{ DayButton: HolidayDayButton }}
              labels={{ labelPrevious: () => t('dp.prevMonth'), labelNext: () => t('dp.nextMonth') }}
            />
          </HolidayNames.Provider>
        </div>
      )}
    </div>
  );
}
