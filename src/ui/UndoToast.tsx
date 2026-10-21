import { useEffect } from 'react';
import { useI18n } from '../i18n';

const SHOW_MS = 8000;

export interface UndoOffer {
  /** Changes on each offer, so a second delete restarts the timer. */
  id: number;
  message: string;
  undo: () => void;
}

/** A short message with one action, after something that can be undone (instead of "are you sure?"). */
export function UndoToast({ offer, onDone }: { offer: UndoOffer | null; onDone: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    if (!offer) return;
    const timer = window.setTimeout(onDone, SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [offer, onDone]);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {offer && (
        <div className="toast">
          <span>{offer.message}</span>
          <button
            type="button"
            className="link"
            onClick={() => {
              offer.undo();
              onDone();
            }}
          >
            {t('undo.action')}
          </button>
          <button type="button" className="notice-close" onClick={onDone} aria-label={t('strip.close')} data-tip={t('strip.close')}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
