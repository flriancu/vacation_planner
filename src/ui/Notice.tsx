import type { ReactNode } from 'react';

interface Props {
  /** `page`: a full-width strip under the header (about the whole app). `inline`: a card next to the content it's about. */
  scope: 'page' | 'inline';
  label?: string;
  children: ReactNode;
  /** Buttons or links after the text. */
  actions?: ReactNode;
  /** Shows the close button; its accessible name is `closeLabel`. */
  onClose?: () => void;
  closeLabel?: string;
}

/** The one notice component: text, optional actions, optional close — same anatomy wherever it appears. */
export function Notice({ scope, label, children, actions, onClose, closeLabel }: Props) {
  return (
    <div className={`notice notice-${scope}`} role="region" aria-label={label}>
      <div className="notice-text">{children}</div>
      {actions}
      {onClose && (
        <button
          type="button"
          className="notice-close"
          onClick={(e) => {
            // The button is about to disappear: hand focus to the content, not to the top of the page (WCAG 2.4.3).
            const hadFocus = document.activeElement === e.currentTarget;
            onClose();
            if (hadFocus) requestAnimationFrame(() => document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true }));
          }}
          aria-label={closeLabel}
          data-tip={closeLabel}
        >
          ×
        </button>
      )}
    </div>
  );
}
