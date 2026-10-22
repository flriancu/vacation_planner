import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { toUTC, type ISODate } from '../domain/dates';
import type { Names } from '../domain/schema';
import { displayName } from '../domain/text';
import { en } from './en';
import { pluralize, type PluralKey } from './plurals';
import { ro, type MessageKey } from './ro';

export type Lang = 'ro' | 'en';
export type { MessageKey };

const DICTS: Record<Lang, Record<MessageKey, string>> = { ro, en };
const LOCALES: Record<Lang, string> = { ro: 'ro-RO', en: 'en-GB' };

export interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  /** A counted phrase in the right grammatical form: "1 zi", "2 zile", "20 de zile". */
  plural: (key: PluralKey, n: number) => string;
  /** Picks the right half of a `{ ro, en }` pair, safe to show (plans may come from someone else). */
  name: (names: Names) => string;
  /** Dates are whole UTC days (domain/dates.ts), so every format runs in UTC. */
  date: (date: ISODate, options: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ lang, setLang, children }: { lang: Lang; setLang: (lang: Lang) => void; children: ReactNode }) {
  const value = useMemo<I18n>(() => {
    const dict = DICTS[lang];
    const formatters = new Map<string, Intl.DateTimeFormat>();
    return {
      lang,
      setLang,
      t: (key, params) => dict[key].replace(/\{(\w+)\}/g, (_, p: string) => String(params?.[p] ?? `{${p}}`)),
      plural: (key, n) => pluralize(lang, key, n),
      name: (names) => displayName(String(names[lang] ?? '')),
      date: (date, options) => {
        const key = JSON.stringify(options);
        let f = formatters.get(key);
        if (!f) formatters.set(key, (f = new Intl.DateTimeFormat(LOCALES[lang], { ...options, timeZone: 'UTC' })));
        return f.format(toUTC(date));
      },
    };
  }, [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n outside I18nProvider');
  return value;
}
