import type { CSSProperties } from 'react';
import { typeByKey, type PlanDoc } from '../domain/schema';
import { useI18n } from '../i18n';

/** Day kinds and the three statuses, drawn the same way as in the calendar (CAL-4, CAL-6). */
export function Legend({ doc }: { doc: PlanDoc }) {
  const { t } = useI18n();
  const annual = { '--c': typeByKey(doc, 'annual')?.color ?? '#999' } as CSSProperties;
  return (
    <ul className="legend" aria-label={t('legend.label')}>
      <li>
        <span className="swatch base-weekend" /> {t('legend.weekend')}
      </li>
      <li>
        <span className="swatch base-holiday" /> {t('legend.holiday')}
      </li>
      {(['idea', 'planned', 'approved'] as const).map((s) => (
        <li key={s}>
          <span className={`swatch fill-${s === 'idea' ? 'none' : s}`} style={annual}>
            <span className={`outline st-${s} e-t e-r e-b e-l`} style={annual} />
          </span>{' '}
          {t(`status.${s}`)}
        </li>
      ))}
    </ul>
  );
}
