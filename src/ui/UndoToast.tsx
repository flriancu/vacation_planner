import { useEffect, useState } from 'react';
import { useI18n, type MessageKey } from '../i18n';

const SHOW_MS = 8000;
/** After Undo, the toast's place keeps catching clicks this long: a double click's second click must not land on the calendar below. */
const SETTLE_MS = 500;

export interface UndoOffer {
  /** Changes on each offer, so another delete restarts the timer. */
  id: number;
  /** Shown in the current language, so a language switch while it shows translates it too. */
  message: { key: MessageKey; count?: number; params?: Record<string, string> };
  undo: () => void;
}

/** A short message with one action, after something that can be undone (instead of "are you sure?"). */
export function UndoToast({ offer, onDone }: { offer: UndoOffer | null; onDone: () => void }) {
  const { t, plural } = useI18n();
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    if (!offer) return;
    const timer = window.setTimeout(onDone, SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [offer, onDone]);

  useEffect(() => {
    if (!settling) return;
    const timer = window.setTimeout(() => setSettling(false), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [settling]);

  const message = offer && t(offer.message.key, { ...offer.message.params, count: plural('leaves', offer.message.count ?? 1) });

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {offer ? (
        <div className="toast">
          <span>{message}</span>
          <button
            type="button"
            className="link"
            onClick={() => {
              offer.undo();
              setSettling(true);
              onDone();
            }}
          >
            {t('undo.action')}
          </button>
          <button type="button" className="notice-close" onClick={onDone} aria-label={t('strip.close')} data-tip={t('strip.close')}>
            ×
          </button>
        </div>
      ) : (
        settling && <div className="toast toast-settling" aria-hidden="true" />
      )}
    </div>
  );
}
