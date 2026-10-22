import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Legend } from './Legend';
import { Notice } from './Notice';
import { useDismissed } from './useLayout';
import type { WidthClass } from './useLayout';

/** How to add leave: shown until closed. */
function Hint() {
  const { t } = useI18n();
  const [closed, close] = useDismissed('vacation-planner.hintClosed');
  if (closed) return null;
  return (
    <Notice scope="inline" onClose={close} closeLabel={t('hint.close')}>
      <p>{t('calendar.help')}</p>
    </Notice>
  );
}

/**
 * Material 3 "supporting pane": content that only makes sense next to the calendar. Expanded
 * widths: a column on the right (legend, hint; later balance and suggestions). Narrower: above the
 * calendar, the legend as one row (medium) or behind a "Legend" toggle (compact).
 */
export function SidePane({ width, people }: { width: WidthClass; people?: ReactNode }) {
  const { t } = useI18n();
  if (width === 'expanded') {
    return (
      <aside className="side-pane" aria-label={t('pane.label')}>
        <section>
          <h2>{t('legend.label')}</h2>
          <Legend stacked />
        </section>
        {people && (
          <section>
            <h2>{t('people.title')}</h2>
            {people}
          </section>
        )}
        <Hint />
      </aside>
    );
  }
  return (
    <div className="above-calendar">
      {width === 'compact' ? (
        <details className="legend-toggle">
          <summary>{t('legend.label')}</summary>
          <Legend />
          {people}
        </details>
      ) : (
        <>
          <Legend />
          {people}
        </>
      )}
      <Hint />
    </div>
  );
}
