import type { CSSProperties } from 'react';
import { useI18n } from '../i18n';

const LEAVE = { '--c': 'var(--leave)' } as CSSProperties;

/** Days off anyway, holidays, and the three statuses of your leave, drawn as in the calendar (CAL-4, CAL-6). */
export function Legend() {
  const { t } = useI18n();
  return (
    <ul className="legend" aria-label={t('legend.label')}>
      <li>
        <span className="swatch base-weekend" /> {t('legend.free')}
      </li>
      <li>
        <span className="swatch base-holiday" /> {t('legend.holiday')}
      </li>
      <li className="legend-group">{t('legend.leave')}</li>
      {(['idea', 'planned', 'approved'] as const).map((s) => (
        <li key={s}>
          <span className={`swatch ${s === 'idea' ? 'idea-only' : `fill-${s}`}`} style={LEAVE}>
            <span className={`outline st-${s} e-t e-r e-b e-l`} style={LEAVE} />
          </span>{' '}
          {t(`status.${s}`)}
        </li>
      ))}
    </ul>
  );
}
