import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { displayName } from '../domain/text';
import { useI18n, type MessageKey } from '../i18n';
import { isRetryable, needsSignIn } from '../storage/Storage';
import type { SharedWith, Sharing } from '../storage/Sharing';
import { Dialog } from './Dialog';

/** Longest email address there can be (RFC 5321). */
const MAX_EMAIL = 254;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What went wrong while sharing, in the user's words. Nothing here retries by itself, so none says so. */
function shareError(e: unknown, stopping = false): MessageKey {
  if (needsSignIn(e)) return 'err.auth';
  if (isRetryable(e)) return 'share.errLater';
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 400 && !stopping) return 'share.errAddress';
  if (status === 403) return stopping ? 'share.errStopRefused' : 'share.errRefused';
  return 'share.errLater';
}

interface Note {
  key: MessageKey;
  email?: string;
}

/**
 * Share my plan, read-only (PPL-3): add someone by email, see who has it, stop sharing. They
 * then follow it from their own app (People → Follow a plan). The list shows every kind of
 * access the file has, not only what this dialog gave, so "shared with nobody" is true.
 */
export function ShareDialog({
  sharing,
  calendarId,
  myEmail,
  onSignIn,
  onClose,
}: {
  sharing: Sharing;
  calendarId: string;
  myEmail?: string;
  onSignIn?: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [list, setList] = useState<readonly SharedWith[] | 'failed' | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const reload = useCallback(
    () =>
      sharing.sharedWith(calendarId).then(setList, (e: unknown) => {
        setList('failed');
        setNote({ key: shareError(e) });
      }),
    [sharing, calendarId],
  );
  useEffect(() => void reload(), [reload]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (address.length > MAX_EMAIL || !EMAIL.test(address)) return setNote({ key: 'share.invalid' });
    const same = (other?: string) => other?.toLowerCase() === address.toLowerCase();
    if (same(myEmail)) return setNote({ key: 'share.self' });
    if (Array.isArray(list) && list.some((s) => same(s.email))) return setNote({ key: 'share.already', email: address });
    setBusy(true);
    sharing
      .share(calendarId, address)
      .then(
        () => {
          // Only the address that was shared is cleared: one typed meanwhile stays.
          setEmail((now) => (now.trim() === address ? '' : now));
          setNote({ key: 'share.done', email: address });
          return reload();
        },
        (err: unknown) => setNote({ key: shareError(err) }),
      )
      .finally(() => setBusy(false));
  };

  const stop = (s: SharedWith) => {
    setBusy(true);
    sharing
      .unshare(calendarId, s.id)
      .then(
        () => {
          setNote(null); // "Done: x can see your plan" would no longer be true
          return reload();
        },
        (err: unknown) => setNote({ key: shareError(err, true) }),
      )
      .finally(() => setBusy(false));
  };

  const who = (s: SharedWith) => {
    const base =
      s.kind === 'anyone'
        ? t('share.anyone')
        : s.kind === 'domain'
          ? s.domain
            ? t('share.domain', { domain: s.domain })
            : t('share.someDomain') // Drive may leave the domain's name out
          : s.name
            ? `${displayName(s.name)} (${s.email})`
            : (s.email ?? '');
    return s.role === 'reader' ? base : `${base} — ${t(s.role === 'commenter' ? 'share.canComment' : 'share.canEdit')}`;
  };

  return (
    <Dialog title={t('share.title')} onClose={onClose}>
      <p className="dialog-help">{t('share.help')}</p>
      <form className="share-form" onSubmit={add}>
        <label>
          {t('share.email')}
          <input
            type="email"
            autoComplete="email"
            maxLength={MAX_EMAIL}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              // A note about the last address doesn't stay next to a new one.
              if (note && note.key !== 'err.auth') setNote(null);
            }}
          />
        </label>
        <button type="submit" className="primary" disabled={busy || !email.trim()}>
          {t('share.add')}
        </button>
      </form>
      {note && (
        <p className="summary" role="status">
          {t(note.key, { email: note.email ?? '' })}
          {note.key === 'err.auth' && onSignIn && (
            <>
              {' '}
              <button type="button" className="link" onClick={onSignIn}>
                {t('people.signInAction')}
              </button>
            </>
          )}
        </p>
      )}
      <div>
        {list === 'failed' ? (
          <p className="dialog-help">
            {t('share.listFailed')}{' '}
            <button type="button" className="link" onClick={() => void reload()}>
              {t('share.retry')}
            </button>
          </p>
        ) : (
          <p className="dialog-help">{list === null ? t('save.loading') : list.length ? t('share.with') : t('share.none')}</p>
        )}
        {Array.isArray(list) && list.length > 0 && (
          <ul className="shares">
            {list.map((s) => (
              <li key={s.id}>
                <span>{who(s)}</span>
                <button type="button" onClick={() => stop(s)} disabled={busy} aria-label={t('share.stopLabel', { email: who(s) })}>
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
