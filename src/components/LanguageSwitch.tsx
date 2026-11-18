import { useState } from 'react';
import { changeLanguage, resolvedLang } from '../client/language';
import { t, type Lang } from '../shared/i18n';

/** 언어 고르기: 한국어, 영어. 아직 고른 적이 없으면 시스템 언어를 따르고, 그 언어 버튼이 눌린 것으로 보인다. */
export const LANGUAGE_OPTIONS = [
  { value: 'ko', label: '한국어', text: '한' },
  { value: 'en', label: 'English', text: 'EN' },
] as const satisfies readonly { value: Lang; label: string; text: string }[];

export function LanguageSwitch({ dark }: { dark: boolean }) {
  const [language, setLanguage] = useState<Lang>(() => resolvedLang());
  return <div role="group" aria-label={t('언어', 'Language')} className={`inline-flex shrink-0 items-center gap-0.5 rounded-xl border p-0.5 ${dark ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'}`}>
    {LANGUAGE_OPTIONS.map(({ value, label, text }) => {
      const active = language === value;
      return <button key={value} type="button" aria-label={label} title={label} aria-pressed={active}
        onClick={() => { if (active) return; setLanguage(value); changeLanguage(value); }}
        className={`inline-flex min-w-8 items-center justify-center rounded-lg px-2 py-1 text-xs font-semibold transition cursor-pointer ${active ? dark ? 'bg-slate-700 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm' : dark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-950'}`}>
        {text}
      </button>;
    })}
  </div>;
}
