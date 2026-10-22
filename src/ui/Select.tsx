import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

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
}

/** Typed letters within this long of each other make one search ("co" finds "Concediu"). */
const TYPE_AHEAD_MS = 500;
const PAGE = 10;

/** Lowercase, without diacritics: typing "i" finds "Învoire". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * A drop-down list whose options can show a picture, which a native <select> can't do on
 * phones. It is the WAI-ARIA "select-only combobox": focus stays on the field and the list
 * marks the option in reach. The list opens below the field, in the page's flow like the
 * month calendar, so a dialog never clips it.
 *
 * Keys: arrows, Home/End, Page Up/Down, typing a name's first letters; Enter, Space or Tab
 * chooses; Escape closes the list (only the list, not the dialog around it).
 */
export function Select({ label, value, options, onChange }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const current = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[current];
  const last = options.length - 1;
  const clamp = (i: number) => Math.min(Math.max(i, 0), last);

  const show = (at: number) => {
    setActive(clamp(at));
    setOpen(true);
  };
  const choose = (i: number) => {
    setOpen(false);
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
  };

  /** The next option whose label starts with what was typed; a repeated letter steps through them. */
  const search = (key: string, from: number) => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > TYPE_AHEAD_MS ? key : t.text + key;
    t.at = now;
    const text = fold([...t.text].every((c) => c === t.text[0]) ? t.text[0]! : t.text);
    const start = text.length === 1 ? from + 1 : from;
    for (let k = 0; k < options.length; k++) {
      const i = (start + k) % options.length;
      if (fold(options[i]!.label).startsWith(text)) return i;
    }
    return -1;
  };

  // While open: Escape closes the list before the dialog sees it (BlockEditor listens on the
  // document, which comes after the window), and a tap outside closes it, as a blur may not
  // happen on a phone.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) return;
    if (e.key.length === 1 && e.key !== ' ' && !e.altKey) {
      const found = search(e.key, open ? active : current);
      if (found >= 0) show(found);
      else if (!open) show(current);
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
          ArrowDown: () => show(current),
          ArrowUp: () => show(current),
          Enter: () => show(current),
          ' ': () => show(current),
          Home: () => show(0),
          End: () => show(last),
        };
    if (open && e.key === 'Tab') choose(active); // and focus moves on
    const run = step[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };

  return (
    <div className="select" ref={root}>
      <span id={`${id}-label`} className="select-label">
        {label}
      </span>
      <div
        role="combobox"
        tabIndex={0}
        className={`select-field${open ? ' active' : ''}`}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        {...(open && { 'aria-activedescendant': `${id}-${active}` })}
        onClick={() => (open ? setOpen(false) : show(current))}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        {selected?.icon}
        <span id={`${id}-value`} className="select-value">
          {selected?.label}
        </span>
        <svg className="select-chevron" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
      {/* Clicks on the list keep the focus on the field, so it doesn't close before the choice. */}
      <div
        ref={list}
        id={`${id}-list`}
        role="listbox"
        aria-labelledby={`${id}-label`}
        className="select-list"
        hidden={!open}
        onPointerDown={(e) => e.preventDefault()}
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
            onPointerMove={() => i !== active && setActive(i)}
            onClick={() => choose(i)}
          >
            {o.icon}
            <span>{o.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
