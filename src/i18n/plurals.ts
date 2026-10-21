/** Counted phrases. Romanian has three forms: "1 zi", "2 zile", "20 de zile" (from 20 on). */
export type PluralKey = 'days' | 'leaveDays' | 'floatingDays' | 'excusedDays';

type Lang = 'ro' | 'en';
type Forms = { one: string; few?: string; other: string };

const PLURALS: Record<Lang, Record<PluralKey, Forms>> = {
  ro: {
    days: { one: '{n} zi', few: '{n} zile', other: '{n} de zile' },
    leaveDays: { one: '{n} zi de concediu', few: '{n} zile de concediu', other: '{n} de zile de concediu' },
    floatingDays: { one: '{n} zi flotantă', few: '{n} zile flotante', other: '{n} de zile flotante' },
    excusedDays: { one: '{n} zi de învoire', few: '{n} zile de învoire', other: '{n} de zile de învoire' },
  },
  en: {
    days: { one: '{n} day', other: '{n} days' },
    leaveDays: { one: '{n} leave day', other: '{n} leave days' },
    floatingDays: { one: '{n} floating day', other: '{n} floating days' },
    excusedDays: { one: '{n} day of excused leave', other: '{n} days of excused leave' },
  },
};

const LOCALES: Record<Lang, string> = { ro: 'ro-RO', en: 'en-GB' };
const rules = new Map<Lang, Intl.PluralRules>();

export function pluralize(lang: Lang, key: PluralKey, n: number): string {
  let r = rules.get(lang);
  if (!r) rules.set(lang, (r = new Intl.PluralRules(LOCALES[lang])));
  const forms = PLURALS[lang][key];
  const category = r.select(n);
  const form = category === 'one' ? forms.one : category === 'few' ? (forms.few ?? forms.other) : forms.other;
  return form.replace('{n}', String(n));
}
