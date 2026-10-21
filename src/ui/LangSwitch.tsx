import { useI18n, type Lang } from '../i18n';

// Each language is named in itself, never abbreviated. Same look as public/legal.css .langs.
const LANGS: { lang: Lang; label: string }[] = [
  { lang: 'ro', label: 'Română' },
  { lang: 'en', label: 'English' },
];

/** The language switch used on every page (I18N-1). */
export function LangSwitch() {
  const { t, lang, setLang } = useI18n();
  return (
    <div className="langs" role="group" aria-label={t('lang.label')}>
      {LANGS.map((l) => (
        <button key={l.lang} type="button" lang={l.lang} aria-pressed={lang === l.lang} onClick={() => setLang(l.lang)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
