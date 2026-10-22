import type { CSSProperties } from 'react';
import type { BlockStatus } from '../domain/schema';
import { useI18n } from '../i18n';

/**
 * Leave as the calendar draws it in a status: the fill and the outline. Days off anyway (office
 * closed) keep their own colours and get no fill as an idea, as on the calendar.
 */
export function BlockSwatch({ status, free = false }: { status: BlockStatus; free?: boolean }) {
  const fill = status === 'idea' ? (free ? 'fill-none' : 'idea-only') : free ? 'free-block' : `fill-${status}`;
  return (
    <span
      className={`swatch ${fill}${free ? ' free' : ''}`}
      style={{ '--c': free ? 'var(--free-edge)' : 'var(--leave)' } as CSSProperties}
      aria-hidden="true"
    >
      <span className={`outline st-${status} e-t e-r e-b e-l`} />
    </span>
  );
}

/** Days off anyway, holidays, and the three statuses of your leave, drawn as in the calendar (CAL-4, CAL-6). */
export function Legend({ stacked = false }: { stacked?: boolean }) {
  const { t } = useI18n();
  return (
    <ul className={`legend${stacked ? ' stacked' : ''}`} aria-label={t('legend.label')}>
      <li>
        <span className="swatch base-weekend" /> {t('legend.free')}
      </li>
      <li>
        <span className="swatch base-holiday" /> {t('legend.holiday')}
      </li>
      <li className="legend-group">{t('legend.leave')}</li>
      {(['idea', 'planned', 'approved'] as const).map((s) => (
        <li key={s}>
          <BlockSwatch status={s} /> {t(`status.${s}`)}
        </li>
      ))}
    </ul>
  );
}
