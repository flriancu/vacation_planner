import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import type { SharedWith, Sharing } from '../storage/Sharing';
import { Dialog } from './Dialog';
import { errorMessage } from './errors';

/**
 * Share my plan, read-only (PPL-3): add someone by email, see who has it, stop sharing. They
 * then follow it from their own app (People → Follow a plan).
 */
export function ShareDialog({ sharing, calendarId, onClose }: { sharing: Sharing; calendarId: string; onClose: () => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [list, setList] = useState<readonly SharedWith[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      sharing.sharedWith(calendarId).then(setList, (e: unknown) => {
        setList([]);
        setNote(t(errorMessage(e)));
      }),
    [sharing, calendarId, t],
  );
  useEffect(() => void reload(), [reload]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setNote(t('share.invalid'));
      return;
    }
    setBusy(true);
    sharing
      .share(calendarId, address)
      .then(
        () => {
          setEmail('');
          setNote(t('share.done', { email: address }));
          return reload();
        },
        (err: unknown) => setNote(t(errorMessage(err))),
      )
      .finally(() => setBusy(false));
  };

  const stop = (s: SharedWith) => {
    setBusy(true);
    sharing
      .unshare(calendarId, s.id)
      .then(reload, (err: unknown) => setNote(t(errorMessage(err))))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog title={t('share.title')} onClose={onClose}>
      <p className="dialog-help">{t('share.help')}</p>
      <form className="share-form" onSubmit={add}>
        <label>
          {t('share.email')}
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button type="submit" className="primary" disabled={busy || !email.trim()}>
          {t('share.add')}
        </button>
      </form>
      {note && (
        <p className="summary" role="status">
          {note}
        </p>
      )}
      <div>
        <p className="dialog-help">{list === null ? t('save.loading') : list.length ? t('share.with') : t('share.none')}</p>
        {list && list.length > 0 && (
          <ul className="shares">
            {list.map((s) => (
              <li key={s.id}>
                <span>{s.name ? `${s.name} (${s.email})` : s.email}</span>
                <button type="button" onClick={() => stop(s)} disabled={busy} aria-label={t('share.stopLabel', { email: s.email })}>
                  {t('share.stop')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="actions">
        <span className="spacer" />
        <button type="button" onClick={onClose}>
          {t('share.close')}
        </button>
      </div>
    </Dialog>
  );
}
