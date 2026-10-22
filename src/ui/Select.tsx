import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  /** Drawn before the label, in the field and in the list (the editor's swatch of a leave type). */
  icon?: ReactNode;
}

interface Props {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** What the field shows when `value` is none of the options (a block whose type was deleted). */
  missing?: string;
}

/** Typed letters within this long of each other make one search ("co" finds "Concediu"). */
const TYPE_AHEAD_MS = 500;
const PAGE = 10;

/** A second click this soon and this near a choice is the rest of a double click or tap. */
const SETTLE_MS = 400;
const SETTLE_PX = 10;

/**
 * Swallows the second click of a double click (or tap) on an option: the list has closed, so it
 * would land on what the list was covering. Any other click, even a quick one in the same place, goes through.
 */
function settle(x: number, y: number) {
  const until = Date.now() + SETTLE_MS;
  const swallow = (e: MouseEvent) => {
    // Only the second click of one double click (its click count says so), not a new single click there.
    if (e.detail < 2 || Date.now() > until || Math.abs(e.clientX - x) > SETTLE_PX || Math.abs(e.clientY - y) > SETTLE_PX) return;
    e.preventDefault();
    e.stopPropagation();
  };
  for (const type of ['click', 'dblclick'] as const) document.addEventListener(type, swallow, true);
  setTimeout(() => {
    for (const type of ['click', 'dblclick'] as const) document.removeEventListener(type, swallow, true);
  }, SETTLE_MS);
}

/** Lowercase, without diacritics: typing "i" finds "Învoire". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * A drop-down list whose options can show a picture, which a native <select> can't do on
 * phones. It is the WAI-ARIA "select-only combobox": focus stays on the field and the list
 * marks the option in reach (aria-activedescendant).
 *
 * The list floats over what is below the field, so opening or closing it never moves another
 * control: a tap meant for the list can't land on a button that slid into its place.
 *
 * Keys: arrows, Home/End, Page Up/Down, typing the start of a name (spaces included, so
 * "Concediu m" finds "Concediu medical"); Enter, Space or Tab chooses; Escape, and the
 * phone's back gesture, close the list only, not the dialog around it.
 */
export function Select({ label, value, options, onChange, disabled = false, missing }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const pointer = useRef({ x: NaN, y: NaN });
  const current = options.findIndex((o) => o.value === value);
  const selected = options[current];
  const last = options.length - 1;
  const clamp = (i: number) => Math.min(Math.max(i, 0), last);

  const show = (at: number) => {
    if (disabled) return;
    setActive(clamp(at));
    setOpen(true);
  };
  const choose = (i: number) => {
    setOpen(false);
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
  };

  /** Adds a typed character to the search, or starts a new one after a pause. */
  const type = (key: string) => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > TYPE_AHEAD_MS ? key : t.text + key;
    t.at = now;
    return t.text;
  };
  const searching = () => typed.current.text !== '' && Date.now() - typed.current.at <= TYPE_AHEAD_MS;

  /** The next option whose label starts with `text`; a repeated letter steps through them. */
  const search = (text: string, from: number) => {
    const wanted = fold([...text].every((c) => c === text[0]) ? text[0]! : text);
    const start = wanted.length === 1 ? from + 1 : from;
    for (let k = 0; k < options.length; k++) {
      const i = (((start + k) % options.length) + options.length) % options.length;
      if (fold(options[i]!.label).startsWith(wanted)) return i;
    }
    return -1;
  };

  // While open, before anything else sees them (the window comes first in the capture phase):
  // Escape and the dialog's close request (Android's back gesture) close the list only; a click
  // outside closes it. A scroll gesture on the dialog makes no click, so it leaves the list open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
    };
    const onCancel = (e: Event) => {
      if (!(e.target instanceof Node) || !e.target.contains(root.current)) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('cancel', onCancel, true);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('cancel', onCancel, true);
      document.removeEventListener('click', onClick, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || disabled) return;
    const from = open ? active : Math.max(current, 0);
    // A space in the middle of a name is part of the search, as long as some name goes on
    // that way ("Concediu m"); otherwise it opens or chooses ("b", then Space, chooses Birou închis).
    const spaceInName = e.key === ' ' && searching() && search(`${typed.current.text} `, from) >= 0;
    if (e.key.length === 1 && !e.altKey && (e.key !== ' ' || spaceInName)) {
      const found = search(type(e.key), from);
      if (found >= 0) show(found);
      else if (!open) show(from);
      e.preventDefault();
      return;
    }
    const step: Record<string, () => void> = open
      ? {
          ArrowDown: () => setActive(clamp(active + 1)),
          ArrowUp: () => (e.altKey ? choose(active) : setActive(clamp(active - 1))),
          PageDown: () => setActive(clamp(active + PAGE)),
          PageUp: () => setActive(clamp(active - PAGE)),
          Home: () => setActive(0),
          End: () => setActive(last),
          Enter: () => choose(active),
          ' ': () => choose(active),
        }
      : {
          ArrowDown: () => show(from),
          ArrowUp: () => show(from),
          Enter: () => show(from),
          ' ': () => show(from),
          Home: () => show(0),
          End: () => show(last),
        };
    if (open && e.key === 'Tab') choose(active); // and focus moves on
    const run = step[e.key];
    // Shift, Caps Lock and other keys that type nothing don't end a search ("Zi C" with Shift).
    if (!run) return;
    typed.current.text = '';
    e.preventDefault();
    run();
  };

  // Only a pointer that really moved takes the highlight: Safari reports one when the list
  // scrolls under a still mouse, which would pull the highlight away from the arrow keys.
  const onPointerMove = (i: number) => (e: ReactPointerEvent) => {
    const p = pointer.current;
    if (p.x === e.clientX && p.y === e.clientY) return;
    pointer.current = { x: e.clientX, y: e.clientY };
    if (i !== active) setActive(i);
  };

  return (
    <div className="select" ref={root}>
      {/* Like a <label>: a click on it puts the focus on the field. */}
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <span id={`${id}-label`} className="select-label" onClick={() => !disabled && field.current?.focus()}>
        {label}
      </span>
      <div
        ref={field}
        role="combobox"
        tabIndex={disabled ? -1 : 0}
        className={`select-field${open ? ' active' : ''}`}
        aria-labelledby={`${id}-label`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-disabled={disabled || undefined}
        {...(open && { 'aria-activedescendant': `${id}-${active}` })}
        onClick={() => (open ? setOpen(false) : show(Math.max(current, 0)))}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        {selected?.icon}
        <span className="select-value">{selected?.label ?? missing ?? ''}</span>
        <svg className="select-chevron" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
      {/* A press on the list keeps the focus on the field (mousedown, not pointerdown: Safari
          sends no click after a cancelled touch pointerdown), so it doesn't close before the choice. */}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/interactive-supports-focus */}
      <div
        ref={list}
        id={`${id}-list`}
        role="listbox"
        aria-labelledby={`${id}-label`}
        className="select-list"
        hidden={!open}
        onMouseDown={(e) => e.preventDefault()}
      >
        {options.map((o, i) => (
          // The keys are the field's, and the focus stays there (aria-activedescendant), so an
          // option takes neither the focus nor a key listener of its own.
          // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
          <div
            key={o.value}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === active}
            className={`${i === active ? 'active' : ''}${i === current ? ' current' : ''}`}
            onPointerMove={onPointerMove(i)}
            onClick={(e) => {
              choose(i);
              settle(e.clientX, e.clientY);
            }}
          >
            {o.icon}
            <span className="select-option-label">{o.label}</span>
            {i === current && (
              <span className="select-tick" aria-hidden="true">
                ✓
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
