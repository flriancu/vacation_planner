import { useI18n } from '../i18n';
import type { Follow } from '../domain/schema';
import { MAX_PEOPLE } from './Calendar';

export interface PersonRow {
  follow: Follow;
  /** Their own name from their plan, once it has loaded; else the file's name. */
  name: string;
  state: 'loading' | 'ready' | 'unreadable';
}

interface Props {
  people: readonly PersonRow[];
  onToggle: (follow: Follow) => void;
  onMove: (follow: Follow, by: -1 | 1) => void;
  onUnfollow: (follow: Follow) => void;
  onFollow: () => void;
  /** A message after picking a plan (my own, already followed, or the picker failed). */
  note: string | null;
}

/**
 * The people whose plans I follow (PPL-3, PPL-4): each with their line's place, shown or not,
 * and the order the lines keep. Lines are told apart by place, not colour, so the place is
 * written next to each name.
 */
export function PeoplePanel({ people, onToggle, onMove, onUnfollow, onFollow, note }: Props) {
  const { t } = useI18n();
  let line = 0;
  return (
    <div className="people">
      {people.length === 0 ? (
        <p className="people-empty">{t('people.empty')}</p>
      ) : (
        <ul>
          {people.map((p, i) => {
            const shown = !p.follow.hidden && line < MAX_PEOPLE;
            if (!p.follow.hidden) line++;
            return (
              <li key={p.follow.id}>
                <label className="person">
                  <input type="checkbox" checked={!p.follow.hidden} onChange={() => onToggle(p.follow)} />
                  <span className="person-name">
                    {p.name}
                    <span className="person-state">
                      {p.follow.hidden
                        ? t('people.hidden')
                        : shown
                          ? t('people.line', { n: line })
                          : t('people.tooMany', { max: MAX_PEOPLE })}
                      {p.state === 'loading' && ` · ${t('people.loading')}`}
                      {p.state === 'unreadable' && ` · ${t('people.unreadable')}`}
                    </span>
                  </span>
                </label>
                <span className="person-actions">
                  <button
                    type="button"
                    className="square"
                    disabled={i === 0}
                    onClick={() => onMove(p.follow, -1)}
                    aria-label={t('people.up', { name: p.name })}
                    data-tip={t('people.up', { name: p.name })}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="square"
                    disabled={i === people.length - 1}
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
            <span className="together-sample" aria-hidden="true" /> {t('people.together')}
          </li>
        </ul>
      )}
      <button type="button" className="link" onClick={onFollow}>
        {t('people.follow')}
      </button>
      {note && (
        <p className="people-note" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
