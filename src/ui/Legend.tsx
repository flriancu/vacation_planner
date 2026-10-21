import type { CSSProperties } from 'react';
import { live, type PlanDoc } from '../domain/schema';
import { useI18n } from '../i18n';

const swatchColor = (key: string | undefined, color: string) => ({ '--c': key ? `var(--leave-${key})` : color }) as CSSProperties;

/** Day kinds, the three statuses and the leave types, drawn as in the calendar (CAL-4, CAL-6). */
export function Legend({ doc }: { doc: PlanDoc }) {
  const { t, name } = useI18n();
  const annual = swatchColor('annual', '');
  const types = live(doc.leaveTypes).filter((lt) => !lt.hidden);
  return (
    <div className="legend-wrap">
      <ul className="legend" aria-label={t('legend.label')}>
        <li>
          <span className="swatch base-weekend" /> {t('legend.weekend')}
        </li>
        <li>
          <span className="swatch base-holiday" /> {t('legend.holiday')}
        </li>
        {(['idea', 'planned', 'approved'] as const).map((s) => (
          <li key={s}>
            <span className={`swatch ${s === 'idea' ? 'fill-none idea-only' : `fill-${s}`}`} style={annual}>
              <span className={`outline st-${s} e-t e-r e-b e-l`} style={annual} />
            </span>{' '}
            {t(`status.${s}`)}
          </li>
        ))}
      </ul>
      <ul className="legend legend-types" aria-label={t('legend.types')}>
        {types.map((lt) => (
          <li key={lt.id}>
            <span className="type-dot" style={swatchColor(lt.key, lt.color)} /> {name(lt.name)}
          </li>
        ))}
      </ul>
    </div>
  );
}
