import { useI18n, type MessageKey } from '../i18n';
import type { Follow } from '../domain/schema';
import type { FollowedState } from '../sync/Followed';
import { MAX_PEOPLE } from './Calendar';
import type { PeopleNote } from './usePeople';

export interface PersonRow {
  follow: Follow;
  /** Their own name from their plan, once it has loaded; else the name written down when I followed it. */
  name: string;
  /** How far their plan has loaded, or why it isn't drawn (hidden, no room, my own plan). */
  state: FollowedState | 'hidden' | 'tooMany' | 'own';
  /** When what is shown was read (ms since 1970). */
  loadedAt?: number;
}

interface Props {
  people: readonly PersonRow[];
  onToggle: (follow: Follow) => void;
  onMove: (follow: Follow, by: -1 | 1) => void;
  onUnfollow: (follow: Follow) => void;
  onFollow: () => void;
  /** A message after picking a plan (my own, already followed, or the picker failed). */
  note: PeopleNote | null;
  /** Offered when the Google session ended. */
  onSignIn?: () => void;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const STATE_TEXT: Partial<Record<PersonRow['state'], MessageKey>> = {
  loading: 'people.loading',
  waiting: 'people.waiting',
  signIn: 'people.signIn',
  gone: 'people.gone',
  unsupported: 'people.unsupported',
  own: 'people.ownCopy',
};

/**
 * The people whose plans I follow (PPL-3, PPL-4): each with their line's place, shown or not,
 * the order the lines keep, and why a plan isn't drawn. Lines are told apart by place, not
 * colour, so the place is written next to each name.
 */
export function PeoplePanel({ people, onToggle, onMove, onUnfollow, onFollow, note, onSignIn }: Props) {
  const { t } = useI18n();
  let line = 0;
  const signInNeeded = people.some((p) => p.state === 'signIn') || note?.reason === 'err.auth';
  return (
    <div className="people">
      {people.length === 0 ? (
        <p className="people-empty">{t('people.empty')}</p>
      ) : (
        <ul>
          {people.map((p, i) => {
            if (!p.follow.hidden) line++;
            const place =
              p.state === 'hidden'
                ? t('people.hidden')
                : p.state === 'tooMany'
                  ? t('people.tooMany', { max: MAX_PEOPLE })
                  : t('people.line', { n: line });
            const stateKey = STATE_TEXT[p.state];
            // Moves step over hidden people (domain/people.ts movedOrder), so only a shown neighbour counts.
            const shownBefore = people.slice(0, i).some((q) => !q.follow.hidden);
            const shownAfter = people.slice(i + 1).some((q) => !q.follow.hidden);
            return (
              <li key={p.follow.id}>
                <label className="person">
                  <input type="checkbox" checked={!p.follow.hidden} onChange={() => onToggle(p.follow)} />
                  <span className="person-name">
                    {p.name}
                    <span className="person-state">
                      {place}
                      {stateKey && ` · ${t(stateKey)}`}
                      {p.state === 'stale' && p.loadedAt !== undefined && ` · ${t('people.stale', { time: time(p.loadedAt) })}`}
                    </span>
                  </span>
                </label>
                <span className="person-actions">
                  <button
                    type="button"
                    className="square"
                    disabled={!shownBefore}
                    onClick={() => onMove(p.follow, -1)}
                    aria-label={t('people.up', { name: p.name })}
                    data-tip={t('people.up', { name: p.name })}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="square"
                    disabled={!shownAfter}
                    onClick={() => onMove(p.follow, 1)}
                    aria-label={t('people.down', { name: p.name })}
                    data-tip={t('people.down', { name: p.name })}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="square"
                    onClick={() => onUnfollow(p.follow)}
                    aria-label={t('people.remove', { name: p.name })}
                    data-tip={t('people.remove', { name: p.name })}
                  >
                    ×
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {people.length > 0 && (
        <ul className="legend people-legend" aria-label={t('people.legend')}>
          {(['idea', 'planned', 'approved'] as const).map((s) => (
            <li key={s}>
              <span className={`line-sample st-${s}`} aria-hidden="true" /> {t(`status.${s}`)}
            </li>
          ))}
          <li>
            <span className="together-sample st-planned" aria-hidden="true" /> {t('people.together')}
          </li>
          <li>
            <span className="together-sample st-approved" aria-hidden="true" /> {t('people.togetherApproved')}
          </li>
        </ul>
      )}
      <button type="button" className="link" onClick={onFollow}>
        {t('people.follow')}
      </button>
      {note && (
        <p className="people-note" role="status">
          {t(note.key, { reason: note.reason ? t(note.reason) : '' })}
        </p>
      )}
      {signInNeeded && onSignIn && (
        <button type="button" className="link" onClick={onSignIn}>
          {t('people.signInAction')}
        </button>
      )}
    </div>
  );
}
