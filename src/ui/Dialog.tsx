import { useEffect, useRef, type ReactNode } from 'react';
import './editor.css';

interface Props {
  title: string;
  children: ReactNode;
  onClose: () => void;
}

/**
 * A modal dialog in the editor's look, for short tasks with nothing to lose (exports, an
 * import's preview): Escape or the Cancel button closes it. The title takes the first focus,
 * so on phones no control opens by itself (see BlockEditor).
 */
export function Dialog({ title, children, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  /** Where the focus was when it opened: it goes back there when it closes (WCAG 2.4.3). */
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.setAttribute('autofocus', '');
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="editor"
      aria-labelledby="dialog-title"
      onClose={() => {
        onClose();
        if (opener.current?.isConnected) opener.current.focus();
      }}
    >
      <div className="dialog-body">
        <h2 id="dialog-title" ref={heading} tabIndex={-1}>
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
