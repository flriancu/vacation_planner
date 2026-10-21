import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface Props {
  /** Accessible name of the button and the panel. */
  label: string;
  /** What the button shows (text, or an avatar). */
  button: ReactNode;
  buttonClassName?: string;
  children: ReactNode;
}

/**
 * A button that opens a small panel below it (disclosure pattern, not role=menu: the panel
 * holds form controls). Closes on Escape (focus returns to the button) and on a click outside.
 */
export function Menu({ label, button, buttonClassName, children }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={buttonClassName}
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        {button}
      </button>
      {open && (
        <div id={id} className="menu-panel" role="group" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}
